"""
Shared core: config, db, security helpers, ws manager, utilities.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import base64
import asyncio
import logging
import secrets
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from typing import Optional, Set, List, Dict, Any

import bcrypt
import jwt
import qrcode
from bson import ObjectId
from fastapi import HTTPException, Request, Response, Header, Depends, WebSocket
from motor.motor_asyncio import AsyncIOMotorClient

# ---------- ENV ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
WA_SIDECAR_URL = os.environ.get("WA_SIDECAR_URL", "http://localhost:3002").rstrip("/")
SIDECAR_TOKEN = os.environ.get("SIDECAR_TOKEN", "")
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "").strip()
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax")

LOGIN_MAX_FAILS = 5
LOGIN_LOCKOUT_MINUTES = 15
UPLOAD_DIR = ROOT_DIR / "uploads" / "payments"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALL_SCOPES = [
    "send:text", "send:media", "broadcast",
    "sessions:read", "groups:read", "groups:write", "logs:read",
]
FULL_SCOPES = ALL_SCOPES

# ---------- DB ----------
mongo = AsyncIOMotorClient(MONGO_URL)
db = mongo[DB_NAME]

logger = logging.getLogger("wa-saas")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ---------- Password / JWT ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    return jwt.encode({
        "sub": user_id, "email": email, "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }, JWT_SECRET, algorithm=JWT_ALG)

def create_refresh_token(user_id: str) -> str:
    return jwt.encode({
        "sub": user_id, "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }, JWT_SECRET, algorithm=JWT_ALG)

def _cookie_kwargs(max_age: int):
    return dict(httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=max_age, path="/")

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, **_cookie_kwargs(43200))
    response.set_cookie("refresh_token", refresh, **_cookie_kwargs(604800))

def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

# ---------- Auth Deps ----------
def _serialize_user(u: dict) -> dict:
    u = dict(u)
    u["id"] = str(u.pop("_id"))
    u.pop("password_hash", None)
    return u

async def _get_user_from_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            return None
        u = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not u:
            return None
        return _serialize_user(u)
    except jwt.PyJWTError:
        return None

def _extract_token(request: Request) -> Optional[str]:
    tok = request.cookies.get("access_token")
    if not tok:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            tok = auth[7:]
    return tok

async def get_current_user(request: Request) -> dict:
    tok = _extract_token(request)
    if not tok:
        raise HTTPException(status_code=401, detail="Not authenticated")
    u = await _get_user_from_token(tok)
    if not u:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return u

async def require_admin(user=Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

async def require_active_user(user=Depends(get_current_user)) -> dict:
    """User must be approved AND (admin OR have active non-expired subscription)."""
    status = user.get("status") or "pending"
    if status == "pending":
        raise HTTPException(status_code=403, detail="Account pending admin approval.")
    if status == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended. Contact admin.")
    if status == "deleted":
        raise HTTPException(status_code=403, detail="Account deleted.")
    if user.get("role") == "admin":
        return user
    # Regular users must have active subscription
    expires_at = user.get("subscription_expires_at")
    if not expires_at:
        raise HTTPException(status_code=402, detail="No active subscription. Please choose a plan and pay.")
    try:
        exp = datetime.fromisoformat(expires_at)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= exp:
            raise HTTPException(status_code=402, detail="Subscription expired. Please renew.")
    except (ValueError, TypeError):
        raise HTTPException(status_code=402, detail="Invalid subscription. Contact admin.")
    return user

async def require_approved_user(user=Depends(get_current_user)) -> dict:
    """Approved (or admin), regardless of subscription. Used for billing pages."""
    status = user.get("status") or "pending"
    if status == "pending":
        raise HTTPException(status_code=403, detail="Account pending admin approval.")
    if status == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended. Contact admin.")
    if status == "deleted":
        raise HTTPException(status_code=403, detail="Account deleted.")
    return user

def require_sidecar_token(x_sidecar_token: Optional[str] = Header(None, alias="X-Sidecar-Token")):
    if not SIDECAR_TOKEN or x_sidecar_token != SIDECAR_TOKEN:
        raise HTTPException(status_code=401, detail="Bad sidecar token")

# ---------- Rate limiter for public API ----------
_rate_windows: Dict[str, deque] = defaultdict(deque)
_rate_lock = asyncio.Lock()

async def _rate_check(key_id: str, limit_per_minute: int) -> None:
    if not limit_per_minute or limit_per_minute <= 0:
        return
    now = datetime.now(timezone.utc).timestamp()
    async with _rate_lock:
        w = _rate_windows[key_id]
        while w and (now - w[0]) > 60:
            w.popleft()
        if len(w) >= limit_per_minute:
            retry = int(60 - (now - w[0]))
            raise HTTPException(status_code=429, detail=f"Rate limit exceeded. Retry in {retry}s.")
        w.append(now)

def require_scope(*needed: str):
    needed_set = set(needed)
    async def _dep(authorization: Optional[str] = Header(None)):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")
        key = authorization[7:].strip()
        doc = await db.api_keys.find_one({"key": key, "revoked": {"$ne": True}})
        if not doc:
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")
        # Check owner is still active
        owner = await db.users.find_one({"_id": ObjectId(doc["owner_id"])}) if doc.get("owner_id") else None
        if owner:
            if owner.get("status") not in {"approved"} and owner.get("role") != "admin":
                raise HTTPException(status_code=403, detail="API key owner account is not active.")
            if owner.get("role") != "admin":
                exp = owner.get("subscription_expires_at")
                if not exp:
                    raise HTTPException(status_code=402, detail="Owner has no active subscription.")
                try:
                    ex = datetime.fromisoformat(exp)
                    if ex.tzinfo is None: ex = ex.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) >= ex:
                        raise HTTPException(status_code=402, detail="Owner subscription expired.")
                except (ValueError, TypeError):
                    raise HTTPException(status_code=402, detail="Owner has invalid subscription.")
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

# ---------- WebSocket Manager (per-owner) ----------
class WSManager:
    def __init__(self):
        # owner_id -> set of websockets
        self.active: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, owner_id: str):
        await ws.accept()
        async with self.lock:
            self.active[owner_id].add(ws)

    async def disconnect(self, ws: WebSocket, owner_id: str):
        async with self.lock:
            if owner_id in self.active:
                self.active[owner_id].discard(ws)
                if not self.active[owner_id]:
                    del self.active[owner_id]

    async def send_to(self, owner_id: str, message: dict):
        stale: List[WebSocket] = []
        async with self.lock:
            targets = list(self.active.get(owner_id, []))
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(ws)
        if stale:
            async with self.lock:
                for s in stale:
                    self.active.get(owner_id, set()).discard(s)

ws_manager = WSManager()

# ---------- Utilities ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def sidecar_id_for(owner_id: str, slug: str) -> str:
    return f"u{owner_id[-12:]}_{slug}"

def sidecar_headers():
    return {"X-Sidecar-Token": SIDECAR_TOKEN}

def build_upi_url(vpa: str, payee_name: str, amount: float, note: str, currency: str = "INR") -> str:
    import urllib.parse
    params = {
        "pa": vpa,
        "pn": payee_name,
        "am": f"{amount:.2f}",
        "cu": currency,
        "tn": note,
    }
    return "upi://pay?" + urllib.parse.urlencode(params)

def qr_png_base64(text: str) -> str:
    img = qrcode.make(text, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

def gen_ref(prefix: str = "WA") -> str:
    ts = datetime.now(timezone.utc).strftime("%y%m%d%H%M")
    return f"{prefix}-{ts}-{secrets.token_hex(3).upper()}"
