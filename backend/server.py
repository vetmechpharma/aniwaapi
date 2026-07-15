"""
Unofficial WhatsApp API server.
Talks to a local Node.js Baileys sidecar for actual WhatsApp connections.
Exposes:
  - Admin auth (JWT + cookies)
  - Dashboard APIs (sessions, rules, webhooks, logs, api keys, stats)
  - Public API (Bearer API key) - /api/v1/*
  - Internal callback (from sidecar) - /api/internal/incoming
"""

from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict

import bcrypt
import httpx
import jwt
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form, Header
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ------------------- config -------------------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@example.com').lower()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
WA_SIDECAR_URL = os.environ.get('WA_SIDECAR_URL', 'http://localhost:3002').rstrip('/')
SIDECAR_TOKEN = os.environ.get('SIDECAR_TOKEN', '')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

logger = logging.getLogger("whatsapp-api")
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')

app = FastAPI(title="Unofficial WhatsApp API", version="1.0.0",
              description="Personal-use unofficial WhatsApp API powered by Baileys. Use responsibly.")

api = APIRouter(prefix="/api")
public = APIRouter(prefix="/api/v1", tags=["Public API (Bearer)"])
internal = APIRouter(prefix="/api/internal", tags=["Internal"])

# ------------------- helpers -------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode('utf-8'), hashed.encode('utf-8'))

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "refresh",
               "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")

