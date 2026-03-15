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
- `users`: id, email, name, passwordHash, role (enum: admin/owner/manager), hotelId FK, createdAt
- `agencies`: id, name, contactEmail, contactPhone, hotelId FK, createdAt
- `bookings`: id, guestName, guestEmail, guestPhone, roomNumber, roomType, checkIn, checkOut, roomRent, addOns, totalCost (auto-calc), receipt, balance (auto-calc), status (enum: confirmed/checked_in/checked_out/cancelled), notes, hotelId FK, agencyId FK, createdAt

## Demo Credentials (seeded)

```
admin@hotel.com / admin123    (role: admin)
owner@hotel.com / owner123    (role: owner, hotel: Grand Palace Hotel)
manager@hotel.com / manager123 (role: manager, hotel: Grand Palace Hotel)
```

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection (auto-provided by Replit)
- `JWT_SECRET` — JWT signing secret (auto-provided or set manually)
- `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT` — optional email notifications
- `EXPO_PUBLIC_DOMAIN` — auto-set by Expo workflow to `$REPLIT_DEV_DOMAIN`

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
