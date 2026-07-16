"""
Unofficial WhatsApp API server.
Talks to a local Node.js Baileys sidecar for actual WhatsApp connections.

Features:
  - Admin auth (JWT + cookies) with brute-force lockout
  - Dashboard APIs (sessions, rules, webhooks, logs, api keys, stats, business-hours)
  - Public API (Bearer API key) - /api/v1/* with scopes + rate limits
  - Internal callbacks from sidecar (incoming messages, message status, connection)
  - WebSocket push to dashboard - /api/ws
"""

from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import asyncio
import secrets
import logging
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta, time as dtime
from typing import List, Optional, Any, Dict, Set
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

import bcrypt
import httpx
import jwt
from bson import ObjectId
from fastapi import (
    FastAPI, APIRouter, HTTPException, Request, Response, Depends,
    UploadFile, File, Form, Header, WebSocket, WebSocketDisconnect,
)
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr

# ------------------- config -------------------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@example.com').lower()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
WA_SIDECAR_URL = os.environ.get('WA_SIDECAR_URL', 'http://localhost:3002').rstrip('/')
SIDECAR_TOKEN = os.environ.get('SIDECAR_TOKEN', '')
FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', '').strip()  # e.g. https://mydomain.com
COOKIE_SECURE = os.environ.get('COOKIE_SECURE', '').lower() in {'1', 'true', 'yes'}
COOKIE_SAMESITE = os.environ.get('COOKIE_SAMESITE', 'lax')

# Brute force config
LOGIN_MAX_FAILS = 5
LOGIN_LOCKOUT_MINUTES = 15

# All available API-key scopes (used for validation/UI)
ALL_SCOPES = [
    "send:text", "send:media", "broadcast",
    "sessions:read", "groups:read", "groups:write", "logs:read",
]
FULL_SCOPES = ALL_SCOPES  # default when user picks "all"

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

logger = logging.getLogger("whatsapp-api")
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')

app = FastAPI(title="Unofficial WhatsApp API", version="1.1.0",
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

def _cookie_kwargs(max_age: int):
    return dict(httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=max_age, path="/")

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, **_cookie_kwargs(43200))
    response.set_cookie("refresh_token", refresh, **_cookie_kwargs(604800))

def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

async def _get_user_from_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            return None
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            return None
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.PyJWTError:
        return None

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await _get_user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user

# ------------------- rate limiter (in-memory sliding window per key) -------------------
_rate_windows: Dict[str, deque] = defaultdict(deque)
_rate_lock = asyncio.Lock()

async def _rate_check(key_id: str, limit_per_minute: int) -> None:
    if not limit_per_minute or limit_per_minute <= 0:
        return
    now = datetime.now(timezone.utc).timestamp()
    async with _rate_lock:
        window = _rate_windows[key_id]
        while window and (now - window[0]) > 60:
            window.popleft()
        if len(window) >= limit_per_minute:
            retry = int(60 - (now - window[0]))
            raise HTTPException(status_code=429, detail=f"Rate limit exceeded. Retry in {retry}s.")
        window.append(now)

def require_scope(*needed: str):
    """FastAPI dependency factory: enforces one of the given scopes on the caller's API key."""
    needed_set = set(needed)
    async def _dep(authorization: Optional[str] = Header(None)) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")
        key = authorization[7:].strip()
        doc = await db.api_keys.find_one({"key": key, "revoked": {"$ne": True}})
        if not doc:
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")
        scopes = set(doc.get("scopes") or [])
        if needed_set and not (needed_set & scopes):
            raise HTTPException(status_code=403, detail=f"Missing required scope: one of {sorted(needed_set)}")
        await _rate_check(str(doc["_id"]), int(doc.get("rate_limit_per_minute") or 0))
        await db.api_keys.update_one({"_id": doc["_id"]},
                                     {"$set": {"last_used_at": datetime.now(timezone.utc).isoformat()},
                                      "$inc": {"usage_count": 1}})
        doc["_id"] = str(doc["_id"])
        return doc
    return _dep

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

