"""
Main FastAPI app: wires routers, startup migrations, CORS, WebSocket endpoint.
"""
from core import (
    db, mongo, logger, hash_password, verify_password,
    ADMIN_EMAIL, ADMIN_PASSWORD, FRONTEND_ORIGIN,
    now_iso, WA_SIDECAR_URL,
)

from fastapi import FastAPI, WebSocket
from starlette.middleware.cors import CORSMiddleware
import httpx
from core import sidecar_headers

from auth_and_internal import auth_router, internal_router, ws_handler
from saas import router as saas_router
from whatsapp_api import router as wa_router

app = FastAPI(title="Unofficial WhatsApp API — SaaS", version="2.0.0",
              description="Multi-tenant self-hosted WhatsApp API. Personal / small-business use only.")

# ---------- Startup ----------
DEFAULT_PLANS = [
    {"name": "Free Trial", "description": "7-day trial to explore the platform.",
     "price_inr": 0, "price_usd": 0, "validity_days": 7,
     "max_sessions": 1, "max_messages_per_day": 100, "max_api_keys": 1,
     "features": ["1 WhatsApp session", "100 messages / day", "1 API key", "Auto-reply rules"],
     "active": True, "sort_order": 0},
    {"name": "Basic", "description": "For personal use and small workflows.",
     "price_inr": 499, "price_usd": 9, "validity_days": 30,
     "max_sessions": 1, "max_messages_per_day": 1000, "max_api_keys": 2,
     "features": ["1 WhatsApp session", "1,000 messages / day", "2 API keys", "Webhooks", "Business hours"],
     "active": True, "sort_order": 1},
    {"name": "Pro", "description": "For small teams and CRMs.",
     "price_inr": 1499, "price_usd": 29, "validity_days": 30,
     "max_sessions": 3, "max_messages_per_day": 10000, "max_api_keys": 5,
     "features": ["3 WhatsApp sessions", "10,000 messages / day", "5 API keys", "Webhooks + WS realtime", "Priority support"],
     "active": True, "sort_order": 2},
    {"name": "Enterprise", "description": "For heavy workloads.",
     "price_inr": 4999, "price_usd": 99, "validity_days": 30,
     "max_sessions": 10, "max_messages_per_day": 100000, "max_api_keys": 20,
     "features": ["10 sessions", "100,000 messages / day", "20 API keys", "All features"],
     "active": True, "sort_order": 3},
]

