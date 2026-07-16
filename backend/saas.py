"""
SaaS routes: registration, forgot-password, admin (users/plans/payments/settings), billing.
"""
import secrets
import shutil
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

from core import (
    db, logger, now_iso,
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    set_auth_cookies, clear_auth_cookies,
    get_current_user, require_admin, require_approved_user,
    UPLOAD_DIR, build_upi_url, qr_png_base64, gen_ref, ADMIN_EMAIL,
    FRONTEND_ORIGIN, WA_SIDECAR_URL, sidecar_headers,
)
from email_service import (
    get_smtp_config, save_smtp_config, send_email,
    welcome_email_html, otp_email_html, test_email_html,
    admin_password_changed_html, _mask_password,
)

# ---------- Feature-flag defaults ----------
DEFAULT_FEATURE_FLAGS = {
    "send_text": True,
    "send_media": True,
    "broadcast": True,
    "rules": True,
    "webhooks": True,
    "api_access": True,
    "multi_session": True,
    "business_hours": True,
    "groups": True,
    "logs": True,
}

router = APIRouter(prefix="/api")

# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    company: Optional[str] = ""
    phone: str
    alt_phone: Optional[str] = ""
    location: Optional[str] = ""

class PlanIn(BaseModel):
    name: str
    description: Optional[str] = ""
    price_inr: float = 0
    price_usd: float = 0
    validity_days: int = 30
    max_sessions: int = 1
    max_messages_per_day: int = 1000
    max_api_keys: int = 3
    max_rules: int = 50
    max_webhooks: int = 10
    features: List[str] = []
    feature_flags: Dict[str, bool] = Field(default_factory=lambda: dict(DEFAULT_FEATURE_FLAGS))
    active: bool = True
    sort_order: int = 0

class SettingsIn(BaseModel):
    upi_vpa: str
    upi_payee_name: str
    contact_email: Optional[str] = ""
    contact_phone: Optional[str] = ""
    invoice_note: Optional[str] = "Thank you for subscribing."
    company_name: Optional[str] = "WA_API"

class VerifyPaymentIn(BaseModel):
    admin_notes: Optional[str] = ""

class ProfileUpdateIn(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    alt_phone: Optional[str] = None
    location: Optional[str] = None

class UserSuspendIn(BaseModel):
    reason: Optional[str] = ""

class AdminCreateUserIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    company: Optional[str] = ""
    phone: str
    alt_phone: Optional[str] = ""
    location: Optional[str] = ""
    role: str = "user"          # "user" or "admin"
    status: str = "approved"    # default approved (admin-created)
    plan_id: Optional[str] = None   # optional: assign a plan immediately
    validity_days: Optional[int] = None  # override plan validity if set

class ContactIn(BaseModel):
    name: str
    email: EmailStr
    subject: Optional[str] = ""
    message: str
    phone: Optional[str] = ""

class AdminUserEditIn(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    alt_phone: Optional[str] = None
    location: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    plan_id: Optional[str] = None
    validity_days: Optional[int] = None
    extend_days: Optional[int] = None  # if given, add days to subscription

class AdminSetPasswordIn(BaseModel):
    password: str = Field(min_length=6)
    notify_email: bool = True

class AdminChangeOwnPasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)

class UserFeaturesIn(BaseModel):
    feature_flags: Optional[Dict[str, bool]] = None
    limits: Optional[Dict[str, int]] = None

class SmtpIn(BaseModel):
    host: str
    port: int = 587
    username: str = ""
    password: Optional[str] = ""   # if empty, keep existing
    use_tls: bool = True
    use_ssl: bool = False
    from_name: str = ""
    from_email: EmailStr
    enabled: bool = True

class SmtpTestIn(BaseModel):
    to_email: EmailStr

class OtpRequestIn(BaseModel):
    email: EmailStr

class OtpVerifyIn(BaseModel):
    email: EmailStr
    otp: str

class OtpResetIn(BaseModel):
    email: EmailStr
    otp: str
    password: str = Field(min_length=6)

class TokenResetIn(BaseModel):
    token: str
    password: str = Field(min_length=6)

class AdminSendTextIn(BaseModel):
    user_id: str
    session_slug: str
    to: str
    text: str

# ---------- Helpers ----------
def _doc_out(d):
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d

def _user_out(u: dict) -> dict:
    u = _doc_out(u)
    u.pop("password_hash", None)
    return u

async def _get_settings() -> dict:
    doc = await db.settings.find_one({"key": "billing"})
    if not doc:
        return {"key": "billing", "upi_vpa": "", "upi_payee_name": "", "contact_email": "",
                "contact_phone": "", "invoice_note": "Thank you for subscribing.", "company_name": "WA_API"}
    doc.pop("_id", None)
    return doc

# ---------- Public: registration + OTP password reset ----------
def _gen_otp() -> str:
    return "".join([str(secrets.randbelow(10)) for _ in range(6)])

async def _get_brand() -> str:
    s = await _get_settings()
    return s.get("company_name") or "WA_API"

def _login_url() -> str:
    base = FRONTEND_ORIGIN.split(",")[0].strip() if FRONTEND_ORIGIN else ""
    return f"{base.rstrip('/')}/login" if base else "/login"

@router.post("/auth/register", status_code=201)
async def register(body: RegisterIn):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name.strip(),
        "company": body.company or "",
        "phone": body.phone.strip(),
        "alt_phone": body.alt_phone or "",
        "location": body.location or "",
        "role": "user",
        "status": "pending",  # awaits admin approval
        "current_plan_id": None,
        "subscription_expires_at": None,
        "failed_logins": 0,
        "locked_until": None,
        "feature_flags": {},   # empty => inherit from plan
        "limits": {},          # per-user overrides
        "created_at": now_iso(),
    }
    res = await db.users.insert_one(doc)
    logger.info("New registration: %s (%s)", email, res.inserted_id)
    return {"ok": True, "message": "Registration submitted. Awaiting admin approval."}

