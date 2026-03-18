# SSOF Planning System - TODO

- [x] Database schema: SKUs table with weight routing
- [x] Database schema: Monthly data tables (forecast, ims, shipment, arrival)
- [x] Database schema: Planning FG data (opening stock, adjustments, etc.)
- [x] Database schema: Upload history tracking
- [x] Server API: Excel file upload and parsing (Forecast, IMS, Stock)
- [x] Server API: SKU CRUD operations with cascade across all sheets
- [x] Server API: Calculation engine (closing stock, weeks of stock)
- [x] Server API: Dynamic SUM with SKU exclusion support
- [x] Server API: Data retrieval for all sheet views
- [x] Frontend: Dashboard layout with sidebar navigation
- [x] Frontend: Forecast sheet view with editable data grid
- [x] Frontend: IMS vs FRCST sheet view
- [x] Frontend: Shipment (Production) sheet view with weekly breakdown
- [x] Frontend: Arrival to Regie sheet view with weekly breakdown
- [x] Frontend: Planning FG 50g view with all calculations
- [x] Frontend: Planning FG 250g view with all calculations
- [x] Frontend: Planning FG 1kg view with all calculations
- [x] Frontend: Data upload interface (Forecast, IMS Actuals, Opening Stock)
- [x] Frontend: Create New SKU dialog with weight routing
- [x] Frontend: Delete SKU with cascade confirmation
- [x] Frontend: SUM options (all SKUs vs exclude selected) with dialog
- [x] Frontend: Cross-sheet data linking visualization
- [x] Frontend: Total rows (with/without Classic & Italian)
- [x] Testing: API endpoint tests (25 tests passing)
- [x] Testing: Calculation engine verification

