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
- Excel export endpoints at `/api/export-excel`, `/api/export-sheet?sheet=forecast|ims|shipment|arrival|planning-fg-50g|planning-fg-250g|planning-fg-1kg`, `/api/export-forecast-split`, `/api/export-ims-template`, etc.
- Per-page export buttons: ExportSheetButton component (`client/src/components/ExportSheetButton.tsx`) used on Forecast, IMS, Shipment, Arrival, and Planning FG pages
- Per-page import buttons: ImportSheetButton component (`client/src/components/ImportSheetButton.tsx`) next to every export button — uploads `.xlsx` files to `POST /api/import-sheet?sheet=X&country=Y&username=Z`, parses with ExcelJS, bulk-upserts matching SKU+period values. Import logic in `server/excelImport.ts` handles worksheet selection by name for multi-sheet exports. Only editable cells are imported (formula-derived rows like Closing Stock, Weeks, Variance are skipped).
- IMS template download: `/api/export-ims-template?country=Lebanon` — generates Excel with SKU names, month columns, and current values
- Temporary data migration endpoints: `GET /api/export-db` and `POST /api/import-db`
- Bulk upload uses batched SQL INSERT ON CONFLICT for speed (unique indexes on skuId+periodId per data table)
- Unique indexes created at startup via `ensureDataIndexes()` in db.ts

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

### 4. Monthly Running Rate (MRR) Analysis — All Countries
- New "Running Rate" tab in Analysis pages (Lebanon, Syria, Libya)
- Per-SKU monthly IMS running rates with 3M/6M/All-Time averages
- Trend analysis (3M vs prior 3M) with directional indicators
- Drill-down views: By SKU, By Flavor, By Weight
- Sparkline monthly trend charts per SKU
- KPI cards: Total IMS, 3M Running Rate, Overall Trend, Active SKUs
- API: `trpc.country.runningRate` endpoint
- Files: `server/db.ts` (getRunningRateAnalysis), `client/src/pages/AnalysisPage.tsx`, `client/src/pages/IntlAnalysisPage.tsx`

### 5. Stock Level Analysis — All Countries
- New "Stock Levels" tab in Analysis pages (Lebanon, Syria, Libya)
- Per-SKU closing stock, weeks of stock, coverage months, health score
- Zone distribution donut chart (Healthy/Critical/Overstock/Out of Stock/Negative)
- Zone trend over time stacked bar chart
- Stock by weight summary cards
- Sortable SKU table with zone badges and stock trend sparklines
- API: `trpc.country.stockLevels` endpoint
- Files: `server/db.ts` (getStockLevelAnalysis), `client/src/pages/AnalysisPage.tsx`, `client/src/pages/IntlAnalysisPage.tsx`

### 6. Secure Landing Page — Login-First Flow
- Landing page now shows only a login form (username + password) — no country information is visible to unauthenticated users
- After login: single-country users go directly to their dashboard; multi-country users see a country selector showing only their assigned countries
- Owner accounts (e.g. `walid`) see all three countries in the selector
- Country selector page has a "Sign out" link
- DashboardLayout's "Back to country selector" clears the country and returns to the picker
- Server `verifyLogin` now accepts optional `country` parameter; without it, only validates credentials
- Files: `LandingPage.tsx`, `CountrySelectorPage.tsx`, `AuthContext.tsx`, `CountryContext.tsx`, `App.tsx`

### 7. AI Forecast Recommendation — Algorithmic Fallback
- Forecast split recommendation now falls back to a 5-factor algorithmic model when LLM API key is unavailable
- Uses pre-computed: historical trend (35%), seasonality (25%), stock health (20%), market intelligence (10%), confidence (10%)
- Non-negative safe reconciliation loop to ensure exact mastercase totals
- Share percentages recomputed after reconciliation
- File: `server/routers.ts` (forecastSplit.recommend mutation)

### 8. Unit Toggle (MC / KG / Tons)
- Global unit toggle in sidebar footer: MC (default), KG, Tons (1 MC = 6 KG = 0.006 Tons)
- Context: `client/src/contexts/UnitContext.tsx` — provides `formatVal(mcValue)` and `unitLabel`
- Preference persisted in `localStorage` key `ssof-unit`
- All quantity-displaying pages use `formatVal` for unit conversion; non-quantity values (weeks, SKU counts, zone counts, dates) are not converted
- Pages updated: ForecastPage, ShipmentPage, ArrivalPage, ImsVsForecastPage, PlanningFgPage, IntlPlanningFgPage, ForecastVsForecastPage, IntlImsPage, AnalysisPage, IntlAnalysisPage, ExpiryDashboardPage
- Chart helper components (HorizontalBarChart, DonutChart, StackedBarChart, BatchLifecycleBar) accept optional `formatter` prop for unit-aware rendering
- Toggle UI: 3-button group in `DashboardLayout.tsx` sidebar footer

