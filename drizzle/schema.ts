import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, json, boolean, date } from "drizzle-orm/mysql-core";

// Country enum used across all tables
export const COUNTRIES = ["Lebanon", "Syria", "Libya"] as const;
export type Country = typeof COUNTRIES[number];

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// SKU master table - per country
export const skus = mysqlTable("skus", {
  id: int("id").autoincrement().primaryKey(),
  country: mysqlEnum("country", ["Lebanon", "Syria", "Libya"]).default("Lebanon").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  weight: varchar("weight", { length: 10 }).notNull(), // '50g', '250g', '1kg'
  category: mysqlEnum("category", ["Core", "NPI"]).default("Core").notNull(),
  packagingType: mysqlEnum("packagingType", ["Old", "New"]).default("New"), // Syria/Libya only
  sortOrder: int("sortOrder").notNull().default(0),
  isExcludedFromTotal: boolean("isExcludedFromTotal").default(false),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Sku = typeof skus.$inferSelect;
export type InsertSku = typeof skus.$inferInsert;

// Monthly periods reference - per country
export const periods = mysqlTable("periods", {
  id: int("id").autoincrement().primaryKey(),
  country: mysqlEnum("country", ["Lebanon", "Syria", "Libya"]).default("Lebanon").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(), // 1-12
  label: varchar("label", { length: 20 }).notNull(), // "Jan 25", "Feb 25", etc.
  sortOrder: int("sortOrder").notNull(),
});
export type Period = typeof periods.$inferSelect;

// Forecast data (monthly values per SKU) - country derived from SKU
export const forecastData = mysqlTable("forecast_data", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  value: decimal("value", { precision: 12, scale: 2 }).default("0"),
  // Syria/Libya: which production week this forecast cell maps to (week1..week4)
  targetWeek: varchar("targetWeek", { length: 10 }).default("week1"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ForecastData = typeof forecastData.$inferSelect;

// Revised forecast data for Syria/Libya (Forecast vs Forecast comparison)
export const revisedForecastData = mysqlTable("revised_forecast_data", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  value: decimal("value", { precision: 12, scale: 2 }).default("0"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RevisedForecastData = typeof revisedForecastData.$inferSelect;

// IMS (actual) data (monthly values per SKU)
export const imsData = mysqlTable("ims_data", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  value: decimal("value", { precision: 12, scale: 2 }).default("0"),
  isActual: boolean("isActual").default(false),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ImsData = typeof imsData.$inferSelect;

// Shipment (Production) data - weekly breakdown
export const shipmentData = mysqlTable("shipment_data", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  week1: decimal("week1", { precision: 12, scale: 2 }).default("0"),
  week2: decimal("week2", { precision: 12, scale: 2 }).default("0"),
  week3: decimal("week3", { precision: 12, scale: 2 }).default("0"),
  week4: decimal("week4", { precision: 12, scale: 2 }).default("0"),
  // Syria/Libya: arrival offset per production batch
  arrivalOffsetValue: int("arrivalOffsetValue").default(0),
  arrivalOffsetUnit: varchar("arrivalOffsetUnit", { length: 10 }).default("days"), // 'days' | 'weeks' | 'months'
  // Syria/Libya: manually set arrival status
  arrivalStatus: mysqlEnum("arrivalStatus", ["Pending", "In Transit", "Arrived", "Delayed", "Cleared", "Partially Cleared"]).default("Pending"),
  // Syria/Libya: quantity cleared through customs (can be partial, e.g. 7000 of 10000)
  clearedQty: decimal("clearedQty", { precision: 12, scale: 2 }),
  // Syria/Libya: date when shipment was cleared through customs
  clearedDate: date("clearedDate"),
  // Syria/Libya: expected/target date for pending clearance
  pendingClearDate: date("pendingClearDate"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ShipmentData = typeof shipmentData.$inferSelect;

// Arrival data - weekly breakdown, with optional arrival offset (weeks after production)
export const arrivalData = mysqlTable("arrival_data", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  week1: decimal("week1", { precision: 12, scale: 2 }).default("0"),
  week2: decimal("week2", { precision: 12, scale: 2 }).default("0"),
  week3: decimal("week3", { precision: 12, scale: 2 }).default("0"),
  week4: decimal("week4", { precision: 12, scale: 2 }).default("0"),
  arrivalOffsetWeeks: int("arrivalOffsetWeeks").default(0), // Syria/Libya: weeks after production batch
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ArrivalData = typeof arrivalData.$inferSelect;

// Planning FG data - per SKU per period
export const planningFgData = mysqlTable("planning_fg_data", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  openingStock: decimal("openingStock", { precision: 12, scale: 2 }).default("0"),
  adjustments: decimal("adjustments", { precision: 12, scale: 2 }).default("0"),
  invoiced: decimal("invoiced", { precision: 12, scale: 2 }).default("0"),
  arrivals: decimal("arrivals", { precision: 12, scale: 2 }).default("0"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PlanningFgData = typeof planningFgData.$inferSelect;

// Clearance events - multiple partial clearances per production batch (Syria/Libya)
export const clearanceEvents = mysqlTable("clearance_events", {
  id: int("id").autoincrement().primaryKey(),
  skuId: int("skuId").notNull(),
  periodId: int("periodId").notNull(),
  country: mysqlEnum("country", ["Lebanon", "Syria", "Libya"]).notNull(),
  clearedQty: decimal("clearedQty", { precision: 12, scale: 2 }).notNull(),
  clearedDate: date("clearedDate").notNull(),
  pendingClearDate: date("pendingClearDate"), // expected date for the NEXT tranche (if any)
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ClearanceEvent = typeof clearanceEvents.$inferSelect;
export type InsertClearanceEvent = typeof clearanceEvents.$inferInsert;

// Upload history
export const uploadHistory = mysqlTable("upload_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  country: mysqlEnum("country", ["Lebanon", "Syria", "Libya"]).default("Lebanon"),
  uploadType: varchar("uploadType", { length: 50 }).notNull(),
  fileName: varchar("fileName", { length: 255 }),
  recordsProcessed: int("recordsProcessed").default(0),
  status: varchar("status", { length: 20 }).default("pending"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UploadHistory = typeof uploadHistory.$inferSelect;

// SSOF Saved Versions - per country
export const ssofVersions = mysqlTable("ssof_versions", {
  id: int("id").autoincrement().primaryKey(),
  country: mysqlEnum("country", ["Lebanon", "Syria", "Libya"]).default("Lebanon").notNull(),
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
export const versionComments = mysqlTable("version_comments", {
  id: int("id").autoincrement().primaryKey(),
  versionId: int("versionId").notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type VersionComment = typeof versionComments.$inferSelect;
export type InsertVersionComment = typeof versionComments.$inferInsert;

// Audit trail - logs all data changes
export const auditTrail = mysqlTable("audit_trail", {
  id: int("id").autoincrement().primaryKey(),
  country: mysqlEnum("country", ["Lebanon", "Syria", "Libya"]).default("Lebanon"),
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
export const appUsers = mysqlTable("app_users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(), // always lowercase
  displayName: varchar("displayName", { length: 255 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "viewer"]).default("viewer").notNull(),
  countries: text("countries").notNull(), // JSON array: ["Lebanon","Syria"]
  isOwner: boolean("isOwner").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AppUserRow = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// User presence - tracks who is online and what page they are viewing
export const userPresence = mysqlTable("user_presence", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 100 }).notNull(),
  displayName: varchar("displayName", { length: 255 }).notNull(),
  country: varchar("country", { length: 50 }).notNull(),
  currentPage: varchar("currentPage", { length: 255 }).notNull().default("/"),
  lastSeen: timestamp("lastSeen").defaultNow().onUpdateNow().notNull(),
});
export type UserPresence = typeof userPresence.$inferSelect;
