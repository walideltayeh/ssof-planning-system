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
- Authentication: Custom app-users table (`app_users`) with username/password — no external OAuth required for core functionality
- tRPC API is served at `/api/trpc`
- Excel export endpoints at `/api/export-excel`, `/api/export-forecast-split`, etc.

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
- `OAUTH_SERVER_URL` — Optional, for Manus OAuth integration
- `OWNER_OPEN_ID` — Optional, for OAuth owner detection

## Deployment

- Target: autoscale
- Build: `pnpm run build`
- Run: `node dist/index.js`