- [x] Fix: Upload parsing for Shipment (Production) sheet
- [x] Fix: Upload parsing for Arrival to Regie sheet
- [x] Fix: Verify and correct all Excel formula replication
- [x] Feature: Apply vibrant professional theme (teal/emerald palette)
- [x] Feature: Inline cell editing on all sheet views
- [x] Feature: SUM exclusion dialog (multi-select SKUs to exclude from totals)
- [x] Fix: Planning FG sheet upload parsing (50g, 250g, 1kg)
- [x] Fix: Weight normalization (handle "100" -> infer from SKU name)
- [x] Testing: Planning FG formula calculations (11 tests)
- [x] Testing: Weight normalization tests
- [x] Feature: Inline editing on Shipment and Arrival pages
- [x] Feature: Inline editing on IMS vs Forecast page
- [x] Fix: React 'unique key' warnings on all pages using bare fragments in .map()
- [x] Fix: SKU 'Al Fakher Lemon Mint 250g' weight showing as '100' instead of '250g' (verified: already corrected in DB and upload parser)
- [x] Fix: Shipment (Production) sheet not being parsed from Excel upload (destructured val to only pass week1-week4)
- [x] Fix: Arrival to Regie (Invoiced) sheet not being parsed from Excel upload (destructured val to only pass week1-week4)
- [x] Feature: Add Year functionality - add a new year (e.g., 2028) with all 12 monthly periods extending all data grids
- [x] Feature: Export to Excel button - download current planning data as Excel workbook with all sheets
- [x] Fix: Shipment and Arrival data still not showing values after upload (migrated data from Excel directly)
- [x] UX: Add Year button visible on Dashboard top-right alongside Export to Excel
- [x] Feature: Add Core/NPI category field to SKU schema
- [x] Feature: SKU Management page - Core/NPI toggle checkbox for each SKU
- [x] Feature: Forecast page - group by Core/NPI, then sort by weight (1kg, 250g, 50g)
- [x] Feature: Forecast SUM exclusion - include/exclude individual SKUs or entire Core/NPI groups
- [x] UX: Make Add Year button more prominent - dedicated page at /add-year with sidebar nav entry
- [x] Audit: Verify all Planning FG formulas match the original Excel file exactly (fixed Weeks formula: AVG(next2 IMS)*4.3)
- [x] Fix: Planning FG data now uses own Invoiced/Arrivals columns (not from Shipment/Arrival sheets)
- [x] Fix: Planning FG upload parser column offset fixed (dateStartSearch=2 for all sheets)
- [x] Fix: Planning FG data re-imported with correct invoiced and arrivals values
- [x] Feature: Apply Core/NPI grouping to IMS vs Forecast page
- [x] Feature: Apply Core/NPI grouping to Shipment (Production) page
- [x] Feature: Apply Core/NPI grouping to Arrival to Regie page
- [x] Feature: Include Core/NPI category column in Excel export for all sheets
- [x] Fix: Remove Opening Stock total column in Planning FG pages (not summable)
- [x] Feature: Apply conditional formatting to Closing Stock - Weeks based on Excel rules (=0 gray, <0 black, <4 red, 4-6 amber, >6 red)
- [x] Investigate and implement formula relationship between Arrival to Regie and Shipment (Production) sheets from Excel
- [x] Implement Arrival to Regie formula linkage to Shipment (Production) matching Excel exactly
- [x] Backend: compute Arrival W1/W2/W3/W4/Total from Shipment data for formula months (12+)
- [x] Frontend: show computed values for formula cells, mark them read-only, keep raw data editable for early months
- [x] Update Excel export to use formula-derived Arrival values
- [x] Write tests for Arrival-to-Shipment formula calculations (12 tests passing)
- [x] Enhanced Excel Export: Server-side export with ExcelJS for proper formula support
- [x] Enhanced Excel Export: Live formulas in Arrival to Regie sheet (cross-sheet refs to Shipment)
- [x] Enhanced Excel Export: Live formulas in Planning FG sheets (Closing Stock, Weeks of Stock)
- [x] Enhanced Excel Export: Conditional formatting on Closing Stock Weeks (gray/black/red/amber/red)
- [x] Enhanced Excel Export: Dashboard sheet with KPIs and monthly summary table
- [x] Enhanced Excel Export: Navigation panel sheet with hyperlinks to all sheets
- [x] Enhanced Excel Export: Professional styling (headers, borders, colors, column widths, freeze panes)
- [x] Enhanced Excel Export: Integrated server endpoint into frontend download button
- [x] Enhanced Excel Export: 13 vitest tests passing (65 total)
- [x] Excel Export Fix: IMS vs FRCST Forecast row uses cross-sheet formula to Forecast sheet
- [x] Excel Export Fix: IMS vs FRCST Variance is formula referencing IMS and Forecast rows
- [x] Excel Export Fix: Planning FG IMS row references IMS vs FRCST sheet
- [x] Excel Export Fix: Planning FG Arrivals row references Arrival to Regie sheet totals
- [x] Excel Export Fix: Planning FG Invoiced row references Shipment sheet totals
- [x] Excel Export Fix: All derived values are now formulas, not static values
- [x] Excel Export Feature: SUM inclusive/exclusive (Grand Total respects isExcludedFromTotal)
- [x] Excel Export: 71 vitest tests passing across 5 test files
- [x] Feature: Custom login page with username/password authentication (Username: Walid, Password: Walid)
- [x] Feature: Auth guard - redirect to login if not authenticated (sessionStorage-based)
- [x] Feature: Session persistence (stays logged in across page refreshes within session)
- [x] Feature: Logout functionality (clears session and shows login page)
- [x] Feature: "Remember me" checkbox on login page (localStorage for persistent login)
- [x] Feature: Multi-user accounts with role-based access (admin vs viewer)
- [x] Feature: Admin can edit all data; Viewer has read-only access (sidebar hides admin-only pages for viewers)
- [x] Feature: User management page for admin to view all users and roles
- [x] Feature: Case-insensitive usernames for login
- [x] Feature: Add users Taha/taha, David/david, Aileen/aileen (all admin)
- [x] Feature: User Management page (admin only)
- [x] Feature: Add Al Fakher logo to login page and sidebar header for branding
- [x] Feature: Audit Trail - database table to log all data changes (user, action, sheet, SKU, old/new value, timestamp)
- [x] Feature: Audit Trail - backend logging on all data mutations (all edit/upload/SKU/year operations)
- [x] Feature: Audit Trail page - visible only to Walid (owner), with filters and search
- [x] Feature: Restrict Upload Data to Admin only (frontend page-level guard)
- [x] Feature: All frontend mutations pass username for audit logging
- [x] Fix: After custom login (username/password), DashboardLayout now bypasses Manus OAuth check when custom auth is active
- [x] Audit Trail: Log login events (username, timestamp, success/failure)
- [x] Audit Trail: Log logout events
- [x] Audit Trail: Log page navigation (which page user visited)
- [x] Audit Trail: Log Excel export actions
- [x] Audit Trail: Log cell edits with old value → new value
- [x] Audit Trail: Log SKU exclusion toggle changes
- [x] Audit Trail: Enhanced audit trail page with all action type filters (12 action types, summary cards, pagination)
- [x] Feature: Smart Recommendation engine for Planning FG - analyze stock zones per SKU per month
- [x] Feature: Generate 2-3 recommendations per SKU when in red/black/grey zone (increase arrivals, add adjustment, reduce forecast)
- [x] Feature: Visual recommendation cards with color-coded zones, impact bars, and before/after preview
- [x] Feature: Apply button on each recommendation to auto-adjust relevant data (with audit logging)
- [x] Feature: Integrate recommendations into all 3 Planning FG pages (50g, 250g, 1kg) via shared component
- [x] Fix: Smart Recommendations only recommend Forecast changes — Production and Arrivals cascade automatically
- [x] Fix: Removed all Adjustment and direct Arrival/Shipment recommendations
- [x] Fix: Visual cascade chain shows Forecast change → Production impact → Arrival impact (2-week lead)
- [x] Fix: Smart Recommendations start at current month +1 (not current month)
- [x] Fix: Production impact reflects current month +4
- [x] Feature: Rollback button to undo applied recommendations (with audit logging)
- [x] Fix: Moved recommendations inline next to SKU Core/NPI label (compact dropdown)
- [x] Fix: Apply recommendation now uses syncImsAndForecast — reflects in Planning FG, Forecast, and IMS vs FRCST
- [x] Feature: Make IMS row editable in Planning FG (with "editable → syncs to Forecast" hint)
- [x] Feature: Editing IMS in Planning FG syncs back to Forecast and IMS vs FRCST sheets via syncImsAndForecast mutation
- [x] Fix: Apply recommendation button does nothing in Planning FG
- [x] Fix: Manual IMS edit in Planning FG does nothing / no sync
- [x] Fix: Apply recommendation does not actually update Forecast values in grid/database (confirmed by user)
- [x] Feature: "Apply All" button in SmartRecommendations dropdown to apply all pending recommendations at once
- [x] Fix: Weeks of Stock formula does not match Excel — does not update when recommendations are applied
- [x] Fix: Correct editable rows in Planning FG — Adjustments (all), IMS (future months only), Production/Arrivals (+4 months from current only)
- [x] Fix: Closing Stock and Closing Stock - Weeks must be fully automatic (non-editable)
- [x] Feature: Add healthy stock level banner/header to Planning FG tables matching Excel conditional formatting thresholds
- [x] Fix: Apply exact Excel conditional formatting colors to all rows in Planning FG (Closing Stock - Weeks color zones)
- [x] Fix: Ensure all tabs are dynamically linked (Forecast ↔ IMS vs FRCST ↔ Planning FG)
- [x] Feature: Make Forecast row directly editable in Planning FG grid (manual override without leaving page)
- [x] Fix: Forecast row in Planning FG editable only from current month onwards (not all future, not past)
- [x] Fix: Editing Forecast in Planning FG should immediately update the IMS row (for future months)
- [x] Fix: Applying a recommendation should immediately reflect in the Planning FG table (no manual refresh needed)
- [x] Fix: Each SKU table in Planning FG must show its own per-SKU conditional formatting thresholds for Closing Stock - Weeks
- [x] Feature: Lock icon on past-month Forecast cells to indicate read-only
- [x] Feature: Highlight changed cells in Planning FG table when a recommendation is applied (flash/pulse animation)
- [x] Feature: Week-level Invoiced (SHP) editing in Planning FG — click cell opens week picker (W1–W4), value auto-creates Actual Arrival entry 2 weeks later
- [x] Bug: Smart Recommendations show one value but apply/display a different value — full audit and fix of recommendation calculation, apply mutation, and grid display sync
- [x] Feature: Simulation mode in Smart Recommendations — Preview button shows full Planning FG table impact (Forecast, Closing Stock, Weeks rows updated inline) before applying
- [x] Bug: Excel upload parser column offsets wrong for all Planning FG sheets — fixed auto-detection for 50g (col offset 1) vs 250g/1kg (col offset 0)
- [x] Bug: IMS row from Planning FG sheet was being skipped (marked as computed) — now correctly uploaded to ims_data table
- [x] Data: Re-imported all 21 SKUs (756 records) from AFLebanonSSOF.xlsx with correct Opening Stock, IMS, Invoiced, Arrivals values
- [x] Data: Re-imported all 4 sheets (Forecast, IMS, Shipment, Arrival) from AFLebanonSSOF.xlsx — 1044 records per sheet (29 SKUs × 36 periods), duplicates cleaned, all data verified against Excel
- [x] Bug: IMS row in Planning FG grid shows wrong values (e.g. Blueberry Mint 50g total shows 135 instead of 75) — fixed: IMS row now shows raw actual IMS values, forecast fallback only used for future month Closing Stock calculations
- [x] Feature: Two-way sync between Forecast and IMS — editing IMS should update Forecast, and editing Forecast should update IMS
- [x] Bug: Prevent negative values for Forecast and IMS fields
- [x] Feature: Recommendations should target lower bound of Healthy zone (4 weeks) for Closing Stock - Weeks
- [x] Feature: Redesign Smart Recommendations to recommend both Forecast (→IMS) and Invoiced (production) changes to bring Closing Stock - Weeks to lower bound of healthy zone (4 weeks)
- [x] Feature: Recommendations should follow the rule: forecast for current month+1, production for current month+4, arrivals 2 weeks after production
- [x] Feature: Simulation preview should show impact of both Forecast and Invoiced changes together
- [x] Feature: Undo button on Planning FG pages to revert last cell edit (Forecast, IMS, Invoiced, Adjustments)
- [x] Bug: Undo button not working on Planning FG pages (verified working — was already functional)
- [x] Bug: Freeze (sticky columns/rows) not working on Forecast and IMS vs Forecast pages — added sticky top-0 thead, sticky left columns for Weight, SKU Name, and Type
- [x] Feature: Ctrl+Z keyboard shortcut for undo on Planning FG pages
- [x] Feature: Freeze panes (sticky header/columns) on Planning FG 50g/250g/1kg pages
- [x] Feature: Data validation summary after Excel upload — show comparison of uploaded vs stored values for first 3 SKUs
- [x] UX: Move undo button from page header to each individual SKU table in Planning FG
- [x] UX: Show clear preview of what will be undone (field, period, old→new value) before undoing
- [x] Feature: Redo button next to undo button in each Planning FG SKU card header
- [x] Feature: Ctrl+Shift+Z keyboard shortcut for redo (global — redoes most recent undone edit across all SKUs)
- [x] Feature: Redo stack per SKU — redo stack clears when a new edit is made (standard undo/redo behavior)
- [x] Feature: Redo button shows preview of what will be redone (field, period, old→new value)
- [x] Feature: "Apply Best Strategy" button per SKU — automatically picks optimal Forecast + Production mix to bring Closing Stock - Weeks closest to 4.0w target
- [x] Feature: Best Strategy simulation preview — show before/after impact across all future periods before committing
- [x] Feature: Best Strategy applies all optimal recommendations in one click with audit logging
- [x] Testing: Best Strategy computation tests (13 tests — zone classification, simulation patches, arrival splits, combined patches)
- [x] Fix: Remove opacity from frozen panes in Planning FG pages — match Forecast page style
- [x] Fix: Remove transparency from frozen panes on ALL pages (IMS vs Forecast, Forecast, Arrival, Shipment, Planning FG) — solid opaque backgrounds
- [x] Feature: Zebra striping per SKU group across all data tables (IMS vs Forecast, Forecast, Arrival, Shipment, Planning FG) for better visual separation when scrolling
- [x] Feature: Collapse/expand toggle per category group (Core, NPI) on all data table pages (IMS vs Forecast, Forecast, Arrival, Shipment, Planning FG)
- [x] Feature: Save SSOF version — save current state as a named version (e.g., "SSOFv1") with snapshot of all data
- [x] Feature: Auto-generate Word document summarizing all changes made in a saved version
- [x] Feature: Load saved SSOF version from web — list of previously saved versions with restore capability
- [x] Feature: Import SSOF version from local device — upload a version file to restore
- [x] Feature: Export SSOF version to local device — download version file for backup/sharing
- [x] Testing: Version system tests (15 tests — snapshot structure, changes summary, chunk utility, export/import format)
- [x] Feature: Version comparison — select two saved versions and see side-by-side diff of changes (SKUs added/removed, values changed per sheet)
- [x] Feature: Auto-save reminders — notification after 20 edits since last version, with dismiss cooldown and "Save Now" banner
- [x] Feature: Version notes/comments — expandable comments section on each version card with add/delete support
- [x] Testing: Version features tests (18 tests — comparison logic, auto-save threshold, comments structure)
- [x] Fix: Shipment (Production) page — freeze SKU Name + Weight columns (sticky left)
- [x] Fix: Shipment (Production) page — add Full Year total columns (FY 2025, FY 2026, etc.)
- [x] Fix: Arrival to Regie page — freeze SKU Name + Weight columns (sticky left)
- [x] Fix: Arrival to Regie page — add Full Year total columns (FY 2025, FY 2026, etc.)
- [x] Feature: Analysis page — 7 creative analytics tabs (Overview, By SKU, By Weight, By Category, By Flavor, Production, Stock Health)
- [x] Fix: Server-side closing stock weeks computation (replaced non-existent closingStockWeeks column with full formula replication)
- [x] Testing: Analysis computation tests (28 tests — weeks formula, zone classification, flavor extraction, production efficiency, FY totals, forecast accuracy)
- [x] Bug: Analysis page duplicate React keys — fixed by using year-qualified labels (e.g., Jan'25, Feb'26) across all charts and heatmaps
- [x] Fix: Remove opacity/transparency from flavor names on IMS vs Forecast page (bg-amber-100/50 → bg-amber-100 on odd SKU rows)
- [x] Feature: Combine Upload Data and Version Manager into a single "Data & Versions" page with tabs — sidebar shows one entry, old /upload and /versions routes redirect to /data-versions
- [x] Feature: Search and filter bar on IMS vs Forecast page — search by SKU name, filter by weight (1kg/250g/50g), filter by category (Core/NPI)
- [x] Feature: Year collapse/expand toggle on all data table pages (IMS vs Forecast, Forecast, Arrival, Shipment, Planning FG) — click year header to collapse all months for that year, show only year total column
- [x] Feature: "Collapse All Years" / "Expand All Years" buttons on all 5 data table pages to toggle all year columns at once
- [x] Feature: Stock Health Snapshot analysis — new tab on Analysis page showing SKUs not at healthy stock levels, risk tiers (Critical/Warning/Healthy), period-by-period breakdown, trend indicators, and actionable summaries

