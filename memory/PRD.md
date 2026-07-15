# PRD – Unofficial WhatsApp API (Baileys)

## Original problem statement
> Can u able to build unofficial whatsapp api for my own server and own use not for marketing.
> Additional needs (from clarifications): API usable from CRM/software, API guide/docs page, test message with media, rule-based chatbot for auto-reply, multi-session, webhook forwarding, admin login + API key auth, both QR and pairing code login.

## User personas
- **Server operator (admin)**: sets up the server, connects their own WhatsApp number(s), configures auto-reply rules & webhooks, generates API keys.
- **CRM / external service**: consumes the public REST API using a Bearer API key to send messages and receive webhooks.

## Architecture
- **Node.js Baileys sidecar** (`/app/wa-sidecar`, port 3002 – bound to 127.0.0.1) — all WhatsApp connections via `@whiskeysockets/baileys`. Auth stored under `/app/wa-sidecar/sessions/{id}/`.
- **FastAPI backend** (`/app/backend/server.py`, port 8001) — JWT admin auth (cookies), API-key Bearer for public endpoints, MongoDB storage, sidecar proxy, rule engine, webhook fan-out, message logging, Swagger docs at `/docs`.
- **React frontend** (`/app/frontend`, port 3000) — brutalist terminal-style dashboard.
- **MongoDB** — users, api_keys, rules, webhooks, messages.

## Core requirements (static)
1. Multi-session WhatsApp connectivity (QR or pairing code).
2. Send text and media (image/video/audio/document) individually or as broadcast.
3. Group management (create, add/remove/promote/demote participants, list).
4. Incoming message capture → log + fan-out to configured webhooks → optional rule-based auto-reply.
5. Rule engine: match_type ∈ {contains, exact, starts_with, regex}, per-session, toggleable.
6. API-key authentication for a `/api/v1/*` public API (create, revoke, mask, usage tracking).
7. Admin dashboard behind email/password JWT login.
8. OpenAPI/Swagger docs auto-published at `/docs`, plus a hand-authored reference page.

## Implemented (Jan 15, 2026)
- Sidecar service (Baileys) with all endpoints (sessions, send-text, send-media, broadcast, groups, participants).
- Backend routers: auth (login/logout/me/refresh), sessions (proxy + pairing), send, broadcast, rules CRUD, webhooks CRUD + test, logs, api-keys, stats, internal callback (sidecar → backend), public v1 API (Bearer).
- Rule engine (contains/exact/starts_with/regex).
- Webhook fan-out with last_fired_at / last_status tracking.
- Frontend dashboard: Login, Overview (stats + live logs), Sessions (QR + pairing code UI), Send Playground (text & media), Auto-Reply Rules, Webhooks, Logs viewer with filters, API Keys with copy-once modal, API Docs page.
- Supervisor entry `wa_sidecar` added to `/etc/supervisor/conf.d/wa_sidecar.conf`.
- Admin seeded on startup: `admin@example.com` / `admin123`.

## Test status
- Backend: 39/39 pytest tests pass (auth, CRUD, api-key gating, sidecar-token gating, stats, logs, incoming callback + rule persistence).
- Frontend: 12/12 UI flows verified via Playwright (login → dashboard → all pages, sessions create/delete, rules create/toggle/delete, api-keys create/mask/revoke).

## Prioritized backlog
### P1
- CORS: replace `*` with explicit origin when `allow_credentials=True` (safe today because ingress serves both on same origin).
- Rate-limit `/api/auth/login` (brute-force lockout after N fails).
- Split `server.py` into per-domain routers before further growth.

### P2
- Contacts sync + search page.
- Message status tracking (sent/delivered/read).
- Groups management UI (currently only via API).
- Rule engine: business-hours-only mode, delay/typing indicator.
- Websocket push to frontend for live session/message updates (currently polled every 3-5s).

### Nice-to-have
- Multi-tenant users (currently single admin).
- Per-API-key scopes (send-only, read-only, etc.) and per-key rate limits.
- Export logs as CSV / JSON.

## Next action items
1. If deployed publicly, tighten CORS + set `secure=True` cookies over HTTPS.
2. Optionally add brute-force protection on login.
3. Extend rules engine or add groups UI when needed.
