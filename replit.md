# Hotel CRM – Workspace

## Overview

Cross-platform Mobile Hotel CRM built with Expo React Native (web + iOS + Android) and a centralized PostgreSQL/Express API backend. pnpm workspace monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mobile**: Expo SDK 53, Expo Router v6 (file-based routing)
- **API framework**: Express 5 + JWT auth
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **State management**: TanStack React Query v5
- **Charts**: react-native-chart-kit + react-native-svg

## Project Goal

A full Hotel CRM system with:
- JWT authentication with RBAC (Admin / Owner / Manager roles)
- Hotel, user, agency CRUD operations
- Booking management with real-time cost calculation (Total = Room Rent + Add-ons, Balance = Total - Receipt)
- Payment updates
- Email notifications on booking changes (nodemailer, optional via SMTP env vars)
- Dashboard: today's check-ins/check-outs, occupancy bar
- Monthly booking calendar with filtering and search
- Analytics: occupancy pie/bar charts, revenue by month and agency

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API backend (port via $PORT)
│   └── mobile/             # Expo React Native app (previewPath: /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
│   └── src/seed.ts         # Database seeding script
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Mobile App Routes (`artifacts/mobile/app/`)

```
/                       → index.tsx (redirect to login or tabs)
/login                  → login.tsx (JWT login)
/(tabs)/                → tab layout (Dashboard, Bookings, Agencies, Analytics, Admin*)
/(tabs)/index           → Dashboard: stats, occupancy, today's check-ins/outs
/(tabs)/bookings        → Bookings list: month filter, search, status filter
/(tabs)/agencies        → Agencies CRUD
/(tabs)/analytics       → Occupancy pie + daily bar, yearly revenue, agency breakdown
/(tabs)/admin           → Admin only: hotel + user management
/booking/[id]           → Booking detail, edit modal, payment modal
/booking/new            → New booking form with real-time calc
```

## API Routes (`artifacts/api-server/src/routes/`)

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/hotels
POST   /api/hotels
PUT    /api/hotels/:id
DELETE /api/hotels/:id
GET    /api/users
POST   /api/users
PUT    /api/users/:id
DELETE /api/users/:id
GET    /api/agencies
POST   /api/agencies
PUT    /api/agencies/:id
DELETE /api/agencies/:id
GET    /api/bookings
GET    /api/bookings/:id
POST   /api/bookings
PUT    /api/bookings/:id
PATCH  /api/bookings/:id/payment
DELETE /api/bookings/:id
GET    /api/dashboard/stats
GET    /api/dashboard/checkins
GET    /api/dashboard/checkouts
GET    /api/analytics/occupancy
GET    /api/analytics/revenue
```

## Database Schema (`lib/db/src/schema/`)

- `hotels`: id, name, totalRooms, createdAt
- `users`: id, email, name, passwordHash, role (enum: admin/owner/manager), hotelId FK, tokenVersion, createdAt
- `agencies`: id, name, contactEmail, contactPhone, hotelId FK, createdAt
- `bookings`: id, guestName, guestEmail, guestPhone, numberOfRooms, numberOfPersons, checkIn, checkOut, roomRent, addOns, totalCost (auto-calc), receipt, balance (auto-calc), status (enum: confirmed/checked_in/checked_out/cancelled), notes, hotelId FK, agencyId FK, createdAt

## Seeding the first administrator

There are no built-in or demo credentials. `scripts/src/seed.ts` reads the
account to create from the environment and refuses to run without it:

```
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<at least 12 chars>' pnpm --filter @workspace/scripts exec tsx src/seed.ts
```

If this database was ever seeded by an older revision of that script, treat
every account it created as compromised — the passwords are in git history —
and rotate them.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection (auto-provided by Replit)
- `JWT_SECRET` — JWT signing secret (auto-provided or set manually)
- `JWT_EXPIRES_IN` — session token lifetime (default `12h`)
- `AUTH_COOKIE_SAMESITE` — `lax` (default), `strict` or `none`, for the web
  client's session cookie. Use `none` **only** when the API and the web app are
  on different sites, since it is what lets the browser attach the cookie
  cross-site; it forces `Secure`, so that deployment must be HTTPS. Getting this
  wrong is visible immediately — the browser drops the cookie and the web client
  reports that sign-in could not be completed
- `DATABASE_CA_CERT` — PEM certificate authority for the database TLS connection
- `DATABASE_SSL_REJECT_UNAUTHORIZED` — set to `false` only to disable database
  certificate verification; leaves the connection open to interception
- `TRUST_PROXY_HOPS` — number of reverse proxies in front of the API (default `1`).
  Must match the deployment, or rate limiting either collapses to one shared
  bucket or becomes bypassable via `X-Forwarded-For`
- `RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`, `AI_RATE_LIMIT_PER_MINUTE` — request budgets
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` — first admin account
- `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT` — optional email notifications
- `EXPO_PUBLIC_DOMAIN` — auto-set by Expo workflow to `$REPLIT_DEV_DOMAIN`
- `PUBLIC_HOST` — fallback hostname for the Expo landing page when the request
  carries no valid Host header

## Authentication

Two transports over the same JWT:

- **Native** sends `Authorization: Bearer`, holding the token in the
  Keychain/Keystore.
- **Web** sends `X-Auth-Transport: cookie` at login and gets the token back as
  the httpOnly `holet_session` cookie instead — it is never in the response
  body, so no script on the origin can read or persist it. Because the browser
  attaches that cookie by itself, every non-GET request must also echo the
  readable `holet_csrf` cookie in an `X-CSRF-Token` header. That token is signed
  over the user id, so a value planted by anyone who can set cookies on the
  domain does not verify against the session presenting it.

Only the server can expire an httpOnly cookie, so web logout is a request
(`POST /api/auth/logout`) rather than something the client does locally.

## Key Business Rules

- Total Cost = Room Rent + Add-ons (auto-calculated on create/update)
- Balance = Total Cost - Receipt (auto-calculated)
- Delete booking: Admin + Owner only (Manager cannot delete)
- Email notifications: sent on booking create/update if SMTP configured; owner gets before/after comparison email on updates

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — `pnpm run typecheck` (runs `tsc --build --emitDeclarationOnly`)
- **`emitDeclarationOnly`** — only emit `.d.ts` during typecheck; bundling handled by tsx/vite

## Root Scripts

- `pnpm run build` — runs `typecheck` then builds all packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`
- `pnpm --filter @workspace/scripts run seed` — seed demo data
- `pnpm --filter @workspace/db run push` — push schema to DB

## Color Palette

- Primary: `#1E3A5F` (navy)
- Accent: `#3B82F6` (blue)
- Gold: `#D4A017`