# Multi-Country Extension (Lebanon / Syria / Libya)

- [x] Schema: Add country field to skus, periods, forecast_data, ims_data, shipment_data, arrival_data, planning_fg_data, ssof_versions, audit_trail tables
- [x] Schema: Add packaging_type field to skus table (Old / New)
- [x] DB migration: run pnpm db:push
- [x] Auth: Add Syria users and Libya users to AuthContext
- [x] Auth: Add country access list per user (Walid -> all, Lebanon users -> Lebanon only, etc.)
- [x] Context: Create CountryContext to store selected country throughout the session
- [x] Routing: Add country-aware routing and update DashboardLayout sidebar
- [x] Backend: All data queries filter by country
- [x] Backend: SKU CRUD for Syria/Libya with country field
- [x] Backend: Pre-populate Syria and Libya with Al Fakher flavors on first setup
- [x] Backend: When a new SKU is created, auto-create rows in all planning tables for all periods
- [x] Syria/Libya pages: Rename terminology (Forecast Production, Production, Arrival, Forecast vs Forecast)
- [x] Syria/Libya: Forecast vs Forecast comparison page
- [x] SKU Management page for Syria/Libya with packaging type field
- [ ] Syria/Libya: Arrival timing with customizable offset per production batch (future)
- [ ] Analysis page: country-scoped data for all tabs (future)

# Auth Flow Redesign (Pre-login Country Selection)
- [x] Public landing page: 3 country cards (Lebanon, Syria, Libya) + Super Admin entry — no login required to view
- [x] Selecting a country card stores the selected country then redirects to login page
- [x] Login page shows which country was selected (e.g. "Sign in to Lebanon")
- [x] After login, validate user belongs to selected country; if not, show error and redirect to landing
- [x] Walid: Super Admin entry on landing page — after login can toggle between all 3 countries from sidebar
- [x] Remove post-login CountrySelectorPage — country is chosen before login
- [x] DashboardLayout: show country switcher ONLY for Walid/Super Admin

# User & Landing Page Fixes
- [x] Users: Syria and Libya — replace SyriaAdmin/LibyaAdmin with a single "walid" user (password: Walid) for each country
- [x] Users: Lebanon keeps original users (Walid, Taha, David, Aileen, Viewer)
- [x] Landing page: match the login page theme (light emerald/teal gradient, white card, Al Fakher logo)

# Login Bug Fixes
- [x] Password comparison: make fully case-insensitive for all users (Lebanon Walid password "Walid" should accept "walid", "WALID", etc.)
- [x] Fix "stuck on signing in..." spinner — login never completes after clicking Sign In

# Post-Login Blank Screen Bug
- [x] After successful login, "Welcome back" toast shows but dashboard never renders — blank white screen

