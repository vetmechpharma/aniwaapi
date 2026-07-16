# PRD – Unofficial WhatsApp API (Baileys)

## Original problem statement
> Can u able to build unofficial whatsapp api for my own server and own use not for marketing.

## User personas
- **Server operator (admin)** — connects WhatsApp numbers, configures rules, business hours, webhooks, generates API keys.
- **CRM / external service** — consumes `/api/v1/*` with a scoped Bearer API key.

## Architecture
- **Node.js Baileys sidecar** (`/app/wa-sidecar`, port 3002, 127.0.0.1 only). Multi-session via `@whiskeysockets/baileys`. Session auth stored under `/app/wa-sidecar/sessions/{id}/`. Emits `messages.upsert`, `messages.update`, `message-receipt.update`, `connection.update` → forwards to backend `/api/internal/incoming`.
- **FastAPI backend** (`/app/backend/server.py`, port 8001, v1.1.0). JWT admin auth with cookies, brute-force lockout, API-key Bearer with scopes + rate limits, MongoDB storage, sidecar proxy, rule engine + business hours, webhook fan-out, WebSocket push (`/api/ws`), Swagger docs at `/docs`.
- **React frontend** (`/app/frontend`). Brutalist terminal-style dashboard with live WS-driven updates.
- **MongoDB** — users, api_keys, rules, webhooks, messages, business_hours.
- **Supervisor** manages backend + frontend + wa_sidecar + mongodb + code-server + nginx.

## Core requirements (static)
1. Multi-session WhatsApp connectivity (QR + pairing code).
2. Send text/media (image/video/audio/document) + broadcast + group management.
3. Incoming capture → log + webhook fan-out + optional rule-based auto-reply.
4. Rule engine: match_type ∈ {contains, exact, starts_with, regex}, per-session.
5. **Business-hours mode**: skip auto-reply during working hours (human handles), send fallback outside.
6. **Message status tracking**: sent/delivered/read ticks pushed via Baileys events.
7. **WebSocket push** for real-time dashboard updates.
8. Admin JWT login with **brute-force lockout** (5 fails → 15-min lock).
9. Public API `/api/v1/*` with **per-key scopes + rate limits**.
10. Tight CORS: explicit origins with credentials when `FRONTEND_ORIGIN` set; `*` w/o credentials otherwise.
11. OpenAPI/Swagger at `/docs` + hand-authored API reference page.

## Implemented

### Iteration 1 (Jan 15, 2026)
- Sidecar: sessions/send-text/send-media/broadcast/groups/participants
- Backend: auth, sessions, send, broadcast, rules CRUD, webhooks CRUD+test, logs, api-keys, stats, internal callback, public v1
- Rule engine (contains/exact/starts_with/regex), webhook fan-out
- Frontend: Login, Overview, Sessions (QR+pairing), Send Playground, Auto-Reply, Webhooks, Logs, API Keys, API Docs
- Admin seed on startup

### Iteration 2 (Jan 15, 2026) — this session
- **Business-hours mode**: `/api/business-hours/{session_id}` GET/PUT; per-session `enabled`, `timezone` (IANA), `days` (0=Mon..6=Sun), `start_time`/`end_time`, `fallback_message`, `also_use_rules_outside`. Handles overnight windows (e.g. 22:00→06:00). Rule engine skips replies during business hours; sends fallback outside (or rule match wins if `also_use_rules_outside`).
- **Message status tracking**: sidecar hooks `messages.update` + `message-receipt.update`; backend maps 1→pending, 2→sent, 3→delivered, 4→read, 5→played. Logs page renders ✓ / ✓✓ / ✓✓ (blue) via Phosphor `Check`/`Checks`.
- **WebSocket push** (`/api/ws`, cookie-auth): backend `WSManager` broadcasts `{type: message|status|connection}`. Frontend `RealtimeProvider` with auto-reconnect, heartbeat, per-type subscribe. Overview shows LIVE/OFFLINE badge; Logs updates in real-time.
- **Per-API-key scopes** (`send:text`, `send:media`, `broadcast`, `sessions:read`, `groups:read`, `groups:write`, `logs:read`) + **rate limits** (req/min, 0 = unlimited). In-memory sliding-window per key. `require_scope()` dependency factory. UI: multi-toggle scope selector + rate limit input.
- **Brute-force lockout**: track `failed_logins` + `locked_until` per user; 5 fails → 15-min lock; correct password during lock returns 429 with remaining time.
- **CORS**: `FRONTEND_ORIGIN` env → explicit origins with `allow_credentials=True`; else `*` without credentials. Cookies use env-driven `COOKIE_SECURE` + `COOKIE_SAMESITE`.
- **Public API additions**: `/api/v1/logs` (scope `logs:read`).

## Test status
- **Iteration 1**: 39/39 backend + 12/12 UI ✓
- **Iteration 2**: 24/24 backend features validated (lockout, business hours logic, status mapping, scope enforcement, rate limit, WS auth/broadcast); UI verified via live screenshots on real connected session showing ✓✓ (delivered) and ◷ (pending) ticks.

## Prioritized backlog
### P1
- Split `server.py` (~970 lines) into per-domain routers.
- Contacts sync + tagging (foundation for segmented broadcast).
- Groups management UI (API works, UI missing).

### P2
- Business-hours holiday exceptions (e.g. "closed Dec 25").
- Delayed / typing-indicator auto-reply for more human feel.
- Rate-limit sliding-window backed by Mongo (survives restart + multi-worker).
- Per-scope rate limits (e.g. broadcast burst limits).
- Export logs to CSV.

### Nice-to-have
- Multi-tenant admin users with roles.
- Message templates library (reusable snippets with variables).
- Dashboard notifications (in-tab sound / desktop notification on incoming).

## Next action items
1. Add contact tagging + segmented broadcast (turns this into a small CRM messaging hub).
2. Groups management UI.
3. Consider splitting `server.py` before more features land.
