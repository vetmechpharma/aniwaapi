"""
Auth (login/logout/me/refresh) + internal sidecar callback + WebSocket endpoint.
"""
import asyncio
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, EmailStr

from core import (
    db, ws_manager, logger,
    JWT_SECRET, JWT_ALG,
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    set_auth_cookies, clear_auth_cookies, _cookie_kwargs,
    get_current_user, _get_user_from_token, require_sidecar_token,
    LOGIN_MAX_FAILS, LOGIN_LOCKOUT_MINUTES,
    now_iso,
)

import jwt

auth_router = APIRouter(prefix="/api/auth")
internal_router = APIRouter(prefix="/api/internal")

# ---------- Auth ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

@auth_router.post("/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    now = datetime.now(timezone.utc)
    if user:
        locked_until = user.get("locked_until")
        if locked_until:
            try:
                lu = datetime.fromisoformat(locked_until)
                if lu.tzinfo is None: lu = lu.replace(tzinfo=timezone.utc)
                if now < lu:
                    remaining = int((lu - now).total_seconds() // 60) + 1
                    raise HTTPException(status_code=429, detail=f"Account locked. Try again in {remaining} minute(s).")
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

    # Check status
    status = user.get("status") or "pending"
    if status == "pending":
        raise HTTPException(status_code=403, detail="Account pending admin approval.")
    if status == "suspended":
        raise HTTPException(status_code=403, detail=f"Account suspended. {user.get('suspend_reason') or 'Contact admin.'}")
    if status == "deleted":
        raise HTTPException(status_code=403, detail="Account deleted.")

    await db.users.update_one({"_id": user["_id"]}, {"$set": {
        "failed_logins": 0, "locked_until": None, "last_login_at": now.isoformat()
    }})
    uid = str(user["_id"])
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    u = dict(user); u["id"] = str(u.pop("_id")); u.pop("password_hash", None)
    return u

@auth_router.post("/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}

@auth_router.get("/me")
async def me(user=Depends(get_current_user)):
    return user

@auth_router.post("/refresh")
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

# ---------- Internal callback (sidecar -> backend) ----------
STATUS_MAP = {1: "pending", 2: "sent", 3: "delivered", 4: "read", 5: "played"}

async def _resolve_owner_by_sidecar_id(sidecar_id: str):
    s = await db.sessions.find_one({"sidecar_id": sidecar_id})
    if not s: return None, None
    return s["owner_id"], s["slug"]

async def _match_rule(owner_id: str, session_slug: str, text: str):
    if not text: return None
    async for r in db.rules.find({"owner_id": owner_id, "session_id": session_slug, "enabled": True}):
        t = (r.get("trigger") or "").strip()
        if not t: continue
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
        if matched: return r
    return None

def _within_bh(bh: dict) -> bool:
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    from datetime import time as dtime
    try:
        tz = ZoneInfo(bh.get("timezone") or "UTC")
    except Exception:
        tz = timezone.utc
    now = datetime.now(tz)
    if now.weekday() not in (bh.get("days") or []): return False
    def parse(s):
        h, m = s.split(":"); return dtime(int(h), int(m))
    start = parse(bh.get("start_time") or "09:00")
    end = parse(bh.get("end_time") or "18:00")
    t = now.time().replace(second=0, microsecond=0)
    if start <= end:
        return start <= t < end
    return t >= start or t < end

async def _fire_webhooks(owner_id: str, session_slug: str, payload: dict):
    async for wh in db.webhooks.find({"owner_id": owner_id, "session_id": session_slug, "enabled": True}):
        url = wh.get("url")
        if not url: continue
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(url, json=payload)
            status = f"{r.status_code}"
        except Exception as e:
            status = f"error: {e}"
        await db.webhooks.update_one({"_id": wh["_id"]},
                                     {"$set": {"last_fired_at": now_iso(), "last_status": status}})

async def _auto_reply(owner_id: str, sidecar_id: str, session_slug: str, remote_jid: str, text: str):
    from core import WA_SIDECAR_URL, sidecar_headers
    bh_doc = await db.business_hours.find_one({"owner_id": owner_id, "session_id": session_slug})
    bh_enabled = bool(bh_doc.get("enabled")) if bh_doc else False
    within = _within_bh(bh_doc) if bh_enabled else False
    if bh_enabled and within: return
    reply_text = None; used = None
    if not bh_enabled or bh_doc.get("also_use_rules_outside", True):
        rule = await _match_rule(owner_id, session_slug, text)
        if rule: reply_text = rule["response"]; used = "rule"
    if reply_text is None and bh_enabled and not within:
        fb = (bh_doc.get("fallback_message") or "").strip()
        if fb: reply_text = fb; used = "fallback"
    if not reply_text: return
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{WA_SIDECAR_URL}/sessions/{sidecar_id}/send-text",
                             headers=sidecar_headers(),
                             json={"to": remote_jid, "text": reply_text})
        body = r.json() if r.content else {}
        doc = {
            "owner_id": owner_id, "session_id": session_slug, "sidecar_id": sidecar_id,
            "direction": "outgoing", "remote_jid": remote_jid,
            "message_id": body.get("messageId"), "text": reply_text,
            "media_type": None, "status": "pending", "auto_reply": True, "auto_reply_kind": used,
            "timestamp": int(datetime.now(timezone.utc).timestamp()),
            "created_at": now_iso(),
        }
        res = await db.messages.insert_one(doc)
        doc["id"] = str(res.inserted_id); doc.pop("_id", None)
        await ws_manager.send_to(owner_id, {"type": "message", "message": doc})
    except Exception as e:
        logger.error("Auto-reply failed: %s", e)

@internal_router.post("/incoming", dependencies=[Depends(require_sidecar_token)])
async def incoming(payload: Dict[str, Any]):
    kind = payload.get("type")
    sidecar_id = payload.get("sessionId")
    owner_id, slug = await _resolve_owner_by_sidecar_id(sidecar_id) if sidecar_id else (None, None)

    if kind == "message":
        if not owner_id:
            return {"ok": True}  # unknown session
        doc = {
            "owner_id": owner_id,
            "session_id": slug,
            "sidecar_id": sidecar_id,
            "direction": payload.get("direction"),
            "remote_jid": payload.get("remoteJid"),
            "message_id": payload.get("messageId"),
            "push_name": payload.get("pushName"),
            "text": payload.get("text") or "",
            "media_type": payload.get("mediaType"),
            "status": "delivered" if payload.get("direction") == "incoming" else "pending",
            "timestamp": payload.get("timestamp") or int(datetime.now(timezone.utc).timestamp()),
            "created_at": now_iso(),
        }
        res = await db.messages.insert_one(doc)
        doc["id"] = str(res.inserted_id); doc.pop("_id", None)
        await ws_manager.send_to(owner_id, {"type": "message", "message": doc})
        if payload.get("direction") == "incoming":
            await _fire_webhooks(owner_id, slug, doc)
            await _auto_reply(owner_id, sidecar_id, slug, doc["remote_jid"], doc["text"])
        return {"ok": True}

    if kind == "status":
        message_id = payload.get("messageId")
        raw = payload.get("status")
        try:
            status = STATUS_MAP.get(int(raw), None)
        except (ValueError, TypeError):
            status = raw if isinstance(raw, str) else None
        if not message_id or not status:
            return {"ok": True}
        r = await db.messages.update_one(
            {"sidecar_id": sidecar_id, "message_id": message_id},
            {"$set": {"status": status}}
        )
        if owner_id and r.modified_count:
            await ws_manager.send_to(owner_id, {
                "type": "status", "session_id": slug,
                "message_id": message_id, "status": status
            })
        return {"ok": True}

    if kind == "connection":
        if owner_id:
            await ws_manager.send_to(owner_id, {
                "type": "connection", "session_id": slug,
                "status": payload.get("status"),
                "pairing_code": payload.get("pairingCode"),
                "error": payload.get("error"),
            })
        logger.info("Connection update: %s (%s) %s", sidecar_id, slug, payload.get("status"))
        return {"ok": True}

    return {"ok": True}

# ---------- WebSocket ----------
async def ws_handler(websocket: WebSocket):
    token = websocket.cookies.get("access_token")
    user = await _get_user_from_token(token) if token else None
    if not user:
        await websocket.close(code=4401)
        return
    owner_id = user["id"]
    await ws_manager.connect(websocket, owner_id)
    try:
        await websocket.send_json({"type": "hello", "user": user["email"]})
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=45)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(websocket, owner_id)