# SKU Management (Syria & Libya)
- [x] Backend: country-scoped SKU list procedure (filter by country)
- [x] Backend: create SKU procedure (with name, weight, packagingType, country) + auto-propagate to all planning tables/periods
- [x] Backend: update SKU procedure (name, weight, packagingType)
- [x] Backend: delete SKU procedure (soft delete or hard delete with cascade)
- [x] Backend: seedCountrySkus procedure with full Al Fakher flavor list (all weights: 250g, 1kg) + packaging type
- [x] UI: SKU Management page for Syria/Libya — full CRUD table with packaging type column
- [x] UI: Seed Al Fakher SKUs button — one-click pre-population
- [x] UI: Create SKU dialog — name, weight, packaging type fields
- [x] UI: Edit SKU inline or dialog
- [x] UI: Delete SKU with confirmation
- [x] Auto-propagation: when SKU created, insert rows in forecast_data, shipment_data, arrival_data, ims_data, planning_fg_data for all existing periods

# Route 404 Fix
- [x] Fix 404 on /login?superadmin=1 — fixed: wouter location includes query string, now splitting on "?" to get pathname before comparing to "/login"

# Syria & Libya Database Clear
- [x] Delete all Syria and Libya rows from: forecast_data, ims_data, shipment_data, arrival_data, planning_fg_data, skus, periods, ssof_versions, audit_trail
- [x] Verify Lebanon data is untouched (29 SKUs, 36 periods, 1044 forecast rows all intact)

# Remove Al Fakher Seed Feature
- [x] Remove "Seed Al Fakher SKUs" button from SkuManagementPage
- [x] Remove seedSkus procedure from routers.ts
- [x] Remove seedCountrySkus and AL_FAKHER_FLAVORS from db.ts

# Dashboard Country-Scoped SKU Fix
- [x] Syria and Libya dashboards show Lebanon SKUs — fixed: Home page now splits into LebanonHome (uses trpc.skus.list) and IntlHome (uses trpc.country.skus) based on selected country

# Syria/Libya Menu & Arrival Fix
- [ ] Sidebar: Syria/Libya menu = Forecast Production, Forecast Production vs Actual Production, Production, Arrival (remove Planning FG, IMS, Analysis, etc.)
- [ ] Planning FG: Syria/Libya should NOT show Lebanon Planning FG data — remove Planning FG from Syria/Libya entirely
- [ ] Arrival: add offset input per production batch (days/weeks/months), compute arrival date = production period start + offset
- [ ] Backend: store arrivalOffset and arrivalUnit (days/weeks/months) in shipment_data or arrival_data table
- [ ] Arrival page: auto-populate arrival date from production entry + offset

# Arrival Status (Syria & Libya)
- [x] Schema: add arrivalStatus column to shipment_data (enum: Pending / In Transit / Arrived / Delayed)
- [x] Backend: add updateArrivalStatus procedure to country router
- [x] UI: status dropdown on each arrival batch row (Pending / In Transit / Arrived / Delayed)
- [x] UI: status badge colours (grey=Pending, blue=In Transit, green=Arrived, red=Delayed)

# Planning FG Restore
- [x] Restore Planning FG in Lebanon sidebar menu (was never removed)
- [x] Add country-scoped Planning FG for Syria/Libya (shows only their own SKUs)
- [x] Add backend planningFg procedure to country router
- [x] Add Planning FG to Syria/Libya sidebar
- [x] Register Syria/Libya Planning FG routes in App.tsx

# Planning FG for Syria & Libya (Completed)
- [x] IntlPlanningFgPage: weight-based filtering (50g/250g/1kg separate pages)
- [x] IntlPlanningFgPage: year collapse/expand buttons (Collapse All / Expand All)
- [x] IntlPlanningFgPage: editable cells (Opening Stock, Adjustments, Actual arrivals)
- [x] IntlPlanningFgPage: conditional formatting on Closing Stock - Weeks
- [x] IntlPlanningFgPage: packaging type badge (Old/New) on SKU card header
- [x] Sidebar: Planning FG 50g / 250g / 1kg entries for Syria/Libya
- [x] Routes: /intl-planning-fg-50g, /intl-planning-fg-250g, /intl-planning-fg-1kg registered in App.tsx

# Bug: Planning FG Arrival row not showing arrival data from Production page
- [x] Trace arrival data flow: Production page (shipment_data with arrivalOffset) → arrival_data → Planning FG Arrival row
- [x] Fix: Planning FG Arrival row now computed from shipment arrivalOffset (maps production period → arrival period via offset)
- [x] Fix: Falls back to manually stored arrivals if no offset-based arrivals exist for that period
- [x] Fix: Closing Stock chain updated to use offset-computed arrivals for all periods

# Syria/Libya: IMS page, Cleared status, Planning FG formula update
- [x] Schema: Add "Cleared" to arrivalStatus enum in shipment_data
- [x] DB migration: push schema change (migration 0010)
- [x] Backend: getFullPlanningDataForCountry returns arrivalStatus per shipment row
- [x] Frontend ArrivalPage: add "Cleared" to STATUS_CONFIG (green badge)
- [x] Frontend ArrivalPage: update summary cards to show Cleared/Arrived/InTransit/Delayed counts
- [x] Frontend ArrivalPage: update description to explain Cleared = counts in Planning FG
- [x] Backend: Add updateIms procedure in country router
- [x] Frontend: Build IntlImsPage.tsx (editable monthly IMS per SKU, year collapse/expand)
- [x] Planning FG: arrivalFromProductionMap only counts batches with arrivalStatus = "Cleared"
- [x] Planning FG formula: Closing Stock = Opening Stock + Adjustments + Arrivals(Cleared) - IMS
- [x] Planning FG: add imsMap from country IMS data
- [x] Planning FG: show IMS row in table (read-only, editable from IMS page)
- [x] Sidebar: add IMS page link for Syria/Libya
- [x] Route: /intl-ims registered in App.tsx

# Feature: Cleared Date on Arrival page
- [ ] Schema: Add clearedDate (date column, nullable) to shipment_data
- [ ] DB migration: push schema change
- [ ] Backend: Add updateClearedDate procedure in country router
- [ ] Backend: Return clearedDate in getFullPlanningDataForCountry
- [ ] Frontend ArrivalPage: show Cleared Date input when status = Cleared
- [ ] Frontend ArrivalPage: show days-at-port badge for Arrived batches (flag if > 7 days)
- [ ] Frontend ArrivalPage: show clearance lead time (arrival date → cleared date) on Cleared batches

# Feature: Partial Clearance on Arrival page
- [x] Schema: Add clearedQty (decimal, nullable) to shipment_data
- [x] Schema: Add "Partially Cleared" to arrivalStatus enum
- [x] DB migration: push schema changes (migrations 0011, 0012)
- [x] Backend: Add updateClearedQty procedure (sets clearedQty, auto-updates status to Partially Cleared or Cleared)
- [x] Backend: Add updateClearedDate procedure
- [x] Frontend ArrivalPage: add Cleared Qty (editable), Pending Qty (auto), Cleared Date, Days at Port columns
- [x] Frontend ArrivalPage: Days at Port flagged red if > 7 days and not fully cleared
- [x] Frontend ArrivalPage: auto-status logic (partial → Partially Cleared, full → Cleared)
- [x] Frontend IntlPlanningFgPage: arrivalFromProductionMap uses clearedQty (Cleared + Partially Cleared batches)
- [x] Planning FG: Partially Cleared batches count their clearedQty in Arrival row

