"""
WhatsApp routes: sessions, send, groups, rules, business hours, webhooks, logs, api-keys, stats.
All routes are scoped by owner_id. Session slugs are namespaced per-user before hitting the sidecar.
"""
import re
import secrets
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

from core import (
    db, ws_manager, logger,
    now_iso, today_str, sidecar_id_for, sidecar_headers,
    WA_SIDECAR_URL, ALL_SCOPES, FULL_SCOPES,
    require_active_user, require_scope,
)

router = APIRouter(prefix="/api")

# ---------- Models ----------
class RuleIn(BaseModel):
    session_id: str
    match_type: str = "contains"
    trigger: str
    response: str
    enabled: bool = True

class WebhookIn(BaseModel):
    session_id: str
    url: str
    enabled: bool = True

class ApiKeyCreateIn(BaseModel):
    name: str
    scopes: Optional[List[str]] = None
    rate_limit_per_minute: Optional[int] = 60

class BusinessHoursIn(BaseModel):
    enabled: bool = False
    timezone: str = "UTC"
    days: List[int] = [0, 1, 2, 3, 4]
    start_time: str = "09:00"
    end_time: str = "18:00"
    fallback_message: str = "Thanks for your message! We are currently offline."
    also_use_rules_outside: bool = True

class CreateSessionIn(BaseModel):
    session_id: str  # slug (user-facing)
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

# ---------- Helpers ----------
async def sidecar_call(method: str, path: str, **kwargs) -> httpx.Response:
    url = f"{WA_SIDECAR_URL}{path}"
    headers = kwargs.pop("headers", {}) or {}
    headers.update(sidecar_headers())
    async with httpx.AsyncClient(timeout=30) as c:
        return await c.request(method, url, headers=headers, **kwargs)

async def get_plan_for_user(user: dict) -> dict:
    """Return plan doc (or default with high limits for admin)."""
    if user.get("role") == "admin":
        return {"max_sessions": 999, "max_messages_per_day": 10**9, "max_api_keys": 999}
    if not user.get("current_plan_id"):
        raise HTTPException(status_code=402, detail="No plan assigned.")
    p = await db.plans.find_one({"_id": ObjectId(user["current_plan_id"])})
    if not p:
        raise HTTPException(status_code=402, detail="Plan not found.")
    return p

async def resolve_sidecar_id(owner_id: str, slug: str) -> str:
    """Look up the sidecar_id for a user's session slug."""
    s = await db.sessions.find_one({"owner_id": owner_id, "slug": slug})
    if not s:
        raise HTTPException(status_code=404, detail=f"Session '{slug}' not found")
    return s["sidecar_id"]

async def resolve_or_translate(owner_id: str, slug: str) -> str:
    """Resolve slug to sidecar_id; return sidecar_id."""
    return await resolve_sidecar_id(owner_id, slug)

async def check_and_increment_usage(user: dict, plan: dict, n: int = 1):
    if user.get("role") == "admin":
        return
    max_msgs = int(plan.get("max_messages_per_day") or 0)
    if max_msgs <= 0:
        return
    key = {"user_id": user["id"], "date": today_str()}
    d = await db.daily_usage.find_one(key)
    used = int(d.get("messages_sent", 0)) if d else 0
    if used + n > max_msgs:
        raise HTTPException(status_code=429, detail=f"Daily message limit reached ({max_msgs}). Upgrade or try tomorrow.")
    await db.daily_usage.update_one(key, {"$inc": {"messages_sent": n},
                                          "$setOnInsert": {"user_id": user["id"], "date": today_str()}},
                                    upsert=True)

def _doc_out(d):
    d = dict(d); d["id"] = str(d.pop("_id")); return d

def _serialize_message(m):
    m = dict(m)
    if "_id" in m: m["id"] = str(m.pop("_id"))
    return m

