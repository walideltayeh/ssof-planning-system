import { integer, pgEnum, pgTable, text, timestamp, varchar, numeric, json, boolean, date, serial } from "drizzle-orm/pg-core";

// Country enum used across all tables
export const COUNTRIES = ["Lebanon", "Syria", "Libya", "KSA"] as const;
export type Country = typeof COUNTRIES[number];

export const countryEnum = pgEnum("country", ["Lebanon", "Syria", "Libya", "KSA"]);
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const categoryEnum = pgEnum("category", ["Core", "NPI"]);
export const packagingTypeEnum = pgEnum("packagingType", ["Old", "New"]);
export const arrivalStatusEnum = pgEnum("arrivalStatus", ["Pending", "In Transit", "Arrived", "Delayed", "Cleared", "Partially Cleared"]);
export const appRoleEnum = pgEnum("app_role", ["admin", "viewer"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// SKU master table - per country
export const skus = pgTable("skus", {
  id: serial("id").primaryKey(),
  country: countryEnum("country").default("Lebanon").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  weight: varchar("weight", { length: 10 }).notNull(),
  category: categoryEnum("category").default("Core").notNull(),
  packagingType: packagingTypeEnum("packagingType").default("New"),
  sortOrder: integer("sortOrder").notNull().default(0),
  isExcludedFromTotal: boolean("isExcludedFromTotal").default(false),
  isActive: boolean("isActive").default(true).notNull(),
  // Secondary supply-chain price list (per country, per SKU/format).
  // Trade-tier prices are per MASTERCASE (MC); the final RSP is per pack.
  // Null = not set yet; the Trade Offers page falls back to the WS list price.
  priceToWs: numeric("priceToWs", { precision: 12, scale: 2 }),                       // our selling price to Wholesale, $/MC
  priceWsToSemiWs: numeric("priceWsToSemiWs", { precision: 12, scale: 2 }),           // WS → Semi-WS / Tobacconists, $/MC
  priceSemiWsToRetail: numeric("priceSemiWsToRetail", { precision: 12, scale: 2 }),   // Semi-WS → Retail, $/MC
  finalRspPerPack: numeric("finalRspPerPack", { precision: 12, scale: 2 }),           // consumer shelf price, $/pack
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Sku = typeof skus.$inferSelect;
export type InsertSku = typeof skus.$inferInsert;

// Monthly periods reference - per country
export const periods = pgTable("periods", {
  id: serial("id").primaryKey(),
  country: countryEnum("country").default("Lebanon").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  label: varchar("label", { length: 20 }).notNull(),
  sortOrder: integer("sortOrder").notNull(),
});
export type Period = typeof periods.$inferSelect;

// Forecast data (monthly values per SKU) - country derived from SKU
export const forecastData = pgTable("forecast_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).default("0"),
  targetWeek: varchar("targetWeek", { length: 10 }).default("week1"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ForecastData = typeof forecastData.$inferSelect;

// Actual production data for Syria/Libya/KSA (Forecast vs Actual comparison)
// Records what was actually produced/shipped per SKU per period, to compare
// against the forecast plan. Renamed from `revised_forecast_data` in May 2026
// when the Arrival page was reframed as Plan vs Actual.
export const actualProductionData = pgTable("actual_production_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).default("0"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ActualProductionData = typeof actualProductionData.$inferSelect;

// IMS (actual) data (monthly values per SKU)
// `source` records how the value got there:
//   "manual"        – default, user typed it in or it was uploaded as IMS
//   "auto_forecast" – pushed in by the "Auto-fill IMS from Forecast" action.
// The UI uses this to color future-period cells that came from a recommended
// forecast push so planners can see which months are "system-suggested" vs
// "actually known".
export const imsData = pgTable("ims_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).default("0"),
  isActual: boolean("isActual").default(false),
  source: varchar("source", { length: 20 }).default("manual").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ImsData = typeof imsData.$inferSelect;

// Shipment (Production) data - weekly breakdown
export const shipmentData = pgTable("shipment_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  week1: numeric("week1", { precision: 12, scale: 2 }).default("0"),
  week2: numeric("week2", { precision: 12, scale: 2 }).default("0"),
  week3: numeric("week3", { precision: 12, scale: 2 }).default("0"),
  week4: numeric("week4", { precision: 12, scale: 2 }).default("0"),
  arrivalOffsetValue: integer("arrivalOffsetValue").default(0),
  arrivalOffsetUnit: varchar("arrivalOffsetUnit", { length: 10 }).default("days"),
  arrivalStatus: arrivalStatusEnum("arrivalStatus").default("Pending"),
  clearedQty: numeric("clearedQty", { precision: 12, scale: 2 }),
  clearedDate: date("clearedDate"),
  pendingClearDate: date("pendingClearDate"),
  note: text("note"),
  invoiceRef: varchar("invoiceRef", { length: 200 }),
  containerRef: varchar("containerRef", { length: 200 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ShipmentData = typeof shipmentData.$inferSelect;

// Arrival data - weekly breakdown, with optional arrival offset (weeks after production)
export const arrivalData = pgTable("arrival_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  week1: numeric("week1", { precision: 12, scale: 2 }).default("0"),
  week2: numeric("week2", { precision: 12, scale: 2 }).default("0"),
  week3: numeric("week3", { precision: 12, scale: 2 }).default("0"),
  week4: numeric("week4", { precision: 12, scale: 2 }).default("0"),
  arrivalOffsetWeeks: integer("arrivalOffsetWeeks").default(0),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ArrivalData = typeof arrivalData.$inferSelect;

// Planning FG data - per SKU per period
export const planningFgData = pgTable("planning_fg_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  openingStock: numeric("openingStock", { precision: 12, scale: 2 }).default("0"),
  adjustments: numeric("adjustments", { precision: 12, scale: 2 }).default("0"),
  invoiced: numeric("invoiced", { precision: 12, scale: 2 }).default("0"),
  arrivals: numeric("arrivals", { precision: 12, scale: 2 }).default("0"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PlanningFgData = typeof planningFgData.$inferSelect;

// Clearance events - multiple partial clearances per production batch (Syria/Libya)
export const clearanceEvents = pgTable("clearance_events", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  country: countryEnum("country").notNull(),
  clearedQty: numeric("clearedQty", { precision: 12, scale: 2 }).notNull(),
  clearedDate: date("clearedDate").notNull(),
  pendingClearDate: date("pendingClearDate"),
  notes: text("notes"),
  invoiceRef: varchar("invoiceRef", { length: 200 }),
  containerRef: varchar("containerRef", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ClearanceEvent = typeof clearanceEvents.$inferSelect;
export type InsertClearanceEvent = typeof clearanceEvents.$inferInsert;

// Upload history
export const uploadHistory = pgTable("upload_history", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  country: countryEnum("country").default("Lebanon"),
  uploadType: varchar("uploadType", { length: 50 }).notNull(),
  fileName: varchar("fileName", { length: 255 }),
  recordsProcessed: integer("recordsProcessed").default(0),
  status: varchar("status", { length: 20 }).default("pending"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UploadHistory = typeof uploadHistory.$inferSelect;

// SSOF Saved Versions - per country
export const ssofVersions = pgTable("ssof_versions", {
  id: serial("id").primaryKey(),
  country: countryEnum("country").default("Lebanon").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  savedBy: varchar("savedBy", { length: 100 }).notNull(),
  snapshotData: json("snapshotData").notNull(),
  changesSummary: json("changesSummary"),
  docUrl: text("docUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SsofVersion = typeof ssofVersions.$inferSelect;
export type InsertSsofVersion = typeof ssofVersions.$inferInsert;

// Version comments / notes
export const versionComments = pgTable("version_comments", {
  id: serial("id").primaryKey(),
  versionId: integer("versionId").notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type VersionComment = typeof versionComments.$inferSelect;
export type InsertVersionComment = typeof versionComments.$inferInsert;

// Audit trail - logs all data changes
export const auditTrail = pgTable("audit_trail", {
  id: serial("id").primaryKey(),
  country: countryEnum("country").default("Lebanon"),
  username: varchar("username", { length: 100 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  sheet: varchar("sheet", { length: 100 }),
  skuName: varchar("skuName", { length: 255 }),
  periodLabel: varchar("periodLabel", { length: 50 }),
  field: varchar("field", { length: 100 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AuditTrail = typeof auditTrail.$inferSelect;
export type InsertAuditTrail = typeof auditTrail.$inferInsert;

// App users - managed by owner (Walid), stored server-side for cross-device access
export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  displayName: varchar("displayName", { length: 255 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  role: appRoleEnum("role").default("viewer").notNull(),
  countries: text("countries").notNull(),
  // JSON map of per-country role overrides, e.g. {"Lebanon":"admin","KSA":"viewer"}.
  // When a country is missing from this map, the global `role` field above is
  // used as the effective role for that country. Owners are admin everywhere
  // regardless of either field.
  countryRoles: text("countryRoles").default("{}").notNull(),
  isOwner: boolean("isOwner").default(false).notNull(),
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type AppUserRow = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// User presence - tracks who is online and what page they are viewing
export const userPresence = pgTable("user_presence", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull(),
  displayName: varchar("displayName", { length: 255 }).notNull(),
  country: varchar("country", { length: 50 }).notNull(),
  currentPage: varchar("currentPage", { length: 255 }).notNull().default("/"),
  lastSeen: timestamp("lastSeen").defaultNow().notNull(),
});
export type UserPresence = typeof userPresence.$inferSelect;

// Persistent server-side configuration that must survive restarts but must
// NEVER appear in source-controlled files like .replit. Currently used to
// auto-provision the JWT signing secret on first boot when JWT_SECRET is
// not provided as an environment variable. Keep this table tiny and
// owner-only — never expose it to client routers.
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;

// ==================== Trade Offers: POSM + FOC rules ====================

// Point-of-sale materials (hoses, playing cards, notebooks, display stands…)
// managed per country. "Analyse POSM" fills channelQty / priority / rationale
// so each material lands with the channel it suits best (e.g. hoses → HoReCa
// top priority, notebooks → all channels). Quantities stay editable by admins.
export const posmItems = pgTable("posm_items", {
  id: serial("id").primaryKey(),
  country: varchar("country", { length: 50 }).notNull().default("Lebanon"),
  name: varchar("name", { length: 255 }).notNull(),
  unitValue: numeric("unitValue", { precision: 12, scale: 2 }),      // $ per unit, optional
  channelQty: json("channelQty"),        // Record<channel, number> — qty per kit for that channel
  priority: json("priority"),            // Record<channel, 0|1|2> — 0 none, 1 suitable, 2 top priority
  rationale: text("rationale"),          // one-line analysis note ("Hoses are used at the lounge table…")
  analysisSource: varchar("analysisSource", { length: 20 }),  // 'ai' | 'rules' | null (never analysed)
  analyzedAt: timestamp("analyzedAt"),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PosmItemRow = typeof posmItems.$inferSelect;
export type InsertPosmItem = typeof posmItems.$inferInsert;

// Per-channel free-of-charge entitlement rules, e.g. Wholesale: buy 1 MC →
// get 1 outer free; Retail: buy 3 outers → get 1 pack free. Units are
// 'mc' | 'outer' | 'pack' (1 outer = 10 packs; packs per MC come from the
// SKU weight — 1 MC = 6 KG). One row per (country, channel).
export const tradeFocRules = pgTable("trade_foc_rules", {
  id: serial("id").primaryKey(),
  country: varchar("country", { length: 50 }).notNull().default("Lebanon"),
  channel: varchar("channel", { length: 30 }).notNull(),  // retail | wholesale | semiWholesale | horeca
  entitled: boolean("entitled").notNull().default(false),
  buyQty: numeric("buyQty", { precision: 12, scale: 2 }),
  buyUnit: varchar("buyUnit", { length: 10 }),    // 'mc' | 'outer' | 'pack'
  freeQty: numeric("freeQty", { precision: 12, scale: 2 }),
  freeUnit: varchar("freeUnit", { length: 10 }),  // 'mc' | 'outer' | 'pack'
  notes: varchar("notes", { length: 400 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TradeFocRuleRow = typeof tradeFocRules.$inferSelect;
export type InsertTradeFocRule = typeof tradeFocRules.$inferInsert;

export const competitorData = pgTable("competitor_data", {
  id: serial("id").primaryKey(),
  country: varchar("country", { length: 50 }).notNull().default("Lebanon"),
  brandMonthly: json("brand_monthly"),
  brandMonthlyKg: json("brand_monthly_kg"),
  flavorYearly: json("flavor_yearly"),
  flavorYearlyKg: json("flavor_yearly_kg"),
  uploadedBy: varchar("uploaded_by", { length: 100 }),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});
export type CompetitorDataRow = typeof competitorData.$inferSelect;

// ── Country Performance board pack ──────────────────────────────────────────
// September 2026: frozen board packs, presenter notes, per-user slide layout
// and the saved version that acts as the approved annual plan.

export const boardPackSnapshots = pgTable("board_pack_snapshots", {
  id: serial("id").primaryKey(),
  country: varchar("country", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  windowLabel: varchar("windowLabel", { length: 100 }).notNull(),
  /** BoardHeadline JSON (see server/analysis/countryPerformance.types.ts). */
  headline: json("headline").notNull(),
  frozenBy: varchar("frozenBy", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BoardPackSnapshot = typeof boardPackSnapshots.$inferSelect;

export const presenterNotes = pgTable("presenter_notes", {
  id: serial("id").primaryKey(),
  country: varchar("country", { length: 50 }).notNull(),
  /** Period key the note belongs to, e.g. "ytd:2026-05" or "custom:2026-01:2026-05". */
  periodKey: varchar("periodKey", { length: 60 }).notNull(),
  sectionId: varchar("sectionId", { length: 60 }).notNull(),
  body: text("body").notNull(),
  author: varchar("author", { length: 100 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PresenterNote = typeof presenterNotes.$inferSelect;

export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull(),
  key: varchar("key", { length: 100 }).notNull(),
  value: json("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type UserPreference = typeof userPreferences.$inferSelect;

export const boardPlanBaselines = pgTable("board_plan_baselines", {
  id: serial("id").primaryKey(),
  country: varchar("country", { length: 50 }).notNull(),
  year: integer("year").notNull(),
  versionId: integer("versionId").notNull(),
  setBy: varchar("setBy", { length: 100 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type BoardPlanBaseline = typeof boardPlanBaselines.$inferSelect;