# Feature: Syria/Libya Analysis Page
- [ ] Read Lebanon AnalysisPage structure
- [ ] Backend: add intlAnalysis query (production, clearance, IMS, planning FG data)
- [ ] Build IntlAnalysisPage: Production analysis section (monthly production by SKU/weight, totals)
- [ ] Build IntlAnalysisPage: Clearance analysis section (cleared qty, pending qty, clearance rate, days at port)
- [ ] Build IntlAnalysisPage: Planning FG analysis section (opening stock, arrivals, IMS, closing stock trends)
- [ ] Add /intl-analysis route in App.tsx
- [ ] Add Analysis sidebar entry for Syria/Libya in DashboardLayout.tsx

# Feature: Syria/Libya Analysis Page [DONE]
- [x] Backend: getIntlAnalysis function in db.ts (production, clearance, IMS analysis)
- [x] Backend: country.intlAnalysis tRPC procedure
- [x] Frontend: IntlAnalysisPage.tsx with 3 tabs: Production, Clearance, IMS
- [x] Production tab: KPIs, monthly trend, weight donut, per-SKU breakdown, sparklines
- [x] Clearance tab: KPIs, status distribution donut, delayed batches alert, progress by weight, full batch table with filter
- [x] IMS tab: KPIs, monthly trend, IMS vs Production comparison, per-SKU IMS breakdown
- [x] Sidebar: Analysis entry added to INTL_MENU
- [x] Route: /intl-analysis registered in App.tsx

# Feature: Create All Sizes SKU option
- [x] SKU creation dialog: add "Create all sizes (50g, 250g, 1kg)" toggle (pill toggle UI)
- [x] When toggle is on, hide the Weight dropdown and show 50g/250g/1kg pills; Category still selectable
- [x] Backend: bulk creation via sequential mutateAsync calls for each weight (50g, 250g, 1kg)
- [x] Success toast shows "Created 3 SKUs (50g, 250g, 1kg) for \"SKU Name\"."
- [x] Button label changes to "Create 3 SKUs" when toggle is on

# Feature: Drag-and-drop SKU reordering
- [x] Install @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
- [x] Schema: sortOrder column confirmed on skus table
- [x] Backend Lebanon: add reorderSkus procedure (batch update sortOrder)
- [x] Backend Syria/Libya: add reorderSkus procedure in country router
- [x] Frontend: SKU Management page shows SKUs grouped by weight sections (50g / 250g / 1kg)
- [x] Frontend: GripVertical drag handle on each row, drag within weight group only
- [x] Frontend: optimistic update on drag end, persist to backend via reorderMutation
- [x] All planning tables respect sortOrder when displaying SKUs (already ordered by sortOrder)

# Feature: Lebanon SKU Management parity
- [x] Lebanon: Add "Create all sizes" toggle (50g, 250g, 1kg in one step)
- [x] Lebanon: Proper Create dialog (modal) matching Syria/Libya UX
- [x] Lebanon: DnD reordering works correctly with weight groups
- [x] Lebanon: Stats cards (Total, 50g, 250g, 1kg, Core, NPI)
- [x] Lebanon: Delete confirmation dialog (matching Syria/Libya)
- [x] Lebanon: Empty state card with CTA button

# Feature: Packaging badge on all Syria/Libya pages [DONE]
- [x] ForecastPage (Syria/Libya): show Old/New badge next to SKU name in row header
- [x] ShipmentPage (Production, Syria/Libya): show Old/New badge next to SKU name
- [x] ArrivalPage (Syria/Libya): show Old/New badge next to SKU name
- [x] IntlImsPage: show Old/New badge next to SKU name
- [x] IntlPlanningFgPage (50g/250g/1kg): already had packaging badge (emerald=New, gray=Old)

# Feature: Packaging badge next to weight + Forecast→Production link
- [ ] Move Old/New badge to weight column (next to weight badge) on ForecastPage
- [ ] Move Old/New badge to weight column on ShipmentPage (Production)
- [ ] Move Old/New badge to weight column on ArrivalPage
- [ ] Move Old/New badge to weight column on IntlImsPage
- [ ] Move Old/New badge to weight column on IntlPlanningFgPage (already in SKU card header)
- [ ] Forecast→Production: when Forecast cell is saved for Syria/Libya, auto-populate Production W1 of same month
- [ ] Forecast→Production: add week selector (W1/W2/W3/W4) per SKU-period to override which week receives the value
- [ ] Backend: add procedure to write Forecast value into Production week cell
- [ ] Frontend: show a small "→ Prod W1" indicator on Forecast cells that have been linked

# Fix: Packaging badge missing on Forecast vs Actual (IMS vs Forecast) page [DONE]
- [x] ImsVsForecastPage (Syria/Libya): add Old/New badge next to weight column
- [x] Complete Forecast→Production week selector UI (W1/W2/W3/W4 popover on Forecast cells)
- [x] Forecast→Production: auto-write to Production W1 when Forecast saved (Syria/Libya only)
- [x] Week selector: small →W1 badge on each Forecast cell with value; click to open W1/W2/W3/W4 picker

# Bug: Old/New badge not showing on IMS vs Forecast page [FIXED]
- [x] Root cause: packagingType was null in DB for existing SKUs; condition `&& packagingType` evaluated false
- [x] Fix: changed all 5 pages to use `packagingType ?? 'New'` so badge always shows (defaults to New)
- [x] Fix applied to: ImsVsForecastPage, ForecastPage, ShipmentPage, ArrivalPage, IntlPlanningFgPage, IntlImsPage
- [x] ImsVsForecastPage: badge only shown for Syria/Libya (isLebanon guard added)

# Fix: Packaging badge styling + Lebanon guard [DONE]
- [x] New badge: black background + bold green-400 font
- [x] Old badge: red-900 (blood red) background + bold white font
- [x] ForecastPage: Lebanon guard added (!isLebanon)
- [x] ShipmentPage: Lebanon guard added (!isLebanon)
- [x] ArrivalPage: intl-only page, no guard needed
- [x] IntlImsPage: intl-only page, no guard needed
- [x] IntlPlanningFgPage: intl-only page, no guard needed
- [x] ImsVsForecastPage: Lebanon guard already present, style updated

# Bug: Packaging badge STILL not showing on IMS vs Forecast page [FIXED]
- [x] Root cause: Syria/Libya uses ForecastVsForecastPage (/forecast-vs-forecast), NOT ImsVsForecastPage (/ims-vs-forecast)
- [x] Fix: added packaging badge to ForecastVsForecastPage weight cell (same black/green, red/white style)

# Fix: New packaging badge color
- [x] Change New badge: light green bg (bg-green-100) + dark green bold font (text-green-800) on all 7 pages

# Feature: Forecast Production filters (Syria/Libya) [DONE]
- [x] Add SKU name search input
- [x] Add size filter pills: All / 50g / 250g / 1kg
- [x] Add packaging filter pills: All / New / Old
- [x] Filters apply to the Syria/Libya table only (Lebanon unaffected)
- [x] Clear filters button + SKU count shown when filters active

# Feature: Planning FG Year Total + Filters (Syria/Libya)
- [x] Add Year Total row to Syria/Libya Planning FG (matching Lebanon style)
- [x] Add filter bar to Syria/Libya Planning FG: SKU name search, size pills, packaging pills

# Fix: React unique key prop warning in IntlPlanningFgPage
- [x] Fix missing key prop on expanded year cells + total cell in Planning FG table rows

