# PRD – WhatsApp API SaaS (Baileys)

## Original problem statement
> Personal WhatsApp API → grown into a multi-tenant SaaS with subscriptions, UPI QR payments, user approval workflow, and a public marketing site (landing / features / pricing / contact / register / login).

## User personas
- **Site visitor** — sees the marketing site: landing, features, pricing, contact.
- **Subscriber** — registers, awaits admin approval, subscribes, uses isolated WhatsApp workspace.
- **SaaS admin** — approves users, sets plans/prices, verifies payments, reads contact-form messages, adds users manually, edits billing settings.
- **External CRM** — hits `/api/v1/*` with subscriber's scoped Bearer key.

## URL map
### Public
- `/` — Landing (hero, features, how-it-works, pricing preview, CTA)
- `/features` — full feature grid grouped in 3 pillars (Messaging / Automation / Developer)
- `/pricing` — all active plans
- `/contact` — form + contact info
- `/login`, `/register`, `/forgot-password`, `/reset-password`

### App (subscriber)
- `/app` (Overview), `/app/sessions`, `/app/send`, `/app/rules`, `/app/webhooks`, `/app/logs`, `/app/keys`, `/app/billing`, `/app/docs`

### Admin
- `/admin` (Overview), `/admin/users`, `/admin/plans`, `/admin/payments`, `/admin/messages`, `/admin/settings`

## Architecture (v2.1.0)
### Frontend design system (2 aesthetics)
- **Public / marketing** = elegant editorial. **Instrument Serif** italic for display + **Inter** for body. Dark background with soft radial-glow gradients + subtle grid. Pill buttons, rounded cards, generous whitespace, subtle green accents.
- **Dashboard** = brutalist terminal (IBM Plex Sans + JetBrains Mono, sharp borders, neon green). Kept from v2.0.
- Both share the same brand color (`#00E559`) so the transition from marketing → app feels continuous.

### Backend (unchanged from v2.0 + new endpoints)
New endpoints this iteration:
- `POST /api/contact` (public) — stores contact-form submissions
- `GET /api/site-info` (public) — brand/contact for public headers/footers
- `POST /api/admin/users` (admin) — manually create a user, optionally with plan + custom validity
- `GET /api/admin/messages`, `POST /api/admin/messages/{id}/mark-read`, `DELETE /api/admin/messages/{id}`
- `admin_overview` now returns `unread_messages` count

### New MongoDB collections
- `contact_messages` — {name, email, phone, subject, message, status: new/read, created_at}

## Iteration 4 (this session) — marketing site + admin add-user + contact
1. **Elegant marketing site** with 4 public pages (Landing / Features / Pricing / Contact) + restyled Login / Register / ForgotPassword / ResetPassword using Instrument Serif + Inter.
2. **PublicNav** with logo, home/features/pricing/contact + Login/Get-started CTAs; **PublicFooter** with quick links + contact info sourced from admin settings.
3. **Landing page** hero, 8-feature grid, 4-step "How it works", 3-plan pricing preview, CTA band.
4. **Features page** with 3-pillar grouping and detailed cards.
5. **Contact page** with form + info sidebar + success state; messages stored server-side.
6. **Admin can add users manually** via a rich form on `/admin/users` — full profile fields + role/status + optional plan assignment + optional validity override. Auto-approved by default; subscription auto-activated when plan given.
7. **Admin Messages page** shows contact submissions with mark-read, delete, and mailto-reply.
8. **Route restructure**: `/` is now the public landing (unauth) or auto-redirect to `/app`/`/admin` (auth). All app pages moved under `/app/*` for clarity.

## Test status (this iteration, curl)
- ✅ Contact submit → admin sees in queue
- ✅ Site-info returns brand
- ✅ Admin creates user with plan → user logs in immediately with active subscription
- ✅ Frontend compiles cleanly, all public pages render with proper typography

## Prioritized backlog
### P1
- Payment gateway (Razorpay UPI intent) for auto-verification instead of manual UTR entry
- Email service (Resend/SendGrid) for approval / reset / expiry / contact-reply
- Cron: subscription renewal reminders (7d / 3d / 1d before expiry)

### P2
- Invoice PDF on verified payment
- Coupon codes / prorated upgrades
- Bulk user actions (approve many, suspend by inactivity)
- Contacts tagging + segmented broadcast (in-app)

### Nice-to-have
- 2FA (TOTP) for admin
- Audit log
- Team members per subscriber
- Referral / affiliate system with tracking
- Dark/light mode toggle for public site
