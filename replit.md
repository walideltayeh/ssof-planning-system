# SSOF Planning System

## Overview

Sales, Stock, Orders & Forecast planning system for Al Fakher (global shisha brand). Four markets: **Lebanon** (domestic template) and **Syria / Libya / KSA** (intl template — `IntlPlanningFgPage` / `IntlAnalysisPage` / `IntlImsPage` / expiry / clearance flow).

Live at `ssofplan.live`. Default owner: `walid` / `walid`.

## Architecture

TypeScript monorepo (pnpm). React 19 + Vite + Tailwind 4 + Radix/shadcn + tRPC + TanStack Query + wouter + recharts on the client. Express + tRPC + Drizzle ORM + PostgreSQL on the server. Dev and prod run as a **single process on port 5000** (Express serves Vite middleware in dev). tRPC mounted at `/api/trpc`.

```
client/                 # React frontend
server/                 # Express + tRPC backend
  _core/                # auth, vite integration, OAuth
  db.ts                 # all DB access
  routers.ts            # tRPC router
drizzle/schema.ts       # PG schema (Drizzle)
drizzle/migrations/     # SQL migrations
shared/                 # shared TS types
```

## Key conventions

- **Auth**: custom `app_users` table (username/password). No external OAuth required. `getLoginUrl()` in `client/src/const.ts` falls back to `/` when Manus OAuth env vars are absent.
- **Per-country roles**: `app_users.countryRoles` JSON overrides the global role per country; owners are always admin. Server gates with `requireCountryAdmin` / `requireSkuCountryAdmin`. Client exposes `isAdminFor(country)`; `isAdmin` resolves against the currently selected country.
- **Excel I/O**: Export at `/api/export-sheet?sheet=forecast|ims|shipment|arrival|planning-fg-<weight>`, plus `/api/export-excel`, `/api/export-forecast-split`, `/api/export-ims-template`. Import at `POST /api/import-sheet?sheet=X&country=Y&username=Z` (ExcelJS, bulk upsert, formula-derived rows skipped). Per-page `ExportSheetButton` / `ImportSheetButton` components. Bulk loads use batched `INSERT ON CONFLICT` over unique indexes created in `ensureDataIndexes()` at startup.
- **Unit toggle**: `client/src/contexts/UnitContext.tsx` provides `formatVal(mcValue)` + `unitLabel` for MC / KG / Tons (1 MC = 6 KG). Persisted in `localStorage["ssof-unit"]`. All quantity-displaying pages must use `formatVal`; charts accept an optional `formatter` prop.
- **Custom weights**: SKU weights are free-form strings parsed by `weightToGrams`. `WeightInput` component (number + g/kg toggle) emits canonical `50g` / `1.5kg`. Server trims weight at the write boundary. Dashboard cards, badge colors, and Planning FG tabs are all derived dynamically from `db.getActiveWeightsForCountry(country)` → `trpc.country.weights`. Routes `/planning-fg/:weight` and `/intl-planning-fg/:weight` accept any weight.
- **Active/inactive SKUs**: `skus.isActive` (default true). Inactive SKUs are excluded from every analysis/planning calculation but their data is preserved. `getSkusForCountry()` filters by `isActive=true` unless `includeInactive=true`. Toggling a SKU invalidates forecast, planning, shipment, IMS, and arrival caches.
- **IMS source marker**: `ims_data.source` is `"manual"` by default, `"auto_forecast"` when written by `autoFillImsFromForecast`. UI surfaces violet-tinted future cells (IMS pages) and an "AUTO" badge in `ForecastIntelligenceTab` when any future IMS came from auto-fill (server flag `hasAutoFilledFutureIms`).

## Major features (1-line index)