### 9. Competitor Analysis Page — Lebanon Market
- New "Competitor Analysis" page accessible from all country sidebars at `/competitor-analysis`
- Source data: Regie (Lebanese government tobacco authority) official sales data 2017–2026
- **Market Share tab**: Stacked bar chart of brand shares (Al Fakher, Mazaya, Nakhla, Others) by year + volume comparison with YoY growth badges
- **Monthly Trends tab**: Monthly breakdown table with mini bar charts; shows Al Fakher share per month
- **Flavor Breakdown tab**: Per-brand flavor portfolio comparison + head-to-head flavor table showing which brand leads each flavor
- **Two Apple Deep Dive tab**: Side-by-side comparison of all brands competing in Two Apple (Lebanon's #1 flavor) with sparkline trends
- **Emerging Brands tab**: Minor/new entrants analysis (Al Ostoura, Khalil Maamoun, Al Basha, Gold Dahab, Mawal) with strategic insight cards
- Top Brands head-to-head table with 3-year comparison (replaces KPI cards)
- Year selector with comparison year; 2026 shows YTD warning
- **Unit conversion uses actual KG data**: For years with real KG data (2025, 2026), actual KG totals from the Regie Excel are used (stored in `BRAND_MONTHLY_KG`, `FLAVOR_DATA_KG`, `OTHER_BRANDS_FLAVOR_KG` constants). For older years (2017-2024) without KG data, values stay in MC when KG/Tons mode is selected. No ratio-based conversion is used because SKU weights vary (e.g., Nakhla 50g = 12.5 KG/MC vs 250g = 10 KG/MC). Data resolution happens at the page level via `activeBrandMonthly`, `activeFlavorData`, `activeOtherBrandsFlavorData` memos.
- DB table `competitor_data` has `brand_monthly_kg` and `flavor_yearly_kg` JSON columns for uploaded KG data. Import supports "Brand Monthly Sales KG" and "Brand Flavor Annual KG" sheets.
- File: `client/src/pages/CompetitorAnalysisPage.tsx` (static data from parsed Excel + uploaded competitor_data table)

### 10. Forecast Intelligence Tab — All Countries
- New "Forecast Intelligence" tab on Analysis pages (Lebanon, Syria, Libya)
- Computes per-SKU recommended forecast for next month based on 4 factors:
  - **Running Rate (base)**: 3-month IMS average as baseline demand signal
  - **Seasonality Index**: Historical same-month performance vs overall average
  - **Stock Health**: +15% boost for critical stock, -10% reduction for overstock
  - **Trend Momentum**: ±15% adjustment based on 3M vs prior 3M growth rate
- Three sub-views: Summary (KPIs, weight/flavor breakdowns, attention alerts), SKU Detail Table (sortable/filterable), Gap Analysis (under/over-forecasted visualization)
- Gap = Recommended vs Current Forecast — highlights where planned forecast diverges from demand signals
- Ramadan uplift (+35%) applied when target month falls in Ramadan period
- API: `trpc.country.forecastIntelligence` endpoint
- Files: `server/db.ts` (getForecastIntelligence), `client/src/components/ForecastIntelligenceTab.tsx`, both Analysis pages

### 11. SKU Active/Inactive Toggle — Lebanon
- Toggle switch on each SKU row in Lebanon SKU Management page
- Inactive SKUs are excluded from all calculations (forecast, stock, analysis, planning) but data is preserved
- Toggle ON to re-include the SKU in all calculations
- Visual indicators: inactive SKUs shown at 50% opacity with strikethrough name
- Stats dashboard shows Active/Inactive counts
- `isActive` column on `skus` table (boolean, default true)
- `getSkusForCountry()` filters by `isActive=true` by default; SKU management passes `includeInactive=true`
- All 8 Lebanon analysis functions (`getAnalysisOverview`, `getAnalysisBySku`, `getAnalysisByWeight`, `getAnalysisByCategory`, `getAnalysisByFlavor`, `getAnalysisProduction`, `getAnalysisStockHealth`, `getStockSnapshot`) filter by active SKUs only
- Cache invalidation: toggling a SKU invalidates forecast, planning, shipment, IMS, and arrival query caches

## Deployment

- Custom domain: `ssofplan.live`
- Target: autoscale
- Build: `pnpm run build`
- Run: `node dist/index.js`
- Note: Dev and production databases are **separate** — use `/api/export-db` + `/api/import-db` to sync data between them
