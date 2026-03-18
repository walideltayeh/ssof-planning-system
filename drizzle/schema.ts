import { integer, pgEnum, pgTable, text, timestamp, varchar, numeric, json, boolean, date, serial } from "drizzle-orm/pg-core";

// Country enum used across all tables
export const COUNTRIES = ["Lebanon", "Syria", "Libya"] as const;
export type Country = typeof COUNTRIES[number];

export const countryEnum = pgEnum("country", ["Lebanon", "Syria", "Libya"]);
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

// Revised forecast data for Syria/Libya (Forecast vs Forecast comparison)
export const revisedForecastData = pgTable("revised_forecast_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).default("0"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type RevisedForecastData = typeof revisedForecastData.$inferSelect;

// IMS (actual) data (monthly values per SKU)
export const imsData = pgTable("ims_data", {
  id: serial("id").primaryKey(),
  skuId: integer("skuId").notNull(),
  periodId: integer("periodId").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).default("0"),
  isActual: boolean("isActual").default(false),
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
  isOwner: boolean("isOwner").default(false).notNull(),
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