# Fix: Arrival page dashboard cards not updating from live data
- [x] Fix dashboard summary cards to compute from live shipment/arrival data (Cleared, Partially Cleared, In Transit, Pending counts and totals)

# Feature: Arrival page "Still to Clear" card
- [x] Add Still to Clear total card showing sum of uncleared qty across all non-fully-cleared batches

# Feature: Arrival page dashboard rework
- [x] Rework dashboard cards into a clean, consistent layout with uniform sizing, typography, and logical grouping

# Feature: Production page sticky Date + SKU columns
- [x] Freeze Date and SKU columns in Production table so they stay visible while scrolling horizontally

# Feature: Arrival page improvements
- [ ] Add "Pending Clear Date" field (expected clearance date) to Arrival table
- [ ] Fix slow Cleared Date input - debounce saves to avoid re-render on every keystroke
- [ ] Add arrow-key navigation between editable cells in Arrival table

# Feature: Multi-event clearance system
- [ ] Add clearanceEvents table (skuId, periodId, country, clearedQty, clearedDate, pendingClearDate, notes)
- [ ] Add DB helpers: addClearanceEvent, deleteClearanceEvent, getClearanceEventsForBatch, getTotalClearedForBatch
- [ ] Add tRPC procedures: country.addClearanceEvent, country.deleteClearanceEvent, country.clearanceEvents
- [ ] Include clearance events in country.data query
- [ ] Rework Arrival page: expandable clearance events per batch, running total, pending qty, next expected date
- [ ] Ensure Planning FG reads summed cleared qty from clearance events
- [x] Make Pending Qty editable per clearance event
- [x] Add Pending Clear Date column per clearance event row
- [x] Expandable clearance events panel per batch row
- [x] Show Pending Clear Date only on the last clearance event row
- [x] Fix Planning FG Arrivals: use clearance event Cleared Date to map qty to correct period
- [x] Invalidate Planning FG cache on all clearance event mutations (add/update/delete)
- [x] Add per-SKU Sync button to Planning FG page
- [x] Reduce Planning FG query staleTime for faster sync
- [x] Add Sync All button to Planning FG page header
- [x] Add Sync All button to Forecast page header
- [x] Add Sync All button to IMS/IntlIms page header
- [x] Add Sync All button to Shipment (Production) page header
- [x] Add Sync All button to Arrival page header
- [x] Add 30-second auto-sync interval to Planning FG page
- [x] Delete all users except Walid from database
- [x] Add countryAccess column to user schema (Lebanon/Syria/Libya multi-select)
- [x] Restrict user creation/management to owner (Walid) only
- [x] Add country assignment UI to User Management page
- [x] Enforce country-based access: users only see their assigned country
- [x] Scope unsaved changes save reminder to specific country where edits were made
- [x] Add 50g card to Libya/Syria dashboard stat cards
- [x] Make username login case-insensitive
- [x] Add show/hide password toggle to login form
- [x] Fix login for existing users with mixed-case stored usernames
- [ ] Migrate app users from localStorage to server DB (cross-device login)
- [ ] Add appUsers table to schema and push migration
- [ ] Add tRPC procedures for user CRUD and login verification
- [ ] Rewrite AuthContext to verify login via server
- [ ] Update UserManagementPage to use server procedures
- [ ] Fix country case mismatch in verifyAppUserLogin so non-Walid users can login
- [x] Feature: Add period filter to Arrival page (Syria/Libya) - filter batches by production period (year + month dropdown)
- [ ] Bug: Forecast Production week changes (W1→W3) do not sync to Production page after clicking Sync All
- [x] Feature: Group Arrival page batches by period (month/year) with collapsible sections and period-level summary stats
- [x] Feature: Restrict User Management page to Walid (isOwner) only — hide from sidebar and block direct URL access for all other users
- [x] Bug: Forecast Production week (W1-W4) resets to W1 on page navigation - week selection not persisted to DB
- [x] Bug: Forecast Production week change does not sync/reflect in Production page
- [x] Feature: Style Total columns distinctly (bold, different background) from month/period columns across all pages
- [x] Feature: Add week collapse/expand toggle to Production (ShipmentPage) so W1-W4 columns can be hidden

# Feature: SKU Enable/Disable + Weight Group Collapse
- [x] Schema: Add isActive column (boolean, default true) to skus table
- [x] DB migration: push schema change
- [x] Backend: filter disabled SKUs from all data queries (country.skus, country.data, etc.)
- [x] UI: SKU Management page — add enable/disable toggle per SKU row (green=enabled, red=disabled)
- [x] UI: Disabled SKUs hidden from Forecast Production, Production, Arrival, IMS, Planning FG pages
- [x] Feature: Weight-group collapse/expand on Forecast Production page (Syria/Libya)
- [x] Feature: Weight-group collapse/expand on Forecast vs Actual page (Syria/Libya)
- [x] Feature: Weight-group collapse/expand on Production page (Syria/Libya)
- [x] Feature: Weight-group collapse/expand on IMS page (Syria/Libya)
- [x] Bug: Total column styling (amber/bold) not applied on Forecast Production vs Actual page
- [x] Bug: 404 Page Not Found shown after login — fixed by redirecting /login to / when already authenticated
- [x] Task: Audit and replicate all Syria features to Libya — confirmed all pages already serve both Syria and Libya equally
- [x] Bug: Lebanon file upload fails with "week1/week2/week3/week4 undefined" — fixed: server now accepts optional week fields and Lebanon monthly total via 'value' field
- [x] Feature: Live presence system — show who is online, their country, and current page in sidebar footer (like Excel collaborative presence)
- [x] Bug: Lebanon file upload creates duplicates on re-upload — fixed: SKU lookup now matches by name+weight, existing duplicate SKUs cleaned from DB (49 SKUs remain, 0 duplicates)
- [x] Bug: Lebanon upload affects all countries — SKUs not scoped by country during upload; fix to create/match SKUs by country only
- [x] Bug: Lebanon dashboard shows 49 SKUs instead of 29 — fixed by scoping all Lebanon data/SKU queries to country='Lebanon' only (Home.tsx, SkuManagementPage.tsx, data.* procedures, getFullPlanningData)
- [x] One-time SQL cleanup: delete orphan data rows in Lebanon tables (forecast_data, ims_data, shipment_data, arrival_data, planning_fg_data) whose skuId belongs to Syria or Libya SKUs — 3,246 rows deleted, all tables verified clean
- [x] Add X close/dismiss button to the "reminder to save" banner
- [x] Bug: Lebanon pages show months twice (Jan-Dec then Jan-Apr empty) — fixed by scoping all periods queries to country='Lebanon' across routers.ts, db.ts, Home.tsx, AddYearPage.tsx
- [x] Bug: Syria pages show empty data — root cause: Syria data was previously stored against Lebanon SKU IDs (orphan rows), deleted by cleanup. Syria must re-upload all files.
- [x] Bug: Arrival empty in Syria — Syria Arrival page is driven by shipment data; since Syria has 0 shipment rows, arrival shows nothing. Re-upload Syria shipment file to fix.
- [x] Bug: Syria Planning FG shows 8,206 — was a clearance event (ID=60006) entered manually; wiped as part of Syria data reset
- [x] Wipe all Syria and Libya data (forecast, IMS, shipment, arrival, planning_fg, clearance_events, revised_forecast, upload_history) — keep SKUs, periods, users. Deleted: 649 revised_forecast rows + 10 clearance events. All other tables were already empty.
- [x] New page: Recommended Forecast SKU Split — user inputs total tonnage + mastercase weight + target month, AI analyses historical IMS trends and seasonality to recommend per-SKU mastercase quantities. Available in both Lebanon and Syria/Libya menus. Includes CSV export, trend badges, share bars, and AI insight summary.
- [x] Feature: "Apply to Forecast" button on Recommended Forecast SKU Split page — writes recommended mastercase quantities to the official Forecast for the selected month with confirmation dialog, audit trail logging, and success state indicator
- [x] Feature: Undo button on Recommended Forecast SKU Split page — reverts forecast to previous values after applying a recommendation. Snapshot saved on apply, Undo dialog shows per-SKU previous values, audit trail logged.
- [x] Enhancement: Improve AI forecast recommendation accuracy — added YoY growth rates, 3-month rolling trend, seasonality index, share drift analysis, forecast vs IMS accuracy history, and richer market context to the LLM prompt
- [x] Enhancement: AI forecast recommendation now scans Planning FG pages — factors in closing stock weeks, stock health zones (red/amber/green), critical/overstock periods per SKU. Stock column added to results table with Critical/Healthy/Overstock badges. Row highlighting for critical (red) and overstock (amber) SKUs.
- [x] Feature: Bulk apply across consecutive months — apply the same AI-recommended split to 2-3 consecutive months at once (multi-month apply dialog with month checkboxes)
- [x] Feature: Per-SKU confidence score — display confidence % next to each SKU in AI recommendation results, calculated from historical share consistency (low variance = high confidence)
- [x] Bug: Clearing a value in Forecast Production not reflected in Forecast Production vs Actual (stale cache) - fixed by adding staleTime:0 + refetchOnWindowFocus to ForecastVsForecastPage query
- [x] Bug: Full cross-page sync audit - Lebanon Forecast changes now also invalidate imsVsForecast + planningFg; Syria/Libya Forecast changes now also invalidate country.planningFg; IntlPlanningFgPage now also invalidates country.data; PlanningFgPage updateCell now invalidates forecast + imsVsForecast; ShipmentPage + ArrivalPage + InvoicedSHPDialog now invalidate imsVsForecast
- [x] Feature: Rework AI Recommended Forecast with deep market research, multi-factor algorithm (market share, competition, stock health, seasonality, competitive intelligence per country)
- [x] Bug: Ramadan driver incorrectly shown for May 2026 — fix Ramadan calendar (2026 is Feb/Mar only)
- [x] Feature: Add packaging type (Old/New) to AI recommendation output per SKU
- [x] Feature: Freeze Date and SKU columns on IMS page for horizontal/vertical scrolling
- [x] Feature: Export All Pages to single Excel workbook (Forecast, IMS, Shipment, Arrival, Planning FG 50g/250g/1kg) pre-filled with current data
- [x] Fix: SSOF subtitle corrected to "Sales, Stock, Orders & Forecast" across all pages (Login, Country Selector, Landing Page, Excel export)\n