# ---------- Sessions ----------
@router.get("/sessions")
async def list_sessions(user=Depends(require_active_user)):
    """List this user's sessions with live status from sidecar."""
    docs = [s async for s in db.sessions.find({"owner_id": user["id"]}).sort("created_at", 1)]
    if not docs:
        return {"sessions": []}
    r = await sidecar_call("GET", "/sessions")
    sidecar_list = (r.json() if r.status_code < 400 else {}).get("sessions", [])
    live = {s["id"]: s for s in sidecar_list}
    out = []
    for d in docs:
        s = live.get(d["sidecar_id"], {})
        out.append({
            "id": d["slug"],
            "slug": d["slug"],
            "status": s.get("status", "unknown"),
            "ready": s.get("ready", False),
            "hasQr": s.get("hasQr", False),
            "pairingCode": s.get("pairingCode"),
            "me": s.get("me"),
            "lastError": s.get("lastError"),
        })
    return {"sessions": out}

@router.post("/sessions")
async def create_session(body: CreateSessionIn, user=Depends(require_active_user)):
    slug = body.session_id.strip()
    if not re.match(r"^[a-z0-9][a-z0-9\-_]{0,30}$", slug):
        raise HTTPException(status_code=400, detail="Session slug: lowercase, digits, dash, underscore only (max 31 chars).")

    # Enforce plan limit
    plan = await get_plan_for_user(user)
    if user.get("role") != "admin":
        cur = await db.sessions.count_documents({"owner_id": user["id"]})
        if cur >= int(plan.get("max_sessions", 1)):
            raise HTTPException(status_code=402, detail=f"Plan limit reached: max {plan['max_sessions']} session(s). Upgrade to add more.")

    # Uniqueness for this owner
    if await db.sessions.find_one({"owner_id": user["id"], "slug": slug}):
        raise HTTPException(status_code=409, detail="Session slug already exists.")
    sidecar_id = sidecar_id_for(user["id"], slug)

    r = await sidecar_call("POST", "/sessions", json={
        "sessionId": sidecar_id,
        "usePairingCode": body.use_pairing_code,
        "phoneNumber": body.phone_number,
    })
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    await db.sessions.insert_one({
        "owner_id": user["id"], "slug": slug, "sidecar_id": sidecar_id,
        "created_at": now_iso(),
    })
    return {"ok": True, "id": slug, "status": r.json().get("status")}

@router.get("/sessions/{slug}")
async def get_session(slug: str, user=Depends(require_active_user)):
    sid = await resolve_sidecar_id(user["id"], slug)
    r = await sidecar_call("GET", f"/sessions/{sid}")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    data = r.json()
    data["id"] = slug
    return data

@router.delete("/sessions/{slug}")
async def delete_session(slug: str, user=Depends(require_active_user)):
    sid = await resolve_sidecar_id(user["id"], slug)
    await sidecar_call("DELETE", f"/sessions/{sid}")
    await db.sessions.delete_one({"owner_id": user["id"], "slug": slug})
    await db.rules.delete_many({"owner_id": user["id"], "session_id": slug})
    await db.webhooks.delete_many({"owner_id": user["id"], "session_id": slug})
    await db.business_hours.delete_many({"owner_id": user["id"], "session_id": slug})
    return {"ok": True}

@router.post("/sessions/{slug}/pair")
async def pair_session(slug: str, phone_number: str = Form(...), user=Depends(require_active_user)):
    sid = await resolve_sidecar_id(user["id"], slug)
    r = await sidecar_call("POST", f"/sessions/{sid}/pair", json={"phoneNumber": phone_number})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ---------- Send ----------
async def _do_send_text(user: dict, slug: str, to: str, text: str) -> dict:
    plan = await get_plan_for_user(user)
    await check_and_increment_usage(user, plan, 1)
    sid = await resolve_sidecar_id(user["id"], slug)
    r = await sidecar_call("POST", f"/sessions/{sid}/send-text", json={"to": to, "text": text})
    body = r.json()
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=body)
    doc = {
        "owner_id": user["id"], "session_id": slug, "sidecar_id": sid,
        "direction": "outgoing", "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"),
        "text": text, "media_type": None, "status": "pending",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": now_iso(),
    }
    res = await db.messages.insert_one(doc)
    doc["id"] = str(res.inserted_id); doc.pop("_id", None)
    await ws_manager.send_to(user["id"], {"type": "message", "message": _serialize_message(doc)})
    return body

