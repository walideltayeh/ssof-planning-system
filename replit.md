# SSOF Planning System

## Overview

Sales, Stock, Orders & Forecast planning system for Al Fakher — a global shisha tobacco brand. Supports three markets: Lebanon, Syria, and Libya.

## Architecture

Full-stack TypeScript monorepo:

- **Frontend**: React 19 + Vite, Tailwind CSS 4, Radix UI (shadcn/ui pattern), tRPC client, TanStack Query, wouter routing, recharts
- **Backend**: Express + tRPC server, Drizzle ORM with PostgreSQL
- **Package manager**: pnpm

## Project Structure

```
client/          # React frontend (root: client/, port 5000)
server/          # Express + tRPC backend (served by same process)
  _core/         # Core infrastructure (auth, vite integration, OAuth)
  db.ts          # All database access functions
  routers.ts     # tRPC router
drizzle/
  schema.ts      # PostgreSQL schema (Drizzle ORM)
  migrations/    # SQL migration files
shared/          # Shared TypeScript types
```

## Key Implementation Notes

- Server and frontend run in the **same process** in development (Express serves Vite middleware)
- Port: **5000** (single process for both API and frontend)
- Database: **PostgreSQL** via Replit's built-in DB (`DATABASE_URL` environment variable)
- Authentication: Custom app-users table (`app_users`) with username/password — no external OAuth required
- `getLoginUrl()` in `client/src/const.ts` safely falls back to `/` when Manus OAuth env vars are absent
- tRPC API is served at `/api/trpc`
- Excel export endpoints at `/api/export-excel`, `/api/export-forecast-split`, etc.
- Temporary data migration endpoints: `GET /api/export-db` and `POST /api/import-db`

## Data

All three countries have been migrated from the original Manus/ssofplan.live production database:

| Country | SKUs | Periods |
|---------|------|---------|
| Lebanon | 29   | 36      |
| Syria   | 21   | 36      |
| Libya   | 13   | 36      |

Default admin user: `walid` / `walid` (owner account)

## Development

```bash
pnpm dev          # Start development server on port 5000
pnpm build        # Build for production
pnpm db:push      # Generate + run DB migrations
```

## Database Migration

Schema was converted from MySQL to PostgreSQL during Replit import. Uses Drizzle ORM with `drizzle-orm/pg-core` and `pg` driver. Migration generated at `drizzle/migrations/0000_illegal_black_knight.sql`.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (Replit managed)
- `JWT_SECRET` — Optional, for OAuth cookie signing
- `OAUTH_SERVER_URL` — Optional, for Manus OAuth integration (not required)
- `VITE_OAUTH_PORTAL_URL` — Optional, Manus OAuth (not required; falls back to `/` if missing)
- `OWNER_OPEN_ID` — Optional, for OAuth owner detection

## Recent Features (March 2026)

### 1. Invoice / Container Note on Arrival batches (Syria & Libya)
- New `note` text column added to `shipment_data` table (migration `0001_left_mariko_yashida.sql`)
- Each production batch in the Arrival page (Syria/Libya) has an editable "Invoice / Container Note" field in the expanded panel
- Notes are preserved in version snapshots (save/load versions carries note through)
- Saved via `trpc.country.updateProduction` mutation which now accepts optional `note` field

### 2. Libya Production Arrival Offset default of 30 days
- When opening the offset editor for a Libya production entry with no offset set, the input pre-fills with 30 days instead of empty
- File: `client/src/pages/ShipmentPage.tsx`

### 3. Version Manager country isolation fix
- Data & Versions page now has an explicit **Country** selector in the Version Manager header
- The selector determines which country's versions are viewed and which country's data is snapshotted when saving
- `editCount` query now also filters by the selected country
- Dialog title shows "Save SSOF Version — [Country]" to make the scope clear
- `versionCountry` state defaults to the logged-in user's country

## Deployment

- Custom domain: `ssofplan.live`
- Target: autoscale
- Build: `pnpm run build`
- Run: `node dist/index.js`
- Note: Dev and production databases are **separate** — use `/api/export-db` + `/api/import-db` to sync data between them