# Feature: Enhanced Syria/Libya Analysis Dashboard [DONE]
- [x] Backend: getIntlAnalysis now returns packagingType per SKU, forecastData, imsGrowthRate, topSkusByIms, forecastAccuracy, skuTrend, revisedForecastSeries
- [x] IntlAnalysisPage: rebuilt with 4 tabs (Production, Forecast Accuracy, IMS & Stock Health, Clearance)
- [x] Production tab: KPIs (Total SKUs, Production, IMS, Gap), monthly trend sparklines, stacked bar chart, weight/packaging donut charts, per-SKU breakdown with packaging labels
- [x] Forecast Accuracy tab: overall accuracy KPI, best/worst period, forecast vs actual vs revised stacked bar, per-period accuracy table with variance and color-coded accuracy badges
- [x] IMS & Stock Health tab: IMS growth rate KPI, top SKUs by IMS volume, monthly IMS trend, IMS vs Production comparison, per-SKU IMS breakdown with packaging labels
- [x] Clearance tab: clearance rate KPI, status donut, delayed batches alert, clearance progress by weight, full batch table with packaging labels
- [x] Packaging type labels (Old Pkg / New Pkg) added to PlanningFgPage (Lebanon) and ArrivalPage (Lebanon)

# Feature: Keyboard Arrow-Key Navigation in All Data Tables
- [x] Build shared useArrowNav hook (ArrowUp/Down/Left/Right, Tab, Enter, Escape) for grid cell navigation
- [x] ForecastPage (Lebanon): arrow-key navigation between editable cells
- [x] ImsVsForecastPage (Lebanon): arrow-key navigation
- [x] ShipmentPage (Lebanon): arrow-key navigation across week columns
- [x] ArrivalPage (Lebanon/Syria/Libya): arrow-key navigation across week columns
- [x] PlanningFgPage (Lebanon 50g/250g/1kg): arrow-key navigation
- [x] ForecastPage (Syria/Libya): arrow-key navigation
- [x] IntlImsPage (Syria/Libya): arrow-key navigation
- [x] IntlPlanningFgPage (Syria/Libya 50g/250g/1kg): arrow-key navigation

# Feature: Product Expiry Dashboard (Syria & Libya)
- [x] Backend: tRPC procedure country.expiryDashboard — returns per-SKU closing stock with expiry date (production date + 2 years), alert tier (Expired / 2M / 4M / 6M / OK)
- [x] Frontend: ExpiryDashboardPage — summary KPI cards (Expired, 2M, 4M, 6M counts), alert-tier color-coded table, country filter, SKU search
- [x] Register route /expiry in App.tsx for Syria/Libya sidebar
- [x] Tests: 14 expiry logic unit tests (178 total passing)

# Bug Fixes: Expiry Dashboard + Ramadan Driver
- [x] Fix: Expiry date calculation — production Dec '25 expires Dec '27 (verified: logic was already correct)
- [x] Fix: Replace skull emoji with professional black circle + ShieldAlert icon on Expired tier
- [x] Fix: Polish Expiry Dashboard — gradient KPI cards, progress bars, cleaner table, better legend
- [x] Fix: Ramadan driver — added server-side post-processing to forcefully override ramadan_uplift for non-Ramadan months + strip Ramadan text from seasonality notes

# Feature: Additional Expiry Alert Tiers (9M, 12M, 18M, 24M)
- [x] Backend: Add 9M, 12M, 18M, 24M alert tiers to getExpiryDashboard in db.ts
- [x] Backend: Add nineMonth, twelveMonth, eighteenMonth, twentyFourMonth to router summary
- [x] Frontend: Add 9M, 12M, 18M, 24M tier cards, badges, colors to ExpiryDashboardPage (2-row layout: Critical + Watch List)
- [x] Update expiry tests for new tiers (21 tests, 185 total passing)

# Fix: Expiry Dashboard — Show All Produced Batches (Including Cleared)
- [x] Backend: Remove the `atRisk <= 0` skip — always include every batch within 24M window
- [x] Backend: Add `isCleared: boolean` field to ExpiryRow (atRiskQty === 0 means fully cleared)
- [x] Frontend: Show cleared batches with distinct green "Cleared" badge, muted/strikethrough row style
- [x] Frontend: Add "Stock Status" filter (All / At Risk Only / Cleared Only) + cleared count in summary bar
- [x] Update expiry tests for cleared batch behavior (187 total passing)

