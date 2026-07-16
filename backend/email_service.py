"""
SMTP config + email templates + async send helper.
Config is stored in db.settings (key='smtp').
"""
import asyncio
import ssl
import smtplib
from email.message import EmailMessage
from typing import Optional, Dict, Any

from core import db, logger, now_iso


SMTP_SETTINGS_KEY = "smtp"


DEFAULT_SMTP = {
    "key": SMTP_SETTINGS_KEY,
    "host": "",
    "port": 587,
    "username": "",
    "password": "",
    "use_tls": True,   # STARTTLS on 587
    "use_ssl": False,  # SMTPS on 465
    "from_name": "",
    "from_email": "",
    "enabled": False,
}


async def get_smtp_config() -> Dict[str, Any]:
    doc = await db.settings.find_one({"key": SMTP_SETTINGS_KEY})
    if not doc:
        return dict(DEFAULT_SMTP)
    doc.pop("_id", None)
    # Merge defaults
    out = dict(DEFAULT_SMTP)
    out.update(doc)
    return out


async def save_smtp_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    data = {**cfg, "key": SMTP_SETTINGS_KEY, "updated_at": now_iso()}
    await db.settings.update_one({"key": SMTP_SETTINGS_KEY}, {"$set": data}, upsert=True)
    return data


def _mask_password(cfg: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cfg)
    if out.get("password"):
        out["password"] = "•" * 8
    return out


def _send_sync(cfg: Dict[str, Any], to_email: str, subject: str,
               text_body: str, html_body: Optional[str] = None) -> None:
    """Sync SMTP send. Called via asyncio.to_thread."""
    host = (cfg.get("host") or "").strip()
    port = int(cfg.get("port") or 587)
    username = (cfg.get("username") or "").strip()
    password = cfg.get("password") or ""
    use_ssl = bool(cfg.get("use_ssl"))
    use_tls = bool(cfg.get("use_tls"))
    from_name = (cfg.get("from_name") or "").strip()
    from_email = (cfg.get("from_email") or username or "").strip()

    if not host or not from_email:
        raise RuntimeError("SMTP not configured (host / from_email missing)")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
    msg["To"] = to_email
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    ctx = ssl.create_default_context()
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as s:
            if username:
                s.login(username, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.ehlo()
            if use_tls:
                s.starttls(context=ctx)
                s.ehlo()
            if username:
                s.login(username, password)
            s.send_message(msg)


async def send_email(to_email: str, subject: str, text_body: str,
                     html_body: Optional[str] = None,
                     override_cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Send an email using saved SMTP config (or the provided override).
    Returns {"ok": bool, "error": str|None}."""
    cfg = override_cfg or await get_smtp_config()
    if not cfg.get("enabled") and not override_cfg:
        return {"ok": False, "error": "SMTP is not enabled in admin settings"}
    try:
        await asyncio.to_thread(_send_sync, cfg, to_email, subject, text_body, html_body)
        return {"ok": True, "error": None}
    except Exception as e:
        logger.error("SMTP send failed to %s: %s", to_email, e)
        return {"ok": False, "error": str(e)}


# ---------- Email templates ----------
def brand_wrap(inner_html: str, brand: str = "WA_API") -> str:
    return f"""
    <div style="background:#f7f8f9;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif;color:#111">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#075E54,#128C7E);color:#fff;padding:22px 28px">
          <div style="font-size:20px;font-weight:700;letter-spacing:.3px">{brand}</div>
          <div style="opacity:.85;font-size:13px;margin-top:2px">WhatsApp automation for humans</div>
        </div>
        <div style="padding:28px">{inner_html}</div>
        <div style="padding:16px 28px;background:#fafafa;color:#6b7280;font-size:12px;border-top:1px solid #eee">
          This email was sent by {brand}. If you didn't expect this, please ignore.
        </div>
      </div>
    </div>
    """


def welcome_email_html(name: str, email: str, password: str, login_url: str, brand: str) -> str:
    inner = f"""
      <h2 style="margin:0 0 8px 0;font-size:22px">Welcome, {name} 👋</h2>
      <p style="color:#374151;line-height:1.55">Your workspace has been created by our administrator. You can now sign in using the credentials below.</p>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;padding:16px 18px;border-radius:12px;margin:16px 0">
        <div style="font-size:13px;color:#065F46;margin-bottom:6px">Login details</div>
        <div><strong>Email:</strong> {email}</div>
        <div><strong>Password:</strong> {password}</div>
      </div>
      <p style="color:#6b7280;font-size:13px">For security, change your password after your first login.</p>
      <p style="margin-top:22px"><a href="{login_url}" style="background:#25D366;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Sign in</a></p>
    """
    return brand_wrap(inner, brand)


def otp_email_html(name: str, otp: str, brand: str) -> str:
    inner = f"""
      <h2 style="margin:0 0 8px 0;font-size:22px">Password reset code</h2>
      <p style="color:#374151;line-height:1.55">Hi {name or 'there'}, use the code below to reset your password. It expires in 10 minutes.</p>
      <div style="text-align:center;margin:24px 0">
        <div style="display:inline-block;font-family:monospace;font-size:32px;letter-spacing:8px;background:#F0FDF4;color:#065F46;border:1px dashed #86EFAC;padding:16px 24px;border-radius:12px">{otp}</div>
      </div>
      <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    """
    return brand_wrap(inner, brand)


def test_email_html(brand: str) -> str:
    inner = f"""
      <h2 style="margin:0 0 8px 0;font-size:22px">SMTP is working ✅</h2>
      <p style="color:#374151;line-height:1.55">This is a test message from your {brand} admin panel. If you can read this, your SMTP configuration is valid and outgoing mail will work.</p>
    """
    return brand_wrap(inner, brand)


def admin_password_changed_html(brand: str) -> str:
    inner = f"""
      <h2 style="margin:0 0 8px 0;font-size:22px">Your password was changed</h2>
      <p style="color:#374151;line-height:1.55">Hi, your account password was just updated. If this wasn't you, contact the administrator immediately.</p>
    """
    return brand_wrap(inner, brand)