- **Country Performance board pack** (`/analysis` and `/intl-analysis` → `CountryPerformancePage.tsx`; server `server/analysis/countryPerformance*.ts`, one cached `trpc.country.performance` call): Running Rate → Full-Year Outlook → Executive Summary → What Changed Since the Last Board → Flow → Demand (incl. volume bridge) → Supply → Inventory Health (lost sales, efficiency) → Forecast Quality → Portfolio Health → Market Context (hidden without competitor data) → Forward Look → Commercial Value → Multi-country Scorecard → Anomalies → Data Confidence. Sections live in `client/src/components/performance/` and are registered in `sections.ts`. Presentation Mode (one slide per section, arrow keys), Export PDF (print view), Export Excel (`/api/export-performance`, one sheet per section). Admins can **Freeze Board Pack** (`board_pack_snapshots`), write **Presenter notes** per section/country/period (`presenter_notes`, keyed by `meta.periodKey`), and pick a saved Version as the **Budget baseline** (`board_plan_baselines`). Per-user slide order/hiding is stored in `user_preferences` (`performance.slideLayout`). Old tabs remain under "Deep Dive". Never change planning data or formulas from this page.
- **Last data update by country**: `trpc.country.lastUpdates` (newest data-changing audit entry per accessible country, `db.getLatestDataUpdates`) feeds the strip at the top of Country Performance, the header line, the cover slide, and the Excel cover. Classification/labels live in `shared/audit/lastUpdate.ts`. Server mutations must pass `country: auditCountry(...)` to `db.logAudit` — the column defaults to Lebanon, so omitting it mis-attributes the change.
- **Analysis pages (Deep Dive)** (Lebanon + Intl): Running Rate (`trpc.country.runningRate`), Stock Levels (`trpc.country.stockLevels`), Forecast Intelligence (`trpc.country.forecastIntelligence`).
- **Forecast Split** (`/forecast-split`, file `ForecastSplitPage.tsx`): AI / algorithmic-fallback recommender via `trpc.forecastSplit.recommend`. Multi-month `totalSplit` mode redistributes tonnage by per-country seasonality (Ramadan +35–40%, summer Jun–Aug +17–22%, winter Dec–Feb −7–12%) via `distributeTonsBySeasonality` in `forecastSplit.helpers.ts`. Excel export rounds to match displayed totals; SKU Comparison tab matches on all four identity fields (name|weight|category|packaging).
- **Supply-chain price list**: 4 nullable numeric columns on `skus` (`priceToWs`, `priceWsToSemiWs`, `priceSemiWsToRetail` — all $/MC — and `finalRspPerPack` $/pack). Edited in `SkuPriceListCard` on the SKU Management page (both templates). Trade Offers invoices each Apply Offer channel at its tier (WS→toWs, Semi-WS→wsToSemiWs, Retail+HoReCa→semiWsToRetail), falls back to the $127 list knob when unset; margin strip and price ladder shown only when tier prices exist. Shared helpers in `client/src/lib/packUnits.ts`.
- **Trade Offers** (`/trade-offers`, file `TradeOffersPage.tsx`): client-side proposal generator on top of `forecastIntelligence`. Renders up to 5 named offer decks (Ride-Along / Variety Builder / Subscription Lock / Café Starter / Territory Exclusive). Scarcity-weighted anchor selection, dollar-overhang slow-flavor ranking, cross-flavor pairing rule, anchor lock (per-country defaults in `DEFAULT_ANCHOR_LOCK`; Syria defaults to Double Apple + New), multi-flavor clearance baskets via `clearanceBasket`, channel filter via `CHANNEL_DECK_PRIORITY`. All quantities in mastercases (MC); copy uses plain-English glossary terms only. WS list price $127/MC is the single $-reference (no COGS).
- **Competitor Analysis** (`/competitor-analysis`, file `CompetitorAnalysisPage.tsx`): Lebanon market — Regie data 2017–2026. Tabs: Market Share, Monthly Trends, Flavor Breakdown, Two Apple Deep Dive, Emerging Brands. Real KG totals stored in `BRAND_MONTHLY_KG` / `FLAVOR_DATA_KG` / `OTHER_BRANDS_FLAVOR_KG` for 2025–2026; older years stay in MC (no ratio conversion — SKU weights vary). `competitor_data` table has `brand_monthly_kg` and `flavor_yearly_kg` JSON columns; import supports "Brand Monthly Sales KG" and "Brand Flavor Annual KG" sheets.
- **Landing / country selector**: `LandingPage.tsx` shows only login (no country info exposed). After login, single-country users go straight to their dashboard; multi-country users see `CountrySelectorPage.tsx`. `DashboardLayout` has a "Back to country selector" link.
- **Arrival page (Syria/Libya)**: each production batch has an editable "Invoice / Container Note" (`shipment_data.note`, migration `0001_left_mariko_yashida.sql`). Notes preserved in version snapshots. Libya production offset editor defaults to 30 days when unset.
- **Version Manager**: explicit Country selector in `DataAndVersionsPage` header; `editCount` and snapshots scoped to that country.

## Development

```bash
pnpm dev          # dev server on port 5000
pnpm build        # production build
pnpm run check    # TypeScript (must stay green)
pnpm lint         # ESLint (warnings allowed, errors block)
pnpm test         # Vitest (server in node env, client in jsdom)
pnpm db:push      # Drizzle migrations
```

Three validation guards run on every task and must stay green:

- **typecheck** — `pnpm run check`. Fix new errors in the same change that introduced them.
- **test** — `pnpm test`. `vitest.config.ts` routes `server/**` to node and `client/**` to jsdom + `@vitejs/plugin-react`. `vitest.setup.ts` registers `@testing-library/jest-dom`. Heavy page logic is extracted to sibling `*.helpers.ts` for unit testing without booting tRPC/React Query.
- **lint** — `pnpm lint` (flat config at `eslint.config.js`). `@typescript-eslint/no-unused-vars` = warn (large pre-existing baseline). `react-hooks/rules-of-hooks` = error (two targeted disables in `AuditTrailPage.tsx` / `UploadPage.tsx` — restructure instead of adding more). `@typescript-eslint/no-explicit-any` = off (Excel parsing / router glue use `any` extensively).

## Environment

- `DATABASE_URL` — PostgreSQL (Replit managed). Schema converted from MySQL → PostgreSQL during import (`drizzle-orm/pg-core` + `pg`).
- `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`, `OWNER_OPEN_ID` — all optional (Manus OAuth, not required for normal operation).

## Deployment

- Custom domain `ssofplan.live`, autoscale target.
- Build: `pnpm run build` → run `node dist/index.js`.
- **Dev and prod databases are separate.** Sync data via direct DB tooling — the old `/api/export-db` + `/api/import-db` endpoints were removed.

## User preferences

- Communicate in plain, non-technical language unless the user asks for code/details.
- Don't pile on emojis.
- All quantities and offer math denominated in **mastercases (MC)** — never "cases" or "units".
- Expected Arrivals on the Arrival dashboard uses **planned-only** (not actual ?? planned) per explicit user direction — don't "fix" this back to a fallback.