# Redesign: Expiry Dashboard — Proper Batch Lifecycle Tracking
- [x] Audit: understand Production → Clearance → IMS → Closing Stock data flow per batch
- [x] Design: per-batch lifecycle algorithm (produced qty, cleared qty, sold qty, remaining at port, remaining in-country)
- [x] Backend: rewrite getExpiryDashboard with proper batch-level tracking (FIFO IMS attribution to oldest cleared batches)
- [x] Frontend: redesign dashboard — lifecycle summary cards (At Port, In-Country, Sold, Remaining), per-batch table with all columns, stacked lifecycle bar, location filter
- [x] Tests: 187 tests passing, 0 TypeScript errors

# Feature: Expiry Dashboard — Sort by Date + Collapsible Groups
- [x] Sort batches by production date (oldest first)
- [x] Group batches by production month with collapsible headers (with subtotals per group)
- [x] Add expand/collapse all toggle button

# Feature: Forecast vs Actual Auto-Fill
- [x] Audit ImsVsForecastPage to understand forecast vs actual data flow
- [x] Add per-month "Auto-Fill" button in each month column header
- [x] Backend: autoFillImsFromForecast mutation copies all forecast values to IMS for a given period
- [x] Two-click confirmation (click once = "Confirm?", click again = execute, auto-dismiss after 3s)
- [x] Visual indicator: green "Filled" badge after auto-fill, toast notification with count

# Feature: Version/Snapshot Management for Syria & Libya
- [x] Audit Lebanon versioning system (backend + frontend)
- [x] Extend backend: getFullSnapshot, saveVersion, listVersions, restoreSnapshot accept country parameter
- [x] Country-scoped snapshots only capture that country's SKUs/periods/data
- [x] Frontend: Pass current country context to versions API calls (list, save, import)
- [x] Add "Data & Versions" nav item to Syria/Libya sidebar
- [x] Schema already has country column on ssof_versions table

# Fix: Forecast Split Recommendation
- [x] Remove Master Case weight input field (hardcode 6kg default)
- [x] Add Tons / Master Cases unit toggle (blue toggle buttons)
- [x] When "Master Cases" selected, user enters MC directly; when "Tons", convert to MC using 6kg
- [x] Summary preview auto-calculates both directions (tons→MC, MC→tons)

# Feature: Forecast Split AI Recommendation Excel Export
- [x] Audit ForecastSplitPage result data structure (SKU splits, totals, metadata)
- [x] Build server-side Excel export endpoint (/api/export-forecast-split) with ExcelJS
- [x] Add "Export Excel" button to ForecastSplitPage results section (replaces CSV)
- [x] Format Excel: Summary sheet (metadata, AI insight, market intel, warnings) + SKU Split sheet (styled table, Core/NPI separators, conditional formatting, totals, unassigned row)
- [x] 11 unit tests for Excel export (198 total passing), CSV fallback if server fails

# Feature: Apply Forecast — Packaging Badge + Cascade to IMS & Planning FG
- [x] Show packaging type (Old/New) badge next to each SKU in Apply confirmation dialog
- [x] Show packaging type in Undo dialog SKU list
- [x] When applying forecast, also write values to IMS data for the same period (single + bulk)
- [x] When undoing, also restore previous IMS values (previousImsValue in snapshot)
- [x] Invalidate IMS + Planning FG queries after apply/undo so pages reflect changes immediately
- [x] 198 tests passing, 0 TypeScript errors

# Bug: IMS Total Mismatch After AI Forecast Apply
- [ ] Investigate: applying 20,000 MC in April 2026 forecast only shows 11,830 in IMS total
- [ ] Fix root cause of IMS total discrepancy

# URGENT Bug (FIXED): restoreSnapshot corrupted data
- [x] Fix: restoreSnapshot now includes country field on periods and SKUs insert
- [x] Fix: restoreSnapshot now includes ALL fields (packagingType, isActive, arrivalOffsetValue, arrivalStatus, clearedQty, clearedDate, pendingClearDate, arrivalOffsetWeeks)
- [x] Fix: Uses inArray for batch deletes, proper country-scoped delete-then-insert
- [x] Recovered Syria data from saved "Master Version" snapshot (21 SKUs, 36 periods, 123 forecast, 123 IMS, 124 shipment, 108 arrival, 108 planning FG)

# Feature: Multi-Month AI Forecast Split Duration
- [x] Add duration selector: 1 month, 3 months, 12 months
- [x] Add starting month selector (e.g., Apr '26)
- [x] Update LLM prompt to handle multi-month forecasts (generate per-month splits via sequential calls)
- [x] Update results display to show per-month breakdown (collapsible month sections)
- [x] Update apply logic to write forecast/IMS for all selected months (Apply All button)
- [x] Update Excel export to include multi-month data (Overview + SKU Comparison + per-month detail sheets)
- [x] Vitest: 10 tests for multi-month Excel export (208 total tests passing)

# Feature: Expert Forecasting System Enhancement
- [x] Add 6-month duration option (1M / 3M / 6M / 12M)
- [x] Enhance LLM prompt with expert forecasting intelligence (seasonality calendar, year-end closing patterns, Ramadan, summer peaks)
- [x] Add progressive month-over-month context (each month's forecast informs the next month's generation)
- [x] Include year-end closing logic (December slowdowns, Q4 inventory adjustments, January restocking)
- [x] Improve seasonality modeling with month-specific multipliers and market intelligence
- [x] Update frontend duration selector to include 6M option
- [x] Ensure multi-month Excel export handles 6-month duration
- [x] Extended Ramadan calendar coverage (2024-2030)
- [x] Updated bulkApplyToForecast max months from 6 to 12
- [x] Smooth transition rules (no >15% MoM swings unless justified)
- [x] All 208 tests passing, no TypeScript errors

# Fix: Forecast Split Order Parameters Label
- [x] Rename "Total Order (Tons)" / "Total Order (Master Cases)" label to "Monthly Desired Forecast (Tons)" / "Monthly Desired Forecast (MC)"

# Bug: Multi-Month Apply All Does Nothing
- [x] Fix: Apply All for 3M/6M/12M forecast does nothing — root cause was raw fetch() bypassing superjson transformer; fixed by using utils.client.forecastSplit.applyToForecast.mutate() and utils.client.forecastSplit.recommend.mutate() via tRPC client directly

# Fix: Redundant 'Assigned' Card in Forecast Split Results
- [x] Remove 'Assigned' card (redundant - should always equal Total MC) and replace with 'Allocation' card showing green ✓ 100% / Fully allocated when correct, or amber gap indicator if rounding discrepancy

# Feature: Upload Modified Excel Forecast to IMS
- [x] Backend: Express /api/upload-forecast-split endpoint using multer, parses uploaded Excel via forecastSplitExcelParser.ts
- [x] Backend: Reuse applyToForecast logic to write parsed rows to IMS (via utils.client.forecastSplit.applyToForecast.mutate)
- [x] Frontend: Upload button on Recommended Forecast page (always visible at bottom of page)
- [x] Frontend: Preview table showing parsed months with MC totals and SKU counts
- [x] Frontend: "Apply Uploaded Modified Forecast to IMS" confirmation dialog and apply action
- [x] Handle single-month and multi-month exported Excel formats
- [x] 13 vitest tests for parser (221 total tests passing)

# Fix: "Master Cases" Toggle Button Wrapping
- [x] Fix Input Unit toggle: "Master Cases" text wraps onto two lines — added whitespace-nowrap, px-4, and minWidth:200px to the toggle container