# ------------------- websocket manager -------------------
class WSManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self.lock:
            self.active.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self.lock:
            self.active.discard(ws)

    async def broadcast(self, message: dict):
        stale: List[WebSocket] = []
        async with self.lock:
            targets = list(self.active)
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(ws)
        if stale:
            async with self.lock:
                for s in stale:
                    self.active.discard(s)

ws_manager = WSManager()

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
    scopes: Optional[List[str]] = None       # None or [] → full access
    rate_limit_per_minute: Optional[int] = 60

class BusinessHoursIn(BaseModel):
    enabled: bool = False
    timezone: str = "UTC"
    days: List[int] = [0, 1, 2, 3, 4]   # 0=Mon .. 6=Sun
    start_time: str = "09:00"
    end_time: str = "18:00"
    fallback_message: str = "Thanks for your message! Our team is currently offline. We'll get back to you during business hours."
    also_use_rules_outside: bool = True   # if True: also run keyword rules outside hours; if False: only fallback

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
    action: str
    participants: List[str]

# ------------------- startup -------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.api_keys.create_index("key", unique=True)
    await db.rules.create_index("session_id")
    await db.webhooks.create_index("session_id")
    await db.messages.create_index([("session_id", 1), ("timestamp", -1)])
    await db.messages.create_index("message_id")
    await db.messages.create_index("created_at")
    await db.business_hours.create_index("session_id", unique=True)

    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if existing is None:
        await db.users.insert_one({
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Admin",
            "role": "admin",
            "failed_logins": 0,
            "locked_until": None,
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
    now = datetime.now(timezone.utc)

    if user:
        locked_until = user.get("locked_until")
        if locked_until:
            try:
                lu = datetime.fromisoformat(locked_until)
                if lu.tzinfo is None:
                    lu = lu.replace(tzinfo=timezone.utc)
                if now < lu:
                    remaining = int((lu - now).total_seconds() // 60) + 1
                    raise HTTPException(status_code=429,
                                        detail=f"Account locked. Try again in {remaining} minute(s).")
            except (ValueError, TypeError):
                pass

    if not user or not verify_password(body.password, user["password_hash"]):
        if user:
            fails = int(user.get("failed_logins") or 0) + 1
            update = {"failed_logins": fails}
            if fails >= LOGIN_MAX_FAILS:
                update["locked_until"] = (now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)).isoformat()
                update["failed_logins"] = 0
            await db.users.update_one({"_id": user["_id"]}, {"$set": update})
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Success → reset counters
    await db.users.update_one({"_id": user["_id"]},
                              {"$set": {"failed_logins": 0, "locked_until": None,
                                        "last_login_at": now.isoformat()}})
    uid = str(user["_id"])
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"id": uid, "email": email, "name": user.get("name"), "role": user.get("role")}

@api.post("/auth/logout")
async def logout(response: Response):
    # Token-optional: always clear cookies so an expired session can still sign out
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
        response.set_cookie("access_token", access, **_cookie_kwargs(43200))
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
    await db.rules.delete_many({"session_id": sid})
    await db.webhooks.delete_many({"session_id": sid})
    await db.business_hours.delete_many({"session_id": sid})
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
    doc = {
        "session_id": session_id,
        "direction": "outgoing",
        "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"),
        "text": text,
        "media_type": None,
        "status": "pending",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.messages.insert_one(doc)
    doc["id"] = str(res.inserted_id); doc.pop("_id", None)
    await ws_manager.broadcast({"type": "message", "message": _serialize_message(doc)})
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
    doc = {
        "session_id": session_id,
        "direction": "outgoing",
        "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"),
        "text": caption or "",
        "media_type": media_type,
        "status": "pending",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.messages.insert_one(doc)
    doc["id"] = str(res.inserted_id); doc.pop("_id", None)
    await ws_manager.broadcast({"type": "message", "message": _serialize_message(doc)})
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
async def broadcast_admin(body: BroadcastIn, _user=Depends(get_current_user)):
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

# ------------------- business hours -------------------
DEFAULT_BH = {
    "enabled": False, "timezone": "UTC",
    "days": [0, 1, 2, 3, 4], "start_time": "09:00", "end_time": "18:00",
    "fallback_message": "Thanks for your message! Our team is currently offline. We'll get back to you during business hours.",
    "also_use_rules_outside": True,
}

@api.get("/business-hours/{session_id}")
async def get_business_hours(session_id: str, _user=Depends(get_current_user)):
    doc = await db.business_hours.find_one({"session_id": session_id})
    if not doc:
        return {"session_id": session_id, **DEFAULT_BH}
    doc.pop("_id", None)
    return doc

@api.put("/business-hours/{session_id}")
async def set_business_hours(session_id: str, body: BusinessHoursIn, _user=Depends(get_current_user)):
    data = body.model_dump()
    # Basic validation
    for k in ("start_time", "end_time"):
        if not re.match(r"^\d{2}:\d{2}$", data[k]):
            raise HTTPException(status_code=400, detail=f"{k} must be HH:MM")
    try:
        ZoneInfo(data["timezone"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timezone (use tz database name, e.g. Asia/Kolkata)")
    data["session_id"] = session_id
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.business_hours.update_one({"session_id": session_id}, {"$set": data}, upsert=True)
    data.pop("_id", None)
    return data

def _parse_hhmm(s: str) -> dtime:
    h, m = s.split(":")
    return dtime(int(h), int(m))

def _is_within_business_hours(bh: dict) -> bool:
    """Return True if 'now' in the configured timezone is inside business hours."""
    try:
        tz = ZoneInfo(bh.get("timezone") or "UTC")
    except Exception:
        tz = timezone.utc
    now = datetime.now(tz)
    if now.weekday() not in (bh.get("days") or []):
        return False
    start = _parse_hhmm(bh.get("start_time") or "09:00")
    end = _parse_hhmm(bh.get("end_time") or "18:00")
    t = now.time().replace(second=0, microsecond=0)
    if start <= end:
        return start <= t < end
    # overnight window (e.g. 22:00 -> 06:00)
    return t >= start or t < end

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
def _serialize_message(m: dict) -> dict:
    m = dict(m)
    if "_id" in m:
        m["id"] = str(m.pop("_id"))
    return m

@api.get("/logs")
async def list_logs(session_id: Optional[str] = None, direction: Optional[str] = None,
                    limit: int = 100, _user=Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if session_id: q["session_id"] = session_id
    if direction: q["direction"] = direction
    limit = min(max(limit, 1), 500)
    items = []
    async for d in db.messages.find(q).sort("timestamp", -1).limit(limit):
        items.append(_serialize_message(d))
    return {"messages": items}

# ------------------- api keys -------------------
@api.get("/api-keys")
async def list_keys(_user=Depends(get_current_user)):
    items = []
    async for d in db.api_keys.find().sort("created_at", -1):
        d["id"] = str(d.pop("_id"))
        k = d.get("key", "")
        d["key_masked"] = (k[:8] + "..." + k[-4:]) if len(k) > 12 else k
        d.pop("key", None)
        items.append(d)
    return {"keys": items, "available_scopes": ALL_SCOPES}

@api.post("/api-keys")
async def create_key(body: ApiKeyCreateIn, _user=Depends(get_current_user)):
    scopes = body.scopes if body.scopes else FULL_SCOPES
    invalid = [s for s in scopes if s not in ALL_SCOPES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid scopes: {invalid}. Allowed: {ALL_SCOPES}")
    rate = int(body.rate_limit_per_minute or 0)
    key = "wak_" + secrets.token_urlsafe(32)
    doc = {"name": body.name, "key": key, "revoked": False,
           "scopes": scopes, "rate_limit_per_minute": rate,
           "created_at": datetime.now(timezone.utc).isoformat(),
           "last_used_at": None, "usage_count": 0}
    res = await db.api_keys.insert_one(doc)
    return {"id": str(res.inserted_id), "name": body.name, "key": key,
            "scopes": scopes, "rate_limit_per_minute": rate,
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
    try:
        sessions_resp = await sidecar_call("GET", "/sessions")
        sess_data = sessions_resp.json() if sessions_resp.status_code < 400 else {"sessions": []}
    except Exception:
        sess_data = {"sessions": []}
    return {
        "sessions_count": len(sess_data.get("sessions", [])),
        "sessions_connected": sum(1 for s in sess_data.get("sessions", []) if s.get("ready")),
        "rules_count": await db.rules.count_documents({}),
        "webhooks_count": await db.webhooks.count_documents({}),
        "messages_24h": await db.messages.count_documents({"created_at": {"$gte": day_ago}}),
        "api_keys_count": await db.api_keys.count_documents({"revoked": {"$ne": True}}),
    }

# ------------------- public API (bearer + scopes) -------------------
@public.post("/send/text", summary="Send text message")
async def public_send_text(body: SendTextIn, _key=Depends(require_scope("send:text"))):
    return await _do_send_text(body.session_id, body.to, body.text)

@public.post("/send/media", summary="Send media message")
async def public_send_media(session_id: str = Form(...), to: str = Form(...),
                            caption: str = Form(""), media_type: str = Form("image"),
                            file: UploadFile = File(...),
                            _key=Depends(require_scope("send:media"))):
    return await _do_send_media(session_id, to, file, caption, media_type)

@public.post("/broadcast", summary="Broadcast text to multiple recipients")
async def public_broadcast(body: BroadcastIn, _key=Depends(require_scope("broadcast"))):
    r = await sidecar_call("POST", f"/sessions/{body.session_id}/broadcast",
                           json={"recipients": body.recipients, "text": body.text})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@public.get("/sessions", summary="List sessions and their status")
async def public_list_sessions(_key=Depends(require_scope("sessions:read"))):
    r = await sidecar_call("GET", "/sessions")
    return r.json()

@public.get("/sessions/{sid}/groups", summary="List groups for a session")
async def public_list_groups(sid: str, _key=Depends(require_scope("groups:read"))):
    r = await sidecar_call("GET", f"/sessions/{sid}/groups")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@public.get("/logs", summary="Read recent messages")
async def public_logs(session_id: Optional[str] = None, direction: Optional[str] = None,
                      limit: int = 100, _key=Depends(require_scope("logs:read"))):
    q: Dict[str, Any] = {}
    if session_id: q["session_id"] = session_id
    if direction: q["direction"] = direction
    limit = min(max(limit, 1), 500)
    items = []
    async for d in db.messages.find(q).sort("timestamp", -1).limit(limit):
        items.append(_serialize_message(d))
    return {"messages": items}

# ------------------- rule engine + webhook fan-out -------------------
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
        if not url: continue
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(url, json=payload)
            status = f"{r.status_code}"
        except Exception as e:
            status = f"error: {e}"
        await db.webhooks.update_one({"_id": wh["_id"]},
                                     {"$set": {"last_fired_at": datetime.now(timezone.utc).isoformat(),
                                               "last_status": status}})

async def _auto_reply(session_id: str, remote_jid: str, text: str):
    """Business-hours-aware auto-reply."""
    bh_doc = await db.business_hours.find_one({"session_id": session_id})
    within_hours = False
    bh_enabled = False
    if bh_doc:
        bh_enabled = bool(bh_doc.get("enabled"))
        if bh_enabled:
            within_hours = _is_within_business_hours(bh_doc)

    # During business hours (and BH mode ON) → let humans handle it, no auto-reply
    if bh_enabled and within_hours:
        return

    # Outside business hours (or BH disabled)
    reply_text: Optional[str] = None
    used = None

    # Try matching a keyword rule first (if allowed)
    if not bh_enabled or bh_doc.get("also_use_rules_outside", True):
        rule = await _match_rule(session_id, text)
        if rule:
            reply_text = rule["response"]
            used = "rule"

    # Fallback message if BH is on and no rule matched
    if reply_text is None and bh_enabled and not within_hours:
        fb = (bh_doc.get("fallback_message") or "").strip()
        if fb:
            reply_text = fb
            used = "fallback"

    if not reply_text:
        return

    try:
        r = await sidecar_call("POST", f"/sessions/{session_id}/send-text",
                               json={"to": remote_jid, "text": reply_text})
        body = r.json() if r.content else {}
        doc = {
            "session_id": session_id,
            "direction": "outgoing",
            "remote_jid": remote_jid,
            "message_id": body.get("messageId"),
            "text": reply_text,
            "media_type": None,
            "status": "pending",
            "auto_reply": True,
            "auto_reply_kind": used,
            "timestamp": int(datetime.now(timezone.utc).timestamp()),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        res = await db.messages.insert_one(doc)
        doc["id"] = str(res.inserted_id); doc.pop("_id", None)
        await ws_manager.broadcast({"type": "message", "message": _serialize_message(doc)})
    except Exception as e:
        logger.error("Auto-reply send failed: %s", e)

# ------------------- internal (sidecar -> backend) -------------------
STATUS_MAP = {
    1: "pending",
    2: "sent",
    3: "delivered",
    4: "read",
    5: "played",
}

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
            "status": "delivered" if payload.get("direction") == "incoming" else "pending",
            "timestamp": payload.get("timestamp") or int(datetime.now(timezone.utc).timestamp()),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        res = await db.messages.insert_one(doc)
        doc["id"] = str(res.inserted_id); doc.pop("_id", None)
        await ws_manager.broadcast({"type": "message", "message": _serialize_message(doc)})

        if payload.get("direction") == "incoming":
            await _fire_webhooks(session_id, {**doc})
            await _auto_reply(session_id, doc["remote_jid"], doc["text"])
        return {"ok": True}

    if kind == "status":
        session_id = payload.get("sessionId")
        message_id = payload.get("messageId")
        raw = payload.get("status")
        # Baileys emits numeric status; map to label
        status = STATUS_MAP.get(int(raw), None) if isinstance(raw, (int, float, str)) and str(raw).isdigit() else raw
        if not message_id or not status:
            return {"ok": True}
        await db.messages.update_one(
            {"session_id": session_id, "message_id": message_id},
            {"$set": {"status": status}}
        )
        await ws_manager.broadcast({"type": "status", "session_id": session_id,
                                    "message_id": message_id, "status": status})
        return {"ok": True}

    if kind == "connection":
        await ws_manager.broadcast({
            "type": "connection",
            "session_id": payload.get("sessionId"),
            "status": payload.get("status"),
            "pairing_code": payload.get("pairingCode"),
            "error": payload.get("error"),
        })
        logger.info("Connection update: %s %s", payload.get("sessionId"), payload.get("status"))
        return {"ok": True}

    return {"ok": True}

# ------------------- websocket -------------------
@app.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket):
    # Auth via access_token cookie
    token = websocket.cookies.get("access_token")
    user = await _get_user_from_token(token) if token else None
    if not user:
        await websocket.close(code=4401)
        return
    await ws_manager.connect(websocket)
    try:
        await websocket.send_json({"type": "hello", "user": user["email"]})
        while True:
            # Keep-alive: read anything the client sends (heartbeats), ignore content
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=45)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(websocket)

# ------------------- misc -------------------
@api.get("/health")
async def health():
    try:
        r = await sidecar_call("GET", "/health")
        sidecar_ok = r.status_code == 200
    except Exception:
        sidecar_ok = False
    return {"ok": True, "sidecar": sidecar_ok, "version": app.version}

# Register routers
app.include_router(api)
app.include_router(public)
app.include_router(internal)

# CORS: tighten when FRONTEND_ORIGIN is set (needed for cookie auth cross-origin)
if FRONTEND_ORIGIN:
    origins = [o.strip() for o in FRONTEND_ORIGIN.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # Same-origin (via ingress) — cookies work; permissive for public API v1 usage
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=False,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