@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.api_keys.create_index("key", unique=True)
    await db.rules.create_index([("owner_id", 1), ("session_id", 1)])
    await db.webhooks.create_index([("owner_id", 1), ("session_id", 1)])
    await db.messages.create_index([("owner_id", 1), ("timestamp", -1)])
    await db.messages.create_index("message_id")
    await db.messages.create_index([("sidecar_id", 1), ("message_id", 1)])
    await db.messages.create_index("created_at")
    await db.business_hours.create_index([("owner_id", 1), ("session_id", 1)], unique=True)
    await db.sessions.create_index([("owner_id", 1), ("slug", 1)], unique=True)
    await db.sessions.create_index("sidecar_id", unique=True)
    await db.daily_usage.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.plans.create_index("sort_order")
    await db.payments.create_index([("user_id", 1), ("created_at", -1)])
    await db.password_resets.create_index("token")

    # Seed admin
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if existing is None:
        await db.users.insert_one({
            "email": ADMIN_EMAIL, "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Administrator", "company": "", "phone": "", "alt_phone": "", "location": "",
            "role": "admin", "status": "approved",
            "current_plan_id": None, "subscription_expires_at": None,
            "failed_logins": 0, "locked_until": None,
            "created_at": now_iso(),
        })
        logger.info("Seeded admin user %s", ADMIN_EMAIL)
    else:
        upd = {}
        if existing.get("role") != "admin":
            upd["role"] = "admin"
        if existing.get("status") != "approved":
            upd["status"] = "approved"
        for k in ("company", "phone", "alt_phone", "location"):
            if existing.get(k) is None:
                upd[k] = ""
        if not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
            upd["password_hash"] = hash_password(ADMIN_PASSWORD)
        if upd:
            await db.users.update_one({"_id": existing["_id"]}, {"$set": upd})
            logger.info("Updated admin user %s: %s", ADMIN_EMAIL, list(upd.keys()))

    # Backfill: existing (non-admin) users default to approved status if missing (legacy)
    await db.users.update_many({"status": {"$exists": False}}, {"$set": {"status": "approved", "role": "user"}})

    # Seed default plans if none
    if await db.plans.count_documents({}) == 0:
        for p in DEFAULT_PLANS:
            p["created_at"] = now_iso(); p["updated_at"] = now_iso()
        await db.plans.insert_many(DEFAULT_PLANS)
        logger.info("Seeded %d default plans", len(DEFAULT_PLANS))

    # Seed default billing settings if none
    if not await db.settings.find_one({"key": "billing"}):
        await db.settings.insert_one({
            "key": "billing", "upi_vpa": "", "upi_payee_name": "",
            "contact_email": ADMIN_EMAIL, "contact_phone": "",
            "invoice_note": "Thank you for subscribing.",
            "company_name": "WA_API SaaS",
            "created_at": now_iso(),
        })

    # Backfill legacy 'sessions' documents in sidecar that don't have a mapping.
    # Existing session directories on disk keep working for admin via full-name access.
    # But list_sessions filters by owner_id, so admin legacy sessions won't appear.
    # We reconcile: for any sidecar session named `u<12chars>_<slug>`, if unmapped, attribute to that user; else assign to admin.
    try:
        r = await sidecar_call_boot()
        if r and r.status_code == 200:
            sidecar_sessions = (r.json() or {}).get("sessions", [])
            admin_doc = await db.users.find_one({"email": ADMIN_EMAIL})
            admin_id = str(admin_doc["_id"]) if admin_doc else None
            for s in sidecar_sessions:
                sid = s["id"]
                if await db.sessions.find_one({"sidecar_id": sid}):
                    continue
                # Try to parse pattern "u<12>_<slug>"
                owner_id = admin_id
                slug = sid
                if sid.startswith("u") and "_" in sid:
                    tail = sid[1:].split("_", 1)
                    if len(tail) == 2 and len(tail[0]) == 12:
                        # find user whose id ends with tail[0]
                        async for u in db.users.find({}):
                            if str(u["_id"]).endswith(tail[0]):
                                owner_id = str(u["_id"]); slug = tail[1]; break
                if owner_id:
                    try:
                        await db.sessions.insert_one({
                            "owner_id": owner_id, "slug": slug, "sidecar_id": sid,
                            "created_at": now_iso(), "legacy_backfill": True,
                        })
                        logger.info("Backfilled session %s -> owner=%s slug=%s", sid, owner_id, slug)
                    except Exception as e:
                        logger.warning("Backfill skipped for %s: %s", sid, e)
    except Exception as e:
        logger.warning("Sidecar backfill on boot skipped: %s", e)

async def sidecar_call_boot():
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            return await c.get(f"{WA_SIDECAR_URL}/sessions", headers=sidecar_headers())
    except Exception:
        return None

@app.on_event("shutdown")
async def shutdown():
    mongo.close()

# ---------- Health ----------
from fastapi import APIRouter
misc = APIRouter(prefix="/api")

@misc.get("/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{WA_SIDECAR_URL}/health", headers=sidecar_headers())
        sidecar_ok = r.status_code == 200
    except Exception:
        sidecar_ok = False
    return {"ok": True, "sidecar": sidecar_ok, "version": app.version}

# ---------- Routers ----------
app.include_router(auth_router)
app.include_router(saas_router)
app.include_router(wa_router)
app.include_router(internal_router)
app.include_router(misc)

# ---------- WebSocket ----------
@app.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket):
    await ws_handler(websocket)

# ---------- CORS ----------
if FRONTEND_ORIGIN:
    origins = [o.strip() for o in FRONTEND_ORIGIN.split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_credentials=True,
                       allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
else:
    app.add_middleware(CORSMiddleware, allow_credentials=False,
                       allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