async def _do_send_media(user: dict, slug: str, file: UploadFile, caption: str, media_type: str) -> dict:
    plan = await get_plan_for_user(user)
    await check_and_increment_usage(user, plan, 1)
    sid = await resolve_sidecar_id(user["id"], slug)
    content = await file.read()
    files = {"file": (file.filename or "file", content, file.content_type or "application/octet-stream")}
    data = {"to": file.filename and "" or "", "mediaType": media_type,
            "filename": file.filename or "file", "mimetype": file.content_type or ""}
    # ('to' provided by caller separately - overriding here)
    raise RuntimeError("unused")  # placeholder to satisfy static analysis; real path below

@router.post("/send/text")
async def send_text(body: SendTextIn, user=Depends(require_active_user)):
    return await _do_send_text(user, body.session_id, body.to, body.text)

@router.post("/send/media")
async def send_media(session_id: str = Form(...), to: str = Form(...),
                     caption: str = Form(""), media_type: str = Form("image"),
                     file: UploadFile = File(...), user=Depends(require_active_user)):
    plan = await get_plan_for_user(user)
    await check_and_increment_usage(user, plan, 1)
    sid = await resolve_sidecar_id(user["id"], session_id)
    content = await file.read()
    files = {"file": (file.filename or "file", content, file.content_type or "application/octet-stream")}
    data = {"to": to, "caption": caption or "", "mediaType": media_type,
            "filename": file.filename or "file", "mimetype": file.content_type or ""}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WA_SIDECAR_URL}/sessions/{sid}/send-media",
                         headers=sidecar_headers(), files=files, data=data)
    body = r.json()
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=body)
    doc = {
        "owner_id": user["id"], "session_id": session_id, "sidecar_id": sid,
        "direction": "outgoing", "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"),
        "text": caption or "", "media_type": media_type, "status": "pending",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": now_iso(),
    }
    res = await db.messages.insert_one(doc)
    doc["id"] = str(res.inserted_id); doc.pop("_id", None)
    await ws_manager.send_to(user["id"], {"type": "message", "message": _serialize_message(doc)})
    return body

@router.post("/broadcast")
async def broadcast_admin(body: BroadcastIn, user=Depends(require_active_user)):
    plan = await get_plan_for_user(user)
    await check_and_increment_usage(user, plan, len(body.recipients))
    sid = await resolve_sidecar_id(user["id"], body.session_id)
    r = await sidecar_call("POST", f"/sessions/{sid}/broadcast",
                           json={"recipients": body.recipients, "text": body.text})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ---------- Groups ----------
@router.get("/sessions/{slug}/groups")
async def list_groups(slug: str, user=Depends(require_active_user)):
    sid = await resolve_sidecar_id(user["id"], slug)
    r = await sidecar_call("GET", f"/sessions/{sid}/groups")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@router.post("/groups/create")
async def create_group(body: GroupCreateIn, user=Depends(require_active_user)):
    sid = await resolve_sidecar_id(user["id"], body.session_id)
    r = await sidecar_call("POST", f"/sessions/{sid}/groups",
                           json={"subject": body.subject, "participants": body.participants})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@router.post("/groups/participants")
async def group_participants(body: GroupParticipantsIn, user=Depends(require_active_user)):
    sid = await resolve_sidecar_id(user["id"], body.session_id)
    r = await sidecar_call("POST", f"/sessions/{sid}/groups/{body.group_jid}/participants",
                           json={"action": body.action, "participants": body.participants})
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

# ---------- Rules ----------
@router.get("/rules")
async def list_rules(session_id: Optional[str] = None, user=Depends(require_active_user)):
    q: Dict[str, Any] = {"owner_id": user["id"]}
    if session_id: q["session_id"] = session_id
    items = [_doc_out(d) async for d in db.rules.find(q).sort("created_at", -1)]
    return {"rules": items}

@router.post("/rules")
async def create_rule(body: RuleIn, user=Depends(require_active_user)):
    # Ensure they own the session
    await resolve_sidecar_id(user["id"], body.session_id)
    doc = body.model_dump()
    doc["owner_id"] = user["id"]; doc["created_at"] = now_iso()
    res = await db.rules.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _doc_out(doc)

@router.put("/rules/{rid}")
async def update_rule(rid: str, body: RuleIn, user=Depends(require_active_user)):
    r = await db.rules.find_one({"_id": ObjectId(rid), "owner_id": user["id"]})
    if not r: raise HTTPException(status_code=404, detail="Not found")
    await resolve_sidecar_id(user["id"], body.session_id)
    upd = body.model_dump()
    await db.rules.update_one({"_id": ObjectId(rid)}, {"$set": upd})
    doc = await db.rules.find_one({"_id": ObjectId(rid)})
    return _doc_out(doc)