@router.post("/auth/forgot-password")
async def forgot_password(body: OtpRequestIn):
    """Send a 6-digit OTP to the user's email via configured SMTP.
    Always returns success message (does not leak whether email exists)."""
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    smtp = await get_smtp_config()
    smtp_enabled = bool(smtp.get("enabled") and smtp.get("host"))

    if user:
        otp = _gen_otp()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        await db.password_resets.insert_one({
            "user_id": str(user["_id"]),
            "email": email,
            "otp": otp,
            "expires_at": expires_at,
            "used": False,
            "attempts": 0,
            "created_at": now_iso(),
            "status": "sent" if smtp_enabled else "pending_smtp",
        })
        if smtp_enabled:
            brand = await _get_brand()
            html = otp_email_html(user.get("name") or "", otp, brand)
            text = f"Your {brand} password reset code is {otp}. It expires in 10 minutes."
            r = await send_email(email, f"{brand} password reset code", text, html)
            if not r["ok"]:
                logger.error("Failed to send OTP email to %s: %s", email, r.get("error"))
    return {"ok": True, "message": "If the email is registered, a 6-digit code was sent. Please check your inbox.",
            "smtp_enabled": smtp_enabled}

@router.post("/auth/verify-otp")
async def verify_otp(body: OtpVerifyIn):
    email = body.email.lower().strip()
    otp = body.otp.strip()
    doc = await db.password_resets.find_one(
        {"email": email, "otp": otp, "used": False},
        sort=[("created_at", -1)],
    )
    if not doc:
        # increment attempts for the most recent open request
        recent = await db.password_resets.find_one(
            {"email": email, "used": False}, sort=[("created_at", -1)]
        )
        if recent:
            await db.password_resets.update_one({"_id": recent["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Invalid code")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
        if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= exp:
            raise HTTPException(status_code=400, detail="Code expired. Please request a new one.")
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid code")
    return {"ok": True}

@router.post("/auth/reset-password")
async def reset_password(body: OtpResetIn):
    email = body.email.lower().strip()
    otp = body.otp.strip()
    doc = await db.password_resets.find_one(
        {"email": email, "otp": otp, "used": False},
        sort=[("created_at", -1)],
    )
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid or already-used code")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
        if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= exp:
            raise HTTPException(status_code=400, detail="Code expired")
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.users.update_one({"_id": ObjectId(doc["user_id"])},
                              {"$set": {"password_hash": hash_password(body.password),
                                        "failed_logins": 0, "locked_until": None}})
    await db.password_resets.update_one({"_id": doc["_id"]},
                                        {"$set": {"used": True, "used_at": now_iso(), "status": "used"}})
    # invalidate any other outstanding codes for this user
    await db.password_resets.update_many(
        {"user_id": doc["user_id"], "used": False},
        {"$set": {"used": True, "status": "superseded"}}
    )
    return {"ok": True, "message": "Password reset. Please sign in."}

@router.post("/auth/reset-password-token")
async def reset_password_with_token(body: TokenResetIn):
    """Alternate reset flow: uses a token generated by admin (reset-link) instead of OTP."""
    doc = await db.password_resets.find_one({"token": body.token, "used": False})
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid or already-used token")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
        if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= exp:
            raise HTTPException(status_code=400, detail="Reset token expired")
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid token")
    await db.users.update_one({"_id": ObjectId(doc["user_id"])},
                              {"$set": {"password_hash": hash_password(body.password),
                                        "failed_logins": 0, "locked_until": None}})
    await db.password_resets.update_one({"_id": doc["_id"]},
                                        {"$set": {"used": True, "used_at": now_iso(), "status": "used"}})
    return {"ok": True, "message": "Password reset. Please sign in."}

# ---------- Public: plans listing + settings for pricing page ----------
@router.get("/plans")
async def public_plans():
    plans = [_doc_out(p) async for p in db.plans.find({"active": True}).sort("sort_order", 1)]
    s = await _get_settings()
    return {"plans": plans, "billing": {"contact_email": s.get("contact_email"), "contact_phone": s.get("contact_phone"),
                                        "company_name": s.get("company_name")}}

# ---------- Public: contact form ----------
@router.post("/contact", status_code=201)
async def submit_contact(body: ContactIn):
    doc = body.model_dump()
    doc.update({"status": "new", "created_at": now_iso()})
    await db.contact_messages.insert_one(doc)
    return {"ok": True, "message": "Thanks! We'll get back to you shortly."}

# ---------- Public: brand/site info ----------
@router.get("/site-info")
async def site_info():
    s = await _get_settings()
    return {
        "company_name": s.get("company_name") or "WA_API",
        "contact_email": s.get("contact_email") or "",
        "contact_phone": s.get("contact_phone") or "",
    }

# ---------- User: profile ----------
@router.put("/auth/profile")
async def update_profile(body: ProfileUpdateIn, user=Depends(get_current_user)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        return {"ok": True}
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": update})
    u = await db.users.find_one({"_id": ObjectId(user["id"])})
    return _user_out(u)

# ---------- User: billing ----------
@router.get("/billing/summary")
async def billing_summary(user=Depends(require_approved_user)):
    """Current subscription info + plan limits + usage for regular users."""
    if user.get("role") == "admin":
        return {"is_admin": True, "unlimited": True}
    plan = None
    if user.get("current_plan_id"):
        p = await db.plans.find_one({"_id": ObjectId(user["current_plan_id"])})
        if p: plan = _doc_out(p)
    # Compute usage
    from core import today_str
    daily = await db.daily_usage.find_one({"user_id": user["id"], "date": today_str()})
    used_today = int(daily.get("messages_sent", 0)) if daily else 0
    sessions_count = await db.sessions.count_documents({"owner_id": user["id"]})
    api_keys_count = await db.api_keys.count_documents({"owner_id": user["id"], "revoked": {"$ne": True}})
    expires_at = user.get("subscription_expires_at")
    days_left = None
    if expires_at:
        try:
            exp = datetime.fromisoformat(expires_at)
            if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
            delta = (exp - datetime.now(timezone.utc)).total_seconds()
            days_left = max(0, int(delta // 86400)) if delta > 0 else 0
        except (ValueError, TypeError):
            pass
    return {
        "is_admin": False,
        "user": {"email": user["email"], "name": user.get("name"), "company": user.get("company"),
                 "status": user.get("status")},
        "plan": plan,
        "subscription_expires_at": expires_at,
        "days_left": days_left,
        "usage": {
            "messages_today": used_today,
            "sessions_count": sessions_count,
            "api_keys_count": api_keys_count,
        },
    }

@router.post("/billing/create-payment")
async def create_payment(plan_id: str = Form(...), currency: str = Form("INR"),
                         user=Depends(require_approved_user)):
    """User picks a plan → we create a pending payment and return UPI QR."""
    if user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin does not need to subscribe.")
    plan = await db.plans.find_one({"_id": ObjectId(plan_id), "active": True})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found or inactive")
    currency = currency.upper()
    if currency not in ("INR", "USD"):
        raise HTTPException(status_code=400, detail="Currency must be INR or USD")
    amount = float(plan.get("price_inr", 0) if currency == "INR" else plan.get("price_usd", 0))
    settings = await _get_settings()
    vpa = settings.get("upi_vpa") or ""
    payee = settings.get("upi_payee_name") or "Admin"
    if currency == "INR" and not vpa:
        raise HTTPException(status_code=400, detail="Admin has not configured UPI VPA yet.")
    ref = gen_ref()
    upi_url = build_upi_url(vpa, payee, amount, ref, "INR") if currency == "INR" else None
    qr_data_url = qr_png_base64(upi_url) if upi_url else None

    doc = {
        "user_id": user["id"],
        "plan_id": plan_id,
        "plan_name": plan.get("name"),
        "amount": amount,
        "currency": currency,
        "upi_vpa": vpa if currency == "INR" else None,
        "upi_url": upi_url,
        "reference": ref,
        "utr_number": None,
        "screenshot_path": None,
        "status": "pending",  # pending -> submitted -> verified/rejected
        "admin_notes": "",
        "created_at": now_iso(),
        "submitted_at": None,
        "verified_at": None,
        "verified_by": None,
    }
    res = await db.payments.insert_one(doc)
    return {
        "id": str(res.inserted_id),
        "reference": ref,
        "amount": amount,
        "currency": currency,
        "upi_vpa": vpa if currency == "INR" else None,
        "upi_payee_name": payee if currency == "INR" else None,
        "upi_url": upi_url,
        "qr_data_url": qr_data_url,
        "plan_name": plan.get("name"),
        "status": "pending",
    }

@router.post("/billing/submit-utr")
async def submit_utr(payment_id: str = Form(...), utr: str = Form(...),
                     screenshot: Optional[UploadFile] = File(None),
                     user=Depends(require_approved_user)):
    p = await db.payments.find_one({"_id": ObjectId(payment_id), "user_id": user["id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["status"] not in ("pending", "submitted"):
        raise HTTPException(status_code=400, detail=f"Payment already {p['status']}")
    update = {"utr_number": utr.strip(), "status": "submitted", "submitted_at": now_iso()}
    if screenshot is not None:
        ext = Path(screenshot.filename or "img").suffix.lower() or ".png"
        safe = f"{payment_id}{ext}"
        dest = UPLOAD_DIR / safe
        with dest.open("wb") as f:
            shutil.copyfileobj(screenshot.file, f)
        update["screenshot_path"] = safe
    await db.payments.update_one({"_id": p["_id"]}, {"$set": update})
    return {"ok": True, "message": "UTR submitted. Awaiting admin verification."}

@router.get("/billing/my-payments")
async def my_payments(user=Depends(require_approved_user)):
    items = [_doc_out(d) async for d in db.payments.find({"user_id": user["id"]}).sort("created_at", -1)]
    return {"payments": items}

# ---------- Admin: users management ----------
@router.post("/admin/users", status_code=201)
async def admin_create_user(body: AdminCreateUserIn, _a=Depends(require_admin)):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="role must be user or admin")
    if body.status not in ("approved", "pending", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid status")

    subscription_expires_at = None
    current_plan_id = None
    if body.plan_id:
        plan = await db.plans.find_one({"_id": ObjectId(body.plan_id)})
        if not plan:
            raise HTTPException(status_code=400, detail="Plan not found")
        current_plan_id = str(plan["_id"])
        vd = int(body.validity_days) if body.validity_days else int(plan.get("validity_days", 30))
        subscription_expires_at = (datetime.now(timezone.utc) + timedelta(days=vd)).isoformat()

    doc = {
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name.strip(),
        "company": body.company or "",
        "phone": body.phone.strip(),
        "alt_phone": body.alt_phone or "",
        "location": body.location or "",
        "role": body.role,
        "status": body.status,
        "current_plan_id": current_plan_id,
        "subscription_expires_at": subscription_expires_at,
        "failed_logins": 0,
        "locked_until": None,
        "feature_flags": {},
        "limits": {},
        "created_at": now_iso(),
        "created_by_admin": True,
    }
    res = await db.users.insert_one(doc)

    # Send welcome email if SMTP is configured
    smtp = await get_smtp_config()
    email_sent = False
    email_error = None
    if smtp.get("enabled") and smtp.get("host"):
        brand = await _get_brand()
        html = welcome_email_html(body.name.strip(), email, body.password, _login_url(), brand)
        text = f"Hi {body.name}, your {brand} account has been created.\nEmail: {email}\nPassword: {body.password}\nSign in: {_login_url()}"
        r = await send_email(email, f"Welcome to {brand}", text, html)
        email_sent = r["ok"]
        email_error = r.get("error")

    return {"ok": True, "id": str(res.inserted_id), "email": email,
            "subscription_expires_at": subscription_expires_at,
            "welcome_email_sent": email_sent,
            "welcome_email_error": email_error}

@router.get("/admin/users")
async def admin_list_users(_a=Depends(require_admin)):
    users = []
    async for u in db.users.find().sort("created_at", -1):
        # Attach plan name if any
        plan_name = None
        plan_doc = None
        if u.get("current_plan_id"):
            p = await db.plans.find_one({"_id": ObjectId(u["current_plan_id"])})
            if p:
                plan_name = p.get("name")
                plan_doc = p
        u = _user_out(u)
        u["plan_name"] = plan_name
        # Effective flags/limits (plan defaults merged with user override)
        base_flags = dict(DEFAULT_FEATURE_FLAGS)
        if plan_doc and isinstance(plan_doc.get("feature_flags"), dict):
            base_flags.update(plan_doc["feature_flags"])
        override = u.get("feature_flags") or {}
        u["effective_feature_flags"] = {**base_flags, **override}
        base_limits = {
            "max_sessions": (plan_doc or {}).get("max_sessions", 1) if plan_doc else 999,
            "max_messages_per_day": (plan_doc or {}).get("max_messages_per_day", 0) if plan_doc else 0,
            "max_api_keys": (plan_doc or {}).get("max_api_keys", 1) if plan_doc else 999,
            "max_rules": (plan_doc or {}).get("max_rules", 50) if plan_doc else 999,
            "max_webhooks": (plan_doc or {}).get("max_webhooks", 10) if plan_doc else 999,
        }
        u["effective_limits"] = {**base_limits, **(u.get("limits") or {})}
        users.append(u)
    return {"users": users}

@router.put("/admin/users/{uid}")
async def admin_edit_user(uid: str, body: AdminUserEditIn, _a=Depends(require_admin)):
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    upd: Dict[str, Any] = {}
    for k in ("name", "company", "phone", "alt_phone", "location"):
        v = getattr(body, k)
        if v is not None:
            upd[k] = v.strip() if isinstance(v, str) else v
    if body.role is not None:
        if body.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="role must be user or admin")
        upd["role"] = body.role
    if body.status is not None:
        if body.status not in ("approved", "pending", "suspended"):
            raise HTTPException(status_code=400, detail="Invalid status")
        upd["status"] = body.status
    # Plan change
    if body.plan_id is not None:
        if body.plan_id == "":
            upd["current_plan_id"] = None
            upd["subscription_expires_at"] = None
        else:
            plan = await db.plans.find_one({"_id": ObjectId(body.plan_id)})
            if not plan:
                raise HTTPException(status_code=400, detail="Plan not found")
            upd["current_plan_id"] = str(plan["_id"])
            vd = int(body.validity_days) if body.validity_days else int(plan.get("validity_days", 30))
            upd["subscription_expires_at"] = (datetime.now(timezone.utc) + timedelta(days=vd)).isoformat()
    elif body.validity_days is not None:
        upd["subscription_expires_at"] = (datetime.now(timezone.utc) + timedelta(days=int(body.validity_days))).isoformat()
    if body.extend_days:
        cur_exp = u.get("subscription_expires_at")
        base = datetime.now(timezone.utc)
        if cur_exp:
            try:
                d = datetime.fromisoformat(cur_exp)
                if d.tzinfo is None: d = d.replace(tzinfo=timezone.utc)
                if d > base: base = d
            except (ValueError, TypeError):
                pass
        upd["subscription_expires_at"] = (base + timedelta(days=int(body.extend_days))).isoformat()
    if upd:
        await db.users.update_one({"_id": ObjectId(uid)}, {"$set": upd})
    fresh = await db.users.find_one({"_id": ObjectId(uid)})
    return _user_out(fresh)

@router.put("/admin/users/{uid}/password")
async def admin_set_user_password(uid: str, body: AdminSetPasswordIn, _a=Depends(require_admin)):
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"_id": ObjectId(uid)}, {"$set": {
        "password_hash": hash_password(body.password),
        "failed_logins": 0, "locked_until": None,
        "password_changed_at": now_iso(),
    }})
    email_sent = False; email_error = None
    if body.notify_email:
        smtp = await get_smtp_config()
        if smtp.get("enabled") and smtp.get("host"):
            brand = await _get_brand()
            html = admin_password_changed_html(brand)
            text = f"Your {brand} account password was updated by the administrator. New password: {body.password}\nLogin: {_login_url()}"
            r = await send_email(u["email"], f"{brand}: password updated", text, html)
            email_sent = r["ok"]; email_error = r.get("error")
    return {"ok": True, "email_sent": email_sent, "email_error": email_error}

@router.put("/admin/users/{uid}/features")
async def admin_set_user_features(uid: str, body: UserFeaturesIn, _a=Depends(require_admin)):
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    upd: Dict[str, Any] = {}
    if body.feature_flags is not None:
        # Only accept known feature keys
        clean = {k: bool(v) for k, v in body.feature_flags.items() if k in DEFAULT_FEATURE_FLAGS}
        upd["feature_flags"] = clean
    if body.limits is not None:
        allowed = {"max_sessions", "max_messages_per_day", "max_api_keys", "max_rules", "max_webhooks"}
        clean = {k: int(v) for k, v in body.limits.items() if k in allowed}
        upd["limits"] = clean
    if upd:
        await db.users.update_one({"_id": ObjectId(uid)}, {"$set": upd})
    fresh = await db.users.find_one({"_id": ObjectId(uid)})
    return _user_out(fresh)

@router.get("/admin/feature-flags")
async def admin_feature_flag_defs(_a=Depends(require_admin)):
    """List all available feature flags (metadata for UI)."""
    return {
        "flags": [
            {"key": "send_text", "label": "Send text messages"},
            {"key": "send_media", "label": "Send media (image/doc/video)"},
            {"key": "broadcast", "label": "Broadcast messages"},
            {"key": "rules", "label": "Auto-reply rules"},
            {"key": "webhooks", "label": "Webhooks"},
            {"key": "api_access", "label": "Public API (Bearer keys)"},
            {"key": "multi_session", "label": "Multiple WhatsApp sessions"},
            {"key": "business_hours", "label": "Business hours mode"},
            {"key": "groups", "label": "Groups (read + manage)"},
            {"key": "logs", "label": "Message logs & history"},
        ],
        "limits": [
            {"key": "max_sessions", "label": "Max sessions"},
            {"key": "max_messages_per_day", "label": "Max messages / day"},
            {"key": "max_api_keys", "label": "Max API keys"},
            {"key": "max_rules", "label": "Max auto-reply rules"},
            {"key": "max_webhooks", "label": "Max webhooks"},
        ],
        "defaults": DEFAULT_FEATURE_FLAGS,
    }

@router.post("/admin/change-password")
async def admin_change_own_password(body: AdminChangeOwnPasswordIn, admin=Depends(require_admin)):
    """Any authenticated admin can change their own password."""
    u = await db.users.find_one({"_id": ObjectId(admin["id"])})
    if not u or not verify_password(body.current_password, u["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one({"_id": u["_id"]}, {"$set": {
        "password_hash": hash_password(body.new_password),
        "password_changed_at": now_iso(),
    }})
    return {"ok": True}

@router.post("/admin/users/{uid}/approve")
async def admin_approve_user(uid: str, _a=Depends(require_admin)):
    r = await db.users.update_one({"_id": ObjectId(uid)}, {"$set": {"status": "approved"}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}

@router.post("/admin/users/{uid}/suspend")
async def admin_suspend_user(uid: str, body: UserSuspendIn, _a=Depends(require_admin)):
    r = await db.users.update_one(
        {"_id": ObjectId(uid)},
        {"$set": {"status": "suspended", "suspend_reason": body.reason or "", "suspended_at": now_iso()}}
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}

@router.post("/admin/users/{uid}/unsuspend")
async def admin_unsuspend_user(uid: str, _a=Depends(require_admin)):
    r = await db.users.update_one({"_id": ObjectId(uid)}, {"$set": {"status": "approved"},
                                                            "$unset": {"suspend_reason": "", "suspended_at": ""}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}

@router.delete("/admin/users/{uid}")
async def admin_delete_user(uid: str, _a=Depends(require_admin)):
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.get("email") == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot delete the seed admin account.")
    # Clean up related data
    await db.sessions.delete_many({"owner_id": uid})
    await db.rules.delete_many({"owner_id": uid})
    await db.webhooks.delete_many({"owner_id": uid})
    await db.api_keys.delete_many({"owner_id": uid})
    await db.messages.delete_many({"owner_id": uid})
    await db.business_hours.delete_many({"owner_id": uid})
    await db.daily_usage.delete_many({"user_id": uid})
    await db.payments.delete_many({"user_id": uid})
    await db.password_resets.delete_many({"user_id": uid})
    await db.users.delete_one({"_id": ObjectId(uid)})
    return {"ok": True}

@router.post("/admin/users/{uid}/reset-link")
async def admin_generate_reset_link(uid: str, _a=Depends(require_admin)):
    """Admin generates a one-time password reset link. Share it with the user manually."""
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    await db.password_resets.insert_one({
        "user_id": uid,
        "email": u["email"],
        "token": token,
        "expires_at": expires_at,
        "used": False,
        "created_at": now_iso(),
        "status": "granted",
        "granted_by_admin": True,
    })
    return {"ok": True, "token": token, "expires_at": expires_at,
            "reset_path": f"/reset-password?token={token}"}

@router.get("/admin/reset-requests")
async def admin_reset_requests(_a=Depends(require_admin)):
    """List pending forgot-password requests."""
    items = []
    async for d in db.password_resets.find({"status": {"$in": ["requested", "granted"]}}).sort("requested_at", -1).limit(200):
        items.append(_doc_out(d))
    return {"requests": items}

# ---------- Admin: plans CRUD ----------
@router.get("/admin/plans")
async def admin_list_plans(_a=Depends(require_admin)):
    plans = [_doc_out(p) async for p in db.plans.find().sort("sort_order", 1)]
    return {"plans": plans}

@router.post("/admin/plans", status_code=201)
async def admin_create_plan(body: PlanIn, _a=Depends(require_admin)):
    doc = body.model_dump()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    res = await db.plans.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _doc_out(doc)

@router.put("/admin/plans/{pid}")
async def admin_update_plan(pid: str, body: PlanIn, _a=Depends(require_admin)):
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.plans.update_one({"_id": ObjectId(pid)}, {"$set": upd})
    p = await db.plans.find_one({"_id": ObjectId(pid)})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    return _doc_out(p)

@router.delete("/admin/plans/{pid}")
async def admin_delete_plan(pid: str, _a=Depends(require_admin)):
    r = await db.plans.delete_one({"_id": ObjectId(pid)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

# ---------- Admin: payments verification ----------
@router.get("/admin/payments")
async def admin_list_payments(status: Optional[str] = None, _a=Depends(require_admin)):
    q = {"status": status} if status else {}
    items = []
    async for p in db.payments.find(q).sort("created_at", -1).limit(500):
        u = await db.users.find_one({"_id": ObjectId(p["user_id"])}) if p.get("user_id") else None
        p = _doc_out(p)
        if u:
            p["user_email"] = u.get("email")
            p["user_name"] = u.get("name")
            p["user_company"] = u.get("company")
        items.append(p)
    return {"payments": items}

@router.get("/admin/payments/{pid}/screenshot")
async def admin_payment_screenshot(pid: str, _a=Depends(require_admin)):
    p = await db.payments.find_one({"_id": ObjectId(pid)})
    if not p or not p.get("screenshot_path"):
        raise HTTPException(status_code=404, detail="No screenshot")
    return FileResponse(UPLOAD_DIR / p["screenshot_path"])

@router.post("/admin/payments/{pid}/verify")
async def admin_verify_payment(pid: str, body: VerifyPaymentIn, admin=Depends(require_admin)):
    p = await db.payments.find_one({"_id": ObjectId(pid)})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    if p["status"] == "verified":
        raise HTTPException(status_code=400, detail="Already verified")
    plan = await db.plans.find_one({"_id": ObjectId(p["plan_id"])})
    if not plan:
        raise HTTPException(status_code=400, detail="Plan no longer exists")
    user = await db.users.find_one({"_id": ObjectId(p["user_id"])})
    if not user:
        raise HTTPException(status_code=400, detail="User no longer exists")

    # Determine subscription start (extend if still active, else start now)
    now = datetime.now(timezone.utc)
    current_exp = user.get("subscription_expires_at")
    base = now
    if current_exp:
        try:
            ce = datetime.fromisoformat(current_exp)
            if ce.tzinfo is None: ce = ce.replace(tzinfo=timezone.utc)
            if ce > now:
                base = ce
        except (ValueError, TypeError):
            pass
    new_exp = base + timedelta(days=int(plan.get("validity_days", 30)))

    await db.users.update_one({"_id": user["_id"]}, {"$set": {
        "current_plan_id": str(plan["_id"]),
        "subscription_expires_at": new_exp.isoformat(),
        "status": "approved",  # ensure approved
    }})
    await db.payments.update_one({"_id": p["_id"]}, {"$set": {
        "status": "verified",
        "verified_at": now.isoformat(),
        "verified_by": admin["email"],
        "admin_notes": body.admin_notes or "",
        "activated_from": base.isoformat(),
        "activated_until": new_exp.isoformat(),
    }})
    return {"ok": True, "expires_at": new_exp.isoformat()}

@router.post("/admin/payments/{pid}/reject")
async def admin_reject_payment(pid: str, body: VerifyPaymentIn, admin=Depends(require_admin)):
    r = await db.payments.update_one({"_id": ObjectId(pid)}, {"$set": {
        "status": "rejected", "verified_at": now_iso(), "verified_by": admin["email"],
        "admin_notes": body.admin_notes or "",
    }})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

# ---------- Admin: settings ----------
@router.get("/admin/settings")
async def admin_get_settings(_a=Depends(require_admin)):
    return await _get_settings()

@router.put("/admin/settings")
async def admin_set_settings(body: SettingsIn, _a=Depends(require_admin)):
    data = body.model_dump()
    data["key"] = "billing"
    data["updated_at"] = now_iso()
    await db.settings.update_one({"key": "billing"}, {"$set": data}, upsert=True)
    return data

# ---------- Admin: contact messages ----------
@router.get("/admin/messages")
async def admin_list_messages(_a=Depends(require_admin)):
    items = []
    async for d in db.contact_messages.find().sort("created_at", -1).limit(500):
        items.append(_doc_out(d))
    return {"messages": items}

@router.post("/admin/messages/{mid}/mark-read")
async def admin_mark_message_read(mid: str, _a=Depends(require_admin)):
    await db.contact_messages.update_one({"_id": ObjectId(mid)},
                                         {"$set": {"status": "read", "read_at": now_iso()}})
    return {"ok": True}

@router.delete("/admin/messages/{mid}")
async def admin_delete_message(mid: str, _a=Depends(require_admin)):
    await db.contact_messages.delete_one({"_id": ObjectId(mid)})
    return {"ok": True}

# ---------- Admin: SMTP settings ----------
@router.get("/admin/settings/smtp")
async def admin_get_smtp(_a=Depends(require_admin)):
    cfg = await get_smtp_config()
    return _mask_password(cfg)

@router.put("/admin/settings/smtp")
async def admin_set_smtp(body: SmtpIn, _a=Depends(require_admin)):
    payload = body.model_dump()
    # If password is empty, keep the existing one
    if not payload.get("password"):
        cur = await get_smtp_config()
        payload["password"] = cur.get("password") or ""
    await save_smtp_config(payload)
    return _mask_password(await get_smtp_config())

@router.post("/admin/settings/smtp/test")
async def admin_test_smtp(body: SmtpTestIn, _a=Depends(require_admin)):
    cfg = await get_smtp_config()
    if not cfg.get("host") or not cfg.get("from_email"):
        raise HTTPException(status_code=400, detail="SMTP not configured. Save host + from_email first.")
    # Force enabled for the test even if the toggle is off
    test_cfg = {**cfg, "enabled": True}
    brand = await _get_brand()
    html = test_email_html(brand)
    text = f"This is a test email from {brand}. SMTP is working."
    r = await send_email(body.to_email, f"{brand} — SMTP test", text, html, override_cfg=test_cfg)
    if not r["ok"]:
        raise HTTPException(status_code=400, detail=f"SMTP test failed: {r.get('error')}")
    return {"ok": True, "message": "Test email sent."}

# ---------- Admin: send WhatsApp message from any user's session ----------
@router.get("/admin/user-sessions")
async def admin_list_user_sessions(user_id: Optional[str] = None, _a=Depends(require_admin)):
    """List all sessions across users (or for a specific user), with live status from sidecar."""
    import httpx
    q = {"owner_id": user_id} if user_id else {}
    docs = [s async for s in db.sessions.find(q).sort("created_at", 1)]
    # Enrich with user email
    user_cache: Dict[str, dict] = {}
    async def _uinfo(uid):
        if uid not in user_cache:
            u = await db.users.find_one({"_id": ObjectId(uid)}) if uid else None
            user_cache[uid] = u or {}
        return user_cache[uid]
    live = {}
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{WA_SIDECAR_URL}/sessions", headers=sidecar_headers())
        if r.status_code < 400:
            live = {s["id"]: s for s in r.json().get("sessions", [])}
            reachable = True
    except Exception:
        reachable = False
    out = []
    for d in docs:
        uinfo = await _uinfo(d["owner_id"])
        s = live.get(d["sidecar_id"], {})
        me = s.get("me") if reachable else None
        # Extract phone from me.id (Baileys returns e.g. "919999999999:1@s.whatsapp.net")
        phone = None
        if isinstance(me, dict) and isinstance(me.get("id"), str):
            raw = me["id"].split("@", 1)[0].split(":", 1)[0]
            phone = raw or None
        elif isinstance(me, str):
            raw = me.split("@", 1)[0].split(":", 1)[0]
            phone = raw or None
        status_str = s.get("status") if reachable else "unknown"
        if reachable and not status_str:
            status_str = "disconnected"
        out.append({
            "owner_id": d["owner_id"],
            "owner_email": uinfo.get("email"),
            "owner_name": uinfo.get("name"),
            "slug": d["slug"],
            "sidecar_id": d["sidecar_id"],
            "status": status_str,
            "connected": bool(s.get("ready", False)),
            "ready": bool(s.get("ready", False)),
            "phone": phone,
            "me": me,
            "sidecar_reachable": reachable,
        })
    return {"sessions": out}

@router.post("/admin/send/text")
async def admin_send_text(body: AdminSendTextIn, admin=Depends(require_admin)):
    """Admin sends a text message via any user's WhatsApp session."""
    import httpx
    from datetime import datetime as _dt, timezone as _tz
    session = await db.sessions.find_one({"owner_id": body.user_id, "slug": body.session_slug})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found for this user")
    async with httpx.AsyncClient(timeout=30) as c:
        try:
            r = await c.post(f"{WA_SIDECAR_URL}/sessions/{session['sidecar_id']}/send-text",
                             headers=sidecar_headers(), json={"to": body.to, "text": body.text})
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"WhatsApp sidecar unreachable: {e}")
    payload = r.json() if r.content else {}
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=payload)
    # Log in the owner's message stream + tag as admin_action
    now = _dt.now(_tz.utc)
    doc = {
        "owner_id": body.user_id, "session_id": body.session_slug,
        "sidecar_id": session["sidecar_id"],
        "direction": "outgoing", "remote_jid": payload.get("jid"),
        "message_id": payload.get("messageId"),
        "text": body.text, "media_type": None, "status": "pending",
        "timestamp": int(now.timestamp()),
        "created_at": now.isoformat(),
        "admin_action": True, "admin_email": admin.get("email"),
    }
    res = await db.messages.insert_one(doc)
    doc["id"] = str(res.inserted_id); doc.pop("_id", None)
    return {"ok": True, "messageId": payload.get("messageId"), "jid": payload.get("jid"), "log_id": doc["id"]}

# ---------- Admin: stats overview ----------
@router.get("/admin/overview")
async def admin_overview(_a=Depends(require_admin)):
    total_users = await db.users.count_documents({"role": "user"})
    pending_users = await db.users.count_documents({"role": "user", "status": "pending"})
    suspended_users = await db.users.count_documents({"role": "user", "status": "suspended"})
    active_users = await db.users.count_documents({
        "role": "user", "status": "approved",
        "subscription_expires_at": {"$gt": now_iso()}
    })
    pending_payments = await db.payments.count_documents({"status": "submitted"})
    verified_payments = await db.payments.count_documents({"status": "verified"})
    total_plans = await db.plans.count_documents({})
    new_messages = await db.contact_messages.count_documents({"status": "new"})
    return {
        "users": {"total": total_users, "pending": pending_users, "active": active_users, "suspended": suspended_users},
        "payments": {"awaiting_verification": pending_payments, "verified": verified_payments},
        "plans_count": total_plans,
        "unread_messages": new_messages,
    }