def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def require_api_key(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    key = authorization[7:].strip()
    doc = await db.api_keys.find_one({"key": key, "revoked": {"$ne": True}})
    if not doc:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    await db.api_keys.update_one({"_id": doc["_id"]}, {"$set": {"last_used_at": datetime.now(timezone.utc).isoformat()},
                                                      "$inc": {"usage_count": 1}})
    doc["_id"] = str(doc["_id"])
    return doc

def require_sidecar_token(x_sidecar_token: Optional[str] = Header(None, alias="X-Sidecar-Token")):
    if not SIDECAR_TOKEN or x_sidecar_token != SIDECAR_TOKEN:
        raise HTTPException(status_code=401, detail="Bad sidecar token")

def sidecar_headers():
    return {"X-Sidecar-Token": SIDECAR_TOKEN}

async def sidecar_call(method: str, path: str, **kwargs) -> httpx.Response:
    url = f"{WA_SIDECAR_URL}{path}"
    headers = kwargs.pop("headers", {}) or {}
    headers.update(sidecar_headers())
    async with httpx.AsyncClient(timeout=30) as c:
        return await c.request(method, url, headers=headers, **kwargs)

# ------------------- models -------------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class RuleIn(BaseModel):
    session_id: str
    match_type: str = "contains"  # contains | exact | starts_with | regex
    trigger: str
    response: str
    enabled: bool = True

class WebhookIn(BaseModel):
    session_id: str
    url: str
    enabled: bool = True

class ApiKeyCreateIn(BaseModel):
    name: str

class CreateSessionIn(BaseModel):
    session_id: str
    use_pairing_code: bool = False
    phone_number: Optional[str] = None

class SendTextIn(BaseModel):
    session_id: str
    to: str
    text: str

class BroadcastIn(BaseModel):
    session_id: str
    recipients: List[str]
    text: str

class GroupCreateIn(BaseModel):
    session_id: str
    subject: str
    participants: List[str]

class GroupParticipantsIn(BaseModel):
    session_id: str
    group_jid: str
    action: str  # add | remove | promote | demote
    participants: List[str]

# ------------------- startup -------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.api_keys.create_index("key", unique=True)
    await db.rules.create_index("session_id")
    await db.webhooks.create_index("session_id")
    await db.messages.create_index([("session_id", 1), ("timestamp", -1)])
    await db.messages.create_index("created_at")

    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if existing is None:
        await db.users.insert_one({
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin user %s", ADMIN_EMAIL)
    elif not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
        await db.users.update_one({"email": ADMIN_EMAIL},
                                  {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}})
        logger.info("Updated admin password for %s", ADMIN_EMAIL)

@app.on_event("shutdown")
async def shutdown():
    client.close()

# ------------------- auth routes -------------------
@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    uid = str(user["_id"])
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"id": uid, "email": email, "name": user.get("name"), "role": user.get("role")}

@api.post("/auth/logout")
async def logout(response: Response, _user=Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user

@api.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    tok = request.cookies.get("refresh_token")
    if not tok:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    try:
        payload = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(str(user["_id"]), user["email"])
        response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
        return {"ok": True}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# ------------------- sessions (admin) -------------------
@api.get("/sessions")
async def list_sessions(_user=Depends(get_current_user)):
    r = await sidecar_call("GET", "/sessions")
    return r.json()

@api.post("/sessions")
async def create_session(body: CreateSessionIn, _user=Depends(get_current_user)):
    payload = {"sessionId": body.session_id,
               "usePairingCode": body.use_pairing_code,
               "phoneNumber": body.phone_number}
    r = await sidecar_call("POST", "/sessions", json=payload)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@api.get("/sessions/{sid}")
async def get_session(sid: str, _user=Depends(get_current_user)):
    r = await sidecar_call("GET", f"/sessions/{sid}")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@api.delete("/sessions/{sid}")
async def delete_session(sid: str, _user=Depends(get_current_user)):
    r = await sidecar_call("DELETE", f"/sessions/{sid}")
    # Also cleanup rules/webhooks for this session
    await db.rules.delete_many({"session_id": sid})
    await db.webhooks.delete_many({"session_id": sid})
    return r.json()

@api.post("/sessions/{sid}/pair")
async def pair_session(sid: str, phone_number: str = Form(...), _user=Depends(get_current_user)):
    r = await sidecar_call("POST", f"/sessions/{sid}/pair", json={"phoneNumber": phone_number})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ------------------- send (admin) -------------------
async def _do_send_text(session_id: str, to: str, text: str) -> dict:
    r = await sidecar_call("POST", f"/sessions/{session_id}/send-text", json={"to": to, "text": text})
    body = r.json()
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=body)
    # log
    await db.messages.insert_one({
        "session_id": session_id,
        "direction": "outgoing",
        "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"),
        "text": text,
        "media_type": None,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return body

async def _do_send_media(session_id: str, to: str, file: UploadFile, caption: str, media_type: str) -> dict:
    content = await file.read()
    files = {"file": (file.filename or "file", content, file.content_type or "application/octet-stream")}
    data = {"to": to, "caption": caption or "", "mediaType": media_type,
            "filename": file.filename or "file", "mimetype": file.content_type or ""}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WA_SIDECAR_URL}/sessions/{session_id}/send-media",
                         headers=sidecar_headers(), files=files, data=data)
    body = r.json()
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=body)
    await db.messages.insert_one({
        "session_id": session_id,
        "direction": "outgoing",
        "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"),
        "text": caption or "",
        "media_type": media_type,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return body

@api.post("/send/text")
async def send_text(body: SendTextIn, _user=Depends(get_current_user)):
    return await _do_send_text(body.session_id, body.to, body.text)

@api.post("/send/media")
async def send_media(session_id: str = Form(...), to: str = Form(...),
                     caption: str = Form(""), media_type: str = Form("image"),
                     file: UploadFile = File(...), _user=Depends(get_current_user)):
    return await _do_send_media(session_id, to, file, caption, media_type)

@api.post("/broadcast")
async def broadcast(body: BroadcastIn, _user=Depends(get_current_user)):
    r = await sidecar_call("POST", f"/sessions/{body.session_id}/broadcast",
                           json={"recipients": body.recipients, "text": body.text})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ------------------- groups -------------------
@api.get("/sessions/{sid}/groups")
async def list_groups(sid: str, _user=Depends(get_current_user)):
    r = await sidecar_call("GET", f"/sessions/{sid}/groups")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@api.post("/groups/create")
async def create_group(body: GroupCreateIn, _user=Depends(get_current_user)):
    r = await sidecar_call("POST", f"/sessions/{body.session_id}/groups",
                           json={"subject": body.subject, "participants": body.participants})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@api.post("/groups/participants")
async def group_participants(body: GroupParticipantsIn, _user=Depends(get_current_user)):
    r = await sidecar_call("POST", f"/sessions/{body.session_id}/groups/{body.group_jid}/participants",
                           json={"action": body.action, "participants": body.participants})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ------------------- rules -------------------
def _doc_out(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc

@api.get("/rules")
async def list_rules(session_id: Optional[str] = None, _user=Depends(get_current_user)):
    q = {"session_id": session_id} if session_id else {}
    items = [_doc_out(d) async for d in db.rules.find(q).sort("created_at", -1)]
    return {"rules": items}

@api.post("/rules")
async def create_rule(body: RuleIn, _user=Depends(get_current_user)):
    doc = body.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.rules.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _doc_out(doc)

@api.put("/rules/{rid}")
async def update_rule(rid: str, body: RuleIn, _user=Depends(get_current_user)):
    await db.rules.update_one({"_id": ObjectId(rid)}, {"$set": body.model_dump()})
    doc = await db.rules.find_one({"_id": ObjectId(rid)})
    return _doc_out(doc)

@api.delete("/rules/{rid}")
async def delete_rule(rid: str, _user=Depends(get_current_user)):
    await db.rules.delete_one({"_id": ObjectId(rid)})
    return {"ok": True}

# ------------------- webhooks -------------------
@api.get("/webhooks")
async def list_webhooks(_user=Depends(get_current_user)):
    items = [_doc_out(d) async for d in db.webhooks.find().sort("created_at", -1)]
    return {"webhooks": items}

@api.post("/webhooks")
async def create_webhook(body: WebhookIn, _user=Depends(get_current_user)):
    doc = body.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["last_fired_at"] = None
    doc["last_status"] = None
    res = await db.webhooks.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _doc_out(doc)

@api.put("/webhooks/{wid}")
async def update_webhook(wid: str, body: WebhookIn, _user=Depends(get_current_user)):
    await db.webhooks.update_one({"_id": ObjectId(wid)}, {"$set": body.model_dump()})
    doc = await db.webhooks.find_one({"_id": ObjectId(wid)})
    return _doc_out(doc)

@api.delete("/webhooks/{wid}")
async def delete_webhook(wid: str, _user=Depends(get_current_user)):
    await db.webhooks.delete_one({"_id": ObjectId(wid)})
    return {"ok": True}

@api.post("/webhooks/{wid}/test")
async def test_webhook(wid: str, _user=Depends(get_current_user)):
    doc = await db.webhooks.find_one({"_id": ObjectId(wid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    payload = {"test": True, "session_id": doc["session_id"], "timestamp": int(datetime.now(timezone.utc).timestamp())}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(doc["url"], json=payload)
        status = f"{r.status_code}"
    except Exception as e:
        status = f"error: {e}"
    await db.webhooks.update_one({"_id": ObjectId(wid)},
                                 {"$set": {"last_fired_at": datetime.now(timezone.utc).isoformat(),
                                           "last_status": status}})
    return {"ok": True, "status": status}

# ------------------- logs -------------------
@api.get("/logs")
async def list_logs(session_id: Optional[str] = None, direction: Optional[str] = None,
                    limit: int = 100, _user=Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if session_id: q["session_id"] = session_id
    if direction: q["direction"] = direction
    limit = min(max(limit, 1), 500)
    items = []
    async for d in db.messages.find(q).sort("timestamp", -1).limit(limit):
        d["id"] = str(d.pop("_id"))
        items.append(d)
    return {"messages": items}

# ------------------- api keys -------------------
@api.get("/api-keys")
async def list_keys(_user=Depends(get_current_user)):
    items = []
    async for d in db.api_keys.find().sort("created_at", -1):
        d["id"] = str(d.pop("_id"))
        # mask key
        k = d.get("key", "")
        d["key_masked"] = (k[:8] + "..." + k[-4:]) if len(k) > 12 else k
        d.pop("key", None)
        items.append(d)
    return {"keys": items}

@api.post("/api-keys")
async def create_key(body: ApiKeyCreateIn, _user=Depends(get_current_user)):
    key = "wak_" + secrets.token_urlsafe(32)
    doc = {"name": body.name, "key": key, "revoked": False,
           "created_at": datetime.now(timezone.utc).isoformat(),
           "last_used_at": None, "usage_count": 0}
    res = await db.api_keys.insert_one(doc)
    return {"id": str(res.inserted_id), "name": body.name, "key": key,
            "message": "Store this key securely - it will not be shown again."}

@api.post("/api-keys/{kid}/revoke")
async def revoke_key(kid: str, _user=Depends(get_current_user)):
    await db.api_keys.update_one({"_id": ObjectId(kid)}, {"$set": {"revoked": True}})
    return {"ok": True}

@api.delete("/api-keys/{kid}")
async def delete_key(kid: str, _user=Depends(get_current_user)):
    await db.api_keys.delete_one({"_id": ObjectId(kid)})
    return {"ok": True}

# ------------------- stats -------------------
@api.get("/stats")
async def stats(_user=Depends(get_current_user)):
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    sessions_resp = await sidecar_call("GET", "/sessions")
    sess_data = sessions_resp.json() if sessions_resp.status_code < 400 else {"sessions": []}
    return {
        "sessions_count": len(sess_data.get("sessions", [])),
        "sessions_connected": sum(1 for s in sess_data.get("sessions", []) if s.get("ready")),
        "rules_count": await db.rules.count_documents({}),
        "webhooks_count": await db.webhooks.count_documents({}),
        "messages_24h": await db.messages.count_documents({"created_at": {"$gte": day_ago}}),
        "api_keys_count": await db.api_keys.count_documents({"revoked": {"$ne": True}}),
    }

# ------------------- public API (bearer) -------------------
@public.post("/send/text", summary="Send text message")
async def public_send_text(body: SendTextIn, _key=Depends(require_api_key)):
    return await _do_send_text(body.session_id, body.to, body.text)

@public.post("/send/media", summary="Send media message")
async def public_send_media(session_id: str = Form(...), to: str = Form(...),
                            caption: str = Form(""), media_type: str = Form("image"),
                            file: UploadFile = File(...), _key=Depends(require_api_key)):
    return await _do_send_media(session_id, to, file, caption, media_type)

@public.post("/broadcast", summary="Broadcast text to multiple recipients")
async def public_broadcast(body: BroadcastIn, _key=Depends(require_api_key)):
    r = await sidecar_call("POST", f"/sessions/{body.session_id}/broadcast",
                           json={"recipients": body.recipients, "text": body.text})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@public.get("/sessions", summary="List sessions and their status")
async def public_list_sessions(_key=Depends(require_api_key)):
    r = await sidecar_call("GET", "/sessions")
    return r.json()

@public.get("/sessions/{sid}/groups", summary="List groups for a session")
async def public_list_groups(sid: str, _key=Depends(require_api_key)):
    r = await sidecar_call("GET", f"/sessions/{sid}/groups")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ------------------- internal (sidecar -> backend) -------------------
async def _match_rule(session_id: str, text: str) -> Optional[dict]:
    if not text:
        return None
    async for r in db.rules.find({"session_id": session_id, "enabled": True}):
        t = (r.get("trigger") or "").strip()
        if not t:
            continue
        mt = r.get("match_type", "contains")
        tx = text.strip()
        matched = False
        if mt == "exact" and tx.lower() == t.lower(): matched = True
        elif mt == "starts_with" and tx.lower().startswith(t.lower()): matched = True
        elif mt == "contains" and t.lower() in tx.lower(): matched = True
        elif mt == "regex":
            import re
            try:
                if re.search(t, tx, flags=re.IGNORECASE): matched = True
            except re.error:
                matched = False
        if matched:
            return r
    return None

async def _fire_webhooks(session_id: str, payload: dict):
    async for wh in db.webhooks.find({"session_id": session_id, "enabled": True}):
        url = wh.get("url")
        if not url:
            continue
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(url, json=payload)
            status = f"{r.status_code}"
        except Exception as e:
            status = f"error: {e}"
        await db.webhooks.update_one({"_id": wh["_id"]},
                                     {"$set": {"last_fired_at": datetime.now(timezone.utc).isoformat(),
                                               "last_status": status}})

@internal.post("/incoming", dependencies=[Depends(require_sidecar_token)])
async def incoming(payload: Dict[str, Any]):
    kind = payload.get("type")
    if kind == "message":
        session_id = payload.get("sessionId")
        doc = {
            "session_id": session_id,
            "direction": payload.get("direction"),
            "remote_jid": payload.get("remoteJid"),
            "message_id": payload.get("messageId"),
            "push_name": payload.get("pushName"),
            "text": payload.get("text") or "",
            "media_type": payload.get("mediaType"),
            "timestamp": payload.get("timestamp") or int(datetime.now(timezone.utc).timestamp()),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.messages.insert_one(doc)

        # Only react to incoming messages
        if payload.get("direction") == "incoming":
            # 1) Fire webhooks
            await _fire_webhooks(session_id, {**doc, "_id": str(doc.get("_id", ""))})
            # 2) Rule-based auto-reply
            rule = await _match_rule(session_id, doc["text"])
            if rule:
                try:
                    await sidecar_call("POST", f"/sessions/{session_id}/send-text",
                                       json={"to": doc["remote_jid"], "text": rule["response"]})
                    await db.messages.insert_one({
                        "session_id": session_id,
                        "direction": "outgoing",
                        "remote_jid": doc["remote_jid"],
                        "message_id": None,
                        "text": rule["response"],
                        "media_type": None,
                        "auto_reply": True,
                        "timestamp": int(datetime.now(timezone.utc).timestamp()),
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception as e:
                    logger.error("Auto-reply failed: %s", e)
        return {"ok": True}
    elif kind == "connection":
        # Just log connection changes for now
        logger.info("Connection update: %s %s", payload.get("sessionId"), payload.get("status"))
        return {"ok": True}
    return {"ok": True}

# ------------------- misc -------------------
@api.get("/health")
async def health():
    try:
        r = await sidecar_call("GET", "/health")
        sidecar_ok = r.status_code == 200
    except Exception:
        sidecar_ok = False
    return {"ok": True, "sidecar": sidecar_ok}

# Register routers
app.include_router(api)
app.include_router(public)
app.include_router(internal)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