@router.delete("/rules/{rid}")
async def delete_rule(rid: str, user=Depends(require_active_user)):
    r = await db.rules.delete_one({"_id": ObjectId(rid), "owner_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

# ---------- Business Hours ----------
DEFAULT_BH = {
    "enabled": False, "timezone": "UTC", "days": [0, 1, 2, 3, 4],
    "start_time": "09:00", "end_time": "18:00",
    "fallback_message": "Thanks for your message! We are currently offline.",
    "also_use_rules_outside": True,
}

@router.get("/business-hours/{slug}")
async def get_business_hours(slug: str, user=Depends(require_active_user)):
    await resolve_sidecar_id(user["id"], slug)
    doc = await db.business_hours.find_one({"owner_id": user["id"], "session_id": slug})
    if not doc:
        return {"session_id": slug, **DEFAULT_BH}
    doc.pop("_id", None)
    return doc

@router.put("/business-hours/{slug}")
async def set_business_hours(slug: str, body: BusinessHoursIn, user=Depends(require_active_user)):
    await resolve_sidecar_id(user["id"], slug)
    data = body.model_dump()
    for k in ("start_time", "end_time"):
        if not re.match(r"^\d{2}:\d{2}$", data[k]):
            raise HTTPException(status_code=400, detail=f"{k} must be HH:MM")
    try:
        ZoneInfo(data["timezone"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timezone (use tz database name, e.g. Asia/Kolkata)")
    data.update({"owner_id": user["id"], "session_id": slug, "updated_at": now_iso()})
    await db.business_hours.update_one(
        {"owner_id": user["id"], "session_id": slug},
        {"$set": data}, upsert=True
    )
    data.pop("_id", None)
    return data

# ---------- Webhooks ----------
@router.get("/webhooks")
async def list_webhooks(user=Depends(require_active_user)):
    items = [_doc_out(d) async for d in db.webhooks.find({"owner_id": user["id"]}).sort("created_at", -1)]
    return {"webhooks": items}

@router.post("/webhooks")
async def create_webhook(body: WebhookIn, user=Depends(require_active_user)):
    await resolve_sidecar_id(user["id"], body.session_id)
    doc = body.model_dump()
    doc["owner_id"] = user["id"]; doc["created_at"] = now_iso()
    doc["last_fired_at"] = None; doc["last_status"] = None
    res = await db.webhooks.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _doc_out(doc)

@router.put("/webhooks/{wid}")
async def update_webhook(wid: str, body: WebhookIn, user=Depends(require_active_user)):
    w = await db.webhooks.find_one({"_id": ObjectId(wid), "owner_id": user["id"]})
    if not w: raise HTTPException(status_code=404, detail="Not found")
    await resolve_sidecar_id(user["id"], body.session_id)
    await db.webhooks.update_one({"_id": ObjectId(wid)}, {"$set": body.model_dump()})
    doc = await db.webhooks.find_one({"_id": ObjectId(wid)})
    return _doc_out(doc)

@router.delete("/webhooks/{wid}")
async def delete_webhook(wid: str, user=Depends(require_active_user)):
    r = await db.webhooks.delete_one({"_id": ObjectId(wid), "owner_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.post("/webhooks/{wid}/test")
async def test_webhook(wid: str, user=Depends(require_active_user)):
    doc = await db.webhooks.find_one({"_id": ObjectId(wid), "owner_id": user["id"]})
    if not doc: raise HTTPException(status_code=404, detail="Not found")
    payload = {"test": True, "session_id": doc["session_id"], "timestamp": int(datetime.now(timezone.utc).timestamp())}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(doc["url"], json=payload)
        status = f"{r.status_code}"
    except Exception as e:
        status = f"error: {e}"
    await db.webhooks.update_one({"_id": ObjectId(wid)},
                                 {"$set": {"last_fired_at": now_iso(), "last_status": status}})
    return {"ok": True, "status": status}

# ---------- Logs ----------
@router.get("/logs")
async def list_logs(session_id: Optional[str] = None, direction: Optional[str] = None,
                    limit: int = 100, user=Depends(require_active_user)):
    q: Dict[str, Any] = {"owner_id": user["id"]}
    if session_id: q["session_id"] = session_id
    if direction: q["direction"] = direction
    limit = min(max(limit, 1), 500)
    items = []
    async for d in db.messages.find(q).sort("timestamp", -1).limit(limit):
        items.append(_serialize_message(d))
    return {"messages": items}

# ---------- API keys ----------
@router.get("/api-keys")
async def list_api_keys(user=Depends(require_active_user)):
    items = []
    async for d in db.api_keys.find({"owner_id": user["id"]}).sort("created_at", -1):
        d["id"] = str(d.pop("_id"))
        k = d.get("key", "")
        d["key_masked"] = (k[:8] + "..." + k[-4:]) if len(k) > 12 else k
        d.pop("key", None)
        items.append(d)
    return {"keys": items, "available_scopes": ALL_SCOPES}

@router.post("/api-keys")
async def create_api_key(body: ApiKeyCreateIn, user=Depends(require_active_user)):
    plan = await get_plan_for_user(user)
    if user.get("role") != "admin":
        cur = await db.api_keys.count_documents({"owner_id": user["id"], "revoked": {"$ne": True}})
        if cur >= int(plan.get("max_api_keys", 1)):
            raise HTTPException(status_code=402, detail=f"Plan limit reached: max {plan['max_api_keys']} API key(s).")
    scopes = body.scopes if body.scopes else FULL_SCOPES
    invalid = [s for s in scopes if s not in ALL_SCOPES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid scopes: {invalid}. Allowed: {ALL_SCOPES}")
    key = "wak_" + secrets.token_urlsafe(32)
    doc = {
        "owner_id": user["id"],
        "name": body.name, "key": key, "revoked": False,
        "scopes": scopes, "rate_limit_per_minute": int(body.rate_limit_per_minute or 0),
        "created_at": now_iso(), "last_used_at": None, "usage_count": 0,
    }
    res = await db.api_keys.insert_one(doc)
    return {"id": str(res.inserted_id), "name": body.name, "key": key,
            "scopes": scopes, "rate_limit_per_minute": int(body.rate_limit_per_minute or 0),
            "message": "Store this key securely - it will not be shown again."}

@router.post("/api-keys/{kid}/revoke")
async def revoke_api_key(kid: str, user=Depends(require_active_user)):
    r = await db.api_keys.update_one({"_id": ObjectId(kid), "owner_id": user["id"]}, {"$set": {"revoked": True}})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.delete("/api-keys/{kid}")
async def delete_api_key(kid: str, user=Depends(require_active_user)):
    r = await db.api_keys.delete_one({"_id": ObjectId(kid), "owner_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

# ---------- Stats ----------
@router.get("/stats")
async def stats(user=Depends(require_active_user)):
    from datetime import timedelta
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    docs = [s async for s in db.sessions.find({"owner_id": user["id"]})]
    sidecar_ids = {d["sidecar_id"] for d in docs}
    try:
        r = await sidecar_call("GET", "/sessions")
        sidecar_list = (r.json() if r.status_code < 400 else {}).get("sessions", [])
    except Exception:
        sidecar_list = []
    live_by_id = {s["id"]: s for s in sidecar_list}
    ready_count = sum(1 for sid in sidecar_ids if live_by_id.get(sid, {}).get("ready"))
    return {
        "sessions_count": len(docs),
        "sessions_connected": ready_count,
        "rules_count": await db.rules.count_documents({"owner_id": user["id"]}),
        "webhooks_count": await db.webhooks.count_documents({"owner_id": user["id"]}),
        "messages_24h": await db.messages.count_documents({"owner_id": user["id"], "created_at": {"$gte": day_ago}}),
        "api_keys_count": await db.api_keys.count_documents({"owner_id": user["id"], "revoked": {"$ne": True}}),
    }

# ---------- Public API (Bearer + scopes) ----------
@router.post("/v1/send/text")
async def public_send_text(body: SendTextIn, key=Depends(require_scope("send:text"))):
    user = await db.users.find_one({"_id": ObjectId(key["owner_id"])}) if key.get("owner_id") else None
    if not user: raise HTTPException(status_code=401, detail="Key owner missing")
    from core import _serialize_user  # not exported; inline
    u = dict(user); u["id"] = str(u.pop("_id")); u.pop("password_hash", None)
    return await _do_send_text(u, body.session_id, body.to, body.text)

@router.post("/v1/send/media")
async def public_send_media(session_id: str = Form(...), to: str = Form(...),
                            caption: str = Form(""), media_type: str = Form("image"),
                            file: UploadFile = File(...),
                            key=Depends(require_scope("send:media"))):
    user = await db.users.find_one({"_id": ObjectId(key["owner_id"])}) if key.get("owner_id") else None
    if not user: raise HTTPException(status_code=401, detail="Key owner missing")
    u = dict(user); u["id"] = str(u.pop("_id")); u.pop("password_hash", None)
    plan = await get_plan_for_user(u)
    await check_and_increment_usage(u, plan, 1)
    sid = await resolve_sidecar_id(u["id"], session_id)
    content = await file.read()
    files = {"file": (file.filename or "file", content, file.content_type or "application/octet-stream")}
    data = {"to": to, "caption": caption or "", "mediaType": media_type,
            "filename": file.filename or "file", "mimetype": file.content_type or ""}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WA_SIDECAR_URL}/sessions/{sid}/send-media",
                         headers=sidecar_headers(), files=files, data=data)
    body = r.json()
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=body)
    doc = {
        "owner_id": u["id"], "session_id": session_id, "sidecar_id": sid,
        "direction": "outgoing", "remote_jid": body.get("jid"),
        "message_id": body.get("messageId"), "text": caption or "",
        "media_type": media_type, "status": "pending",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "created_at": now_iso(),
    }
    res = await db.messages.insert_one(doc)
    doc["id"] = str(res.inserted_id); doc.pop("_id", None)
    await ws_manager.send_to(u["id"], {"type": "message", "message": _serialize_message(doc)})
    return body

@router.post("/v1/broadcast")
async def public_broadcast(body: BroadcastIn, key=Depends(require_scope("broadcast"))):
    user = await db.users.find_one({"_id": ObjectId(key["owner_id"])}) if key.get("owner_id") else None
    if not user: raise HTTPException(status_code=401, detail="Key owner missing")
    u = dict(user); u["id"] = str(u.pop("_id")); u.pop("password_hash", None)
    plan = await get_plan_for_user(u)
    await check_and_increment_usage(u, plan, len(body.recipients))
    sid = await resolve_sidecar_id(u["id"], body.session_id)
    r = await sidecar_call("POST", f"/sessions/{sid}/broadcast",
                           json={"recipients": body.recipients, "text": body.text})
    if r.status_code >= 400: raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@router.get("/v1/sessions")
async def public_list_sessions(key=Depends(require_scope("sessions:read"))):
    docs = [s async for s in db.sessions.find({"owner_id": key["owner_id"]})]
    if not docs: return {"sessions": []}
    r = await sidecar_call("GET", "/sessions")
    live = {s["id"]: s for s in (r.json().get("sessions", []) if r.status_code < 400 else [])}
    out = []
    for d in docs:
        s = live.get(d["sidecar_id"], {})
        out.append({"id": d["slug"], "status": s.get("status", "unknown"),
                    "ready": s.get("ready", False), "me": s.get("me"),
                    "hasQr": s.get("hasQr", False)})
    return {"sessions": out}

@router.get("/v1/sessions/{slug}/groups")
async def public_list_groups(slug: str, key=Depends(require_scope("groups:read"))):
    s = await db.sessions.find_one({"owner_id": key["owner_id"], "slug": slug})
    if not s: raise HTTPException(status_code=404, detail="Session not found")
    r = await sidecar_call("GET", f"/sessions/{s['sidecar_id']}/groups")
    if r.status_code >= 400: raise HTTPException(status_code=r.status_code, detail=r.json())
    return r.json()

@router.get("/v1/logs")
async def public_logs(session_id: Optional[str] = None, direction: Optional[str] = None,
                      limit: int = 100, key=Depends(require_scope("logs:read"))):
    q: Dict[str, Any] = {"owner_id": key["owner_id"]}
    if session_id: q["session_id"] = session_id
    if direction: q["direction"] = direction
    limit = min(max(limit, 1), 500)
    items = []
    async for d in db.messages.find(q).sort("timestamp", -1).limit(limit):
        items.append(_serialize_message(d))
    return {"messages": items}
