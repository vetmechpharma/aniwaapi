# PRD – Unofficial WhatsApp API SaaS (Baileys)

## Original problem statement
> Build unofficial WhatsApp API for personal / server use, later extended into a multi-tenant SaaS with subscription plans, UPI QR payments, user registration + admin approval, suspension/deletion, forgot-password, and per-user isolation with plan enforcement.

## User personas
- **SaaS admin (owner)** — manages users, plans, payments, billing settings. Unlimited access to all WhatsApp features.
- **Subscriber (user)** — registers publicly, awaits approval, pays via UPI QR, uses isolated WhatsApp sessions/rules/webhooks/api-keys within plan limits.
- **External CRM / consumer** — uses a subscriber's scoped Bearer API key against `/api/v1/*`.

## Architecture (v2.0.0)
### Backend (`/app/backend/`, port 8001)
- **`core.py`** — env, Mongo client, JWT/bcrypt, auth deps (`get_current_user`, `require_admin`, `require_active_user`, `require_approved_user`), scope + rate limit, per-owner WSManager, QR helpers.
- **`auth_and_internal.py`** — login (with brute-force lockout), refresh, logout, me + internal sidecar callback (message / status / connection) + WebSocket endpoint.
- **`saas.py`** — register, forgot/reset password, admin (users approve/suspend/unsuspend/delete + reset-link generator), plans CRUD, payments verify/reject + screenshot, settings (UPI VPA), overview, billing summary + create-payment (QR PNG) + submit-utr + my-payments.
- **`whatsapp_api.py`** — sessions/send/groups/rules/business-hours/webhooks/logs/api-keys/stats/public v1, all scoped by `owner_id`, sidecar IDs namespaced per-user (`u<12>_<slug>`), plan-limit enforcement (`max_sessions`, `max_messages_per_day`, `max_api_keys`).
- **`server.py`** — assembler: routers + startup migrations (indexes, admin seed, default plans, billing settings, legacy sidecar-session backfill) + CORS + `/api/ws`.

### Node.js Baileys sidecar (`/app/wa-sidecar/`, port 3002 internal)
- Unchanged from v1.1. Session IDs are user-namespaced by backend before sidecar sees them.

### React frontend (`/app/frontend/`)
- **Public**: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/pricing`
- **Subscriber**: Overview, Sessions, Send, Auto-Reply (rules + business hours), Webhooks, Logs (with status ticks), API Keys (scopes + rate), Billing (subscription summary, UPI QR + UTR submit, payment history), API Docs.
- **Admin panel** (visible only to admin): Admin Home (stats), Users (approve / suspend / unsuspend / delete / reset-link), Plans (full CRUD), Payments (queue + verify/reject + screenshot viewer), Settings (UPI VPA + branding).
- **Role-based sidebar** switches between "Console" and "Admin Panel".
- Sidebar shows subscription card with plan name + days remaining for subscribers.

### MongoDB collections
- `users` — email, password_hash, name, company, phone, alt_phone, location, role, status (pending/approved/suspended/deleted), current_plan_id, subscription_expires_at, failed_logins, locked_until, timestamps.
- `plans` — name, description, price_inr, price_usd, validity_days, max_sessions, max_messages_per_day, max_api_keys, features[], active, sort_order.
- `payments` — user_id, plan_id, amount, currency, upi_vpa, upi_url, reference, utr_number, screenshot_path, status (pending/submitted/verified/rejected), admin_notes, timestamps.
- `password_resets` — user_id, email, token, expires_at, used, status, granted_by_admin.
- `settings` — singleton `{key: billing}` with upi_vpa, upi_payee_name, contact_email/phone, company_name.
- `sessions` — `{owner_id, slug, sidecar_id}` — maps user-facing slug ↔ globally-unique sidecar ID.
- `daily_usage` — `{user_id, date, messages_sent}` — plan quota tracking.
- `rules`, `webhooks`, `api_keys`, `messages`, `business_hours` — all now have `owner_id`.

## Multi-tenancy guarantees
- Every WhatsApp-scoped endpoint filters `db.<coll>.find({owner_id: current_user.id, ...})`.
- Session slugs are namespaced (`u{userIdShort}_{slug}`) before hitting sidecar — no cross-tenant collisions.
- Incoming messages from sidecar are attributed via reverse `sidecar_id` lookup.
- Public API `/api/v1/*` inherits owner from the API key. If owner is suspended, deleted, or subscription expired → all their keys stop working (402/403).
- Admin has unlimited limits internally (`max_sessions=999`, `max_messages_per_day=1B`).

## Iteration 3 (this session) — SaaS features shipped
1. **Registration** with full profile: name, company, email, phone, alt_phone, location.
2. **Admin approval workflow**: pending → approved → (paid) → active.
3. **Suspension** (with reason shown to user) + unsuspend + delete (cascade cleanup).
4. **Admin-configurable plans** (name, INR + USD price, validity, max sessions/msgs/api-keys, features, active, sort_order) with 4 seeded defaults (Free Trial, Basic, Pro, Enterprise).
5. **UPI QR payment flow**: user picks plan → backend builds `upi://pay?...` URL → renders PNG QR (base64) → user pays → submits UTR + optional screenshot → admin verifies from panel → subscription activates (extends if still valid).
6. **Forgot-password (admin-mediated)**: user submits → admin generates one-time reset link (24h) → copies to share → user resets.
7. **Plan enforcement**: max_sessions blocks session create (402), max_messages_per_day blocks send (429), max_api_keys blocks key create (402).
8. **CORS + cookies** already hardened in iteration 2 via `FRONTEND_ORIGIN` / `COOKIE_SECURE`.
9. **Public `/pricing` page** with plan cards and CTA.

## Tested (curl end-to-end)
- ✅ Register → login blocked (pending) → admin approves → login OK
- ✅ Approved user without subscription → 402 on protected routes; billing summary OK
- ✅ UPI VPA save → create-payment returns QR PNG + upi:// URL + reference
- ✅ Submit-UTR → admin sees in "submitted" queue → verify → subscription active (30 days)
- ✅ Session create allowed; second session blocked (plan limit = 1)
- ✅ Forgot-password → admin generates link → reset with new password → old rejected, new accepted
- ✅ Admin suspend → user login blocked with reason; delete → cascade cleanup
- ✅ Admin overview counters correct
- ✅ Existing 'test' session (real WhatsApp) backfilled to admin ownership, still fully functional

## Prioritized backlog
### P1
- **Payment gateway automation**: swap manual UPI → Razorpay UPI intent (auto-verify via webhook).
- **Email service** (Resend/SendGrid): auto-send approval, reset link, payment verified, expiry warning.
- **Renewal reminders**: cron → warn users 7d/3d/1d before expiry.
- **Invoice PDF** generation on verified payment.

### P2
- Contacts tagging + segmented broadcast.
- Groups management UI (currently only via API).
- Admin: bulk approve, bulk plan assign, revenue report.
- Rate-limit sliding-window backed by Mongo/Redis (survives restart + multi-worker).
- Team members per subscriber account.

### Nice-to-have
- 2FA (TOTP) for admin accounts.
- Audit log (who did what, when).
- Coupon codes / prorated upgrades.
- API-key IP allow-listing.

## Next action items
1. Log in as admin → `/admin/settings` → set your **real UPI VPA + name** (right now demo is `admin@ybl`).
2. `/admin/plans` → edit prices / features to match your real offering.
3. Share `/register` and `/pricing` URLs with subscribers.
4. Add email integration (P1) when volume grows.
5. Consider Razorpay/Stripe for automated payment verification.
