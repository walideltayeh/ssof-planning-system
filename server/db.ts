import { eq, and, asc, inArray, sql, desc, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InsertUser, users, skus, periods, forecastData, imsData, shipmentData, arrivalData, planningFgData, uploadHistory, auditTrail, ssofVersions, versionComments, revisedForecastData, clearanceEvents, appUsers } from "../drizzle/schema";
import type { AuditTrail, InsertAuditTrail, InsertSsofVersion, Country, ClearanceEvent, AppUserRow, InsertAppUser } from "../drizzle/schema";
import type { Sku, InsertSku, Period, ForecastData, ImsData, ShipmentData, ArrivalData, PlanningFgData, SsofVersion } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export async function getPool(): Promise<Pool | null> {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    _pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected error on idle client:', err);
    });
  }
  return _pool;
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = await getPool();
      if (pool) _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== PERIODS ====================
// ==================== COUNTRY-SCOPED HELPERS ====================
export async function ensurePeriodsForCountry(country: Country) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(periods).where(eq(periods.country, country));
  if (existing.length > 0) return existing;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodsToInsert = [];
  // Get max sortOrder across ALL countries to avoid collisions
  const allPeriods = await db.select().from(periods);
  const maxGlobal = allPeriods.length > 0 ? Math.max(...allPeriods.map(p => p.sortOrder)) : -1;
  let sortOrder = maxGlobal + 1;
  for (let year = 2025; year <= 2027; year++) {
    for (let month = 1; month <= 12; month++) {
      const shortYear = year.toString().slice(2);
      periodsToInsert.push({ country, year, month, label: `${monthNames[month - 1]} ${shortYear}`, sortOrder: sortOrder++ });
    }
  }
  await db.insert(periods).values(periodsToInsert);
  return db.select().from(periods).where(eq(periods.country, country)).orderBy(asc(periods.sortOrder));
}

export async function getPeriodsForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(periods).where(eq(periods.country, country)).orderBy(asc(periods.sortOrder));
}

export async function getSkusForCountry(country: Country, includeInactive = false) {
  const db = await getDb();
  if (!db) return [];
  const conditions = includeInactive
    ? eq(skus.country, country)
    : and(eq(skus.country, country), eq(skus.isActive, true));
  return db.select().from(skus).where(conditions).orderBy(asc(skus.sortOrder));
}

export async function createSkuForCountry(country: Country, data: { name: string; weight: string; category?: "Core" | "NPI"; packagingType?: "Old" | "New"; isExcludedFromTotal?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allSkus = await getSkusForCountry(country);
  const maxOrder = allSkus.length > 0 ? Math.max(...allSkus.map(s => s.sortOrder)) : 0;
  const [result] = await db.insert(skus).values({
    country,
    name: data.name,
    weight: data.weight,
    category: data.category || "Core",
    packagingType: data.packagingType || "New",
    sortOrder: maxOrder + 1,
    isExcludedFromTotal: data.isExcludedFromTotal || false,
  }).returning({ id: skus.id });
  // Initialize empty data for all periods of this country
  const allPeriods = await getPeriodsForCountry(country);
  if (allPeriods.length > 0) {
    const skuId = result.id;
    await db.insert(forecastData).values(allPeriods.map(p => ({ skuId, periodId: p.id, value: "0" })));
    await db.insert(imsData).values(allPeriods.map(p => ({ skuId, periodId: p.id, value: "0", isActual: false })));
    await db.insert(revisedForecastData).values(allPeriods.map(p => ({ skuId, periodId: p.id, value: "0" })));
    await db.insert(shipmentData).values(allPeriods.map(p => ({ skuId, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
    await db.insert(arrivalData).values(allPeriods.map(p => ({ skuId, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
    await db.insert(planningFgData).values(allPeriods.map(p => ({ skuId, periodId: p.id, openingStock: "0", adjustments: "0", invoiced: "0", arrivals: "0" })));
  }
  return result;
}

export async function updateSkuPackagingType(skuId: number, packagingType: "Old" | "New") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(skus).set({ packagingType }).where(eq(skus.id, skuId));
}

export async function getForecastDataForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  const countrySkus = await getSkusForCountry(country);
  const skuIds = countrySkus.map(s => s.id);
  if (skuIds.length === 0) return [];
  return db.select().from(forecastData).where(inArray(forecastData.skuId, skuIds)).orderBy(asc(forecastData.skuId), asc(forecastData.periodId));
}

export async function getRevisedForecastDataForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  const countrySkus = await getSkusForCountry(country);
  const skuIds = countrySkus.map(s => s.id);
  if (skuIds.length === 0) return [];
  return db.select().from(revisedForecastData).where(inArray(revisedForecastData.skuId, skuIds)).orderBy(asc(revisedForecastData.skuId), asc(revisedForecastData.periodId));
}

export async function upsertRevisedForecastData(skuId: number, periodId: number, value: string) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(revisedForecastData)
    .where(and(eq(revisedForecastData.skuId, skuId), eq(revisedForecastData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(revisedForecastData).set({ value }).where(eq(revisedForecastData.id, existing[0].id));
  } else {
    await db.insert(revisedForecastData).values({ skuId, periodId, value });
  }
}

export async function getImsDataForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  const countrySkus = await getSkusForCountry(country);
  const skuIds = countrySkus.map(s => s.id);
  if (skuIds.length === 0) return [];
  return db.select().from(imsData).where(inArray(imsData.skuId, skuIds)).orderBy(asc(imsData.skuId), asc(imsData.periodId));
}

export async function getShipmentDataForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  const countrySkus = await getSkusForCountry(country);
  const skuIds = countrySkus.map(s => s.id);
  if (skuIds.length === 0) return [];
  return db.select().from(shipmentData).where(inArray(shipmentData.skuId, skuIds)).orderBy(asc(shipmentData.skuId), asc(shipmentData.periodId));
}

export async function getArrivalDataForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  const countrySkus = await getSkusForCountry(country);
  const skuIds = countrySkus.map(s => s.id);
  if (skuIds.length === 0) return [];
  return db.select().from(arrivalData).where(inArray(arrivalData.skuId, skuIds)).orderBy(asc(arrivalData.skuId), asc(arrivalData.periodId));
}

export async function addYearForCountry(country: Country, year: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(periods).where(and(eq(periods.country, country), eq(periods.year, year)));
  if (existing.length > 0) throw new Error(`Year ${year} already exists for ${country}`);
  const allPeriods = await getPeriodsForCountry(country);
  const maxOrder = allPeriods.length > 0 ? Math.max(...allPeriods.map(p => p.sortOrder)) : -1;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortYear = year.toString().slice(2);
  const newPeriods = [];
  for (let month = 1; month <= 12; month++) {
    newPeriods.push({ country, year, month, label: `${monthNames[month - 1]} ${shortYear}`, sortOrder: maxOrder + month });
  }
  await db.insert(periods).values(newPeriods);
  const createdPeriods = await db.select().from(periods).where(and(eq(periods.country, country), eq(periods.year, year)));
  const allSkus = await getSkusForCountry(country);
  if (allSkus.length > 0 && createdPeriods.length > 0) {
    for (const sku of allSkus) {
      await db.insert(forecastData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "0" })));
      await db.insert(imsData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "0", isActual: false })));
      await db.insert(revisedForecastData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "0" })));
      await db.insert(shipmentData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
      await db.insert(arrivalData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
      await db.insert(planningFgData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, openingStock: "0", adjustments: "0", invoiced: "0", arrivals: "0" })));
    }
  }
  return createdPeriods;
}

export async function getExistingYearsForCountry(country: Country) {
  const db = await getDb();
  if (!db) return [];
  const allPeriods = await getPeriodsForCountry(country);
  const years = Array.from(new Set(allPeriods.map(p => p.year)));
  return years.sort();
}

export async function updateSkuDetails(skuId: number, data: { name?: string; weight?: string; category?: "Core" | "NPI"; packagingType?: "Old" | "New" }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.weight !== undefined) updates.weight = data.weight;
  if (data.category !== undefined) updates.category = data.category;
  if (data.packagingType !== undefined) updates.packagingType = data.packagingType;
  if (Object.keys(updates).length > 0) {
    await db.update(skus).set(updates).where(eq(skus.id, skuId));
  }
}

export async function ensurePeriods() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(periods).where(eq(periods.country, "Lebanon"));
  if (existing.length > 0) return existing;
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodsToInsert = [];
  let sortOrder = 0;
  for (let year = 2025; year <= 2027; year++) {
    for (let month = 1; month <= 12; month++) {
      const shortYear = year.toString().slice(2);
      periodsToInsert.push({
        year, month,
        label: `${monthNames[month - 1]} ${shortYear}`,
        sortOrder: sortOrder++,
      });
    }
  }
  await db.insert(periods).values(periodsToInsert);
  return db.select().from(periods).orderBy(asc(periods.sortOrder));
}

export async function getAllPeriods() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(periods).orderBy(asc(periods.sortOrder));
}

// ==================== SKUs ====================
export async function getAllSkus() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(skus).orderBy(asc(skus.sortOrder));
}

export async function createSku(data: { name: string; weight: string; category?: "Core" | "NPI"; isExcludedFromTotal?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allSkus = await getAllSkus();
  const maxOrder = allSkus.length > 0 ? Math.max(...allSkus.map(s => s.sortOrder)) : 0;
  const [result] = await db.insert(skus).values({
    name: data.name,
    weight: data.weight,
    category: data.category || "Core",
    sortOrder: maxOrder + 1,
    isExcludedFromTotal: data.isExcludedFromTotal || false,
  }).returning({ id: skus.id });
  
  // Initialize empty data for Lebanon periods only
  const allPeriods = await getPeriodsForCountry('Lebanon');
  if (allPeriods.length > 0) {
    const skuId = result.id;
    await db.insert(forecastData).values(allPeriods.map(p => ({ skuId, periodId: p.id, value: "0" })));
    await db.insert(imsData).values(allPeriods.map(p => ({ skuId, periodId: p.id, value: "0", isActual: false })));
    await db.insert(shipmentData).values(allPeriods.map(p => ({ skuId, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
    await db.insert(arrivalData).values(allPeriods.map(p => ({ skuId, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
    await db.insert(planningFgData).values(allPeriods.map(p => ({ skuId, periodId: p.id, openingStock: "0", adjustments: "0", invoiced: "0", arrivals: "0" })));
  }
  return result;
}

export async function updateSkuCategory(skuId: number, category: "Core" | "NPI") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(skus).set({ category }).where(eq(skus.id, skuId));
}

export async function toggleSkuActive(skuId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(skus).set({ isActive }).where(eq(skus.id, skuId));
}

export async function deleteSku(skuId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(forecastData).where(eq(forecastData.skuId, skuId));
  await db.delete(imsData).where(eq(imsData.skuId, skuId));
  await db.delete(shipmentData).where(eq(shipmentData.skuId, skuId));
  await db.delete(arrivalData).where(eq(arrivalData.skuId, skuId));
  await db.delete(planningFgData).where(eq(planningFgData.skuId, skuId));
  await db.delete(skus).where(eq(skus.id, skuId));
}

// ==================== FORECAST DATA ====================
export async function getForecastData() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(forecastData).orderBy(asc(forecastData.skuId), asc(forecastData.periodId));
}

export async function getForecastCellValue(skuId: number, periodId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(forecastData)
    .where(and(eq(forecastData.skuId, skuId), eq(forecastData.periodId, periodId))).limit(1);
  return rows[0] ?? null;
}

export async function getForecastValueForPeriod(skuId: number, periodId: number): Promise<string | null> {
  const dbConn = await getDb();
  if (!dbConn) return null;
  const rows = await dbConn.select().from(forecastData)
    .where(and(eq(forecastData.skuId, skuId), eq(forecastData.periodId, periodId))).limit(1);
  return rows[0]?.value ?? null;
}

export async function getImsValueForPeriod(skuId: number, periodId: number): Promise<string | null> {
  const dbConn = await getDb();
  if (!dbConn) return null;
  const rows = await dbConn.select().from(imsData)
    .where(and(eq(imsData.skuId, skuId), eq(imsData.periodId, periodId))).limit(1);
  return rows[0]?.value ?? null;
}

export async function upsertForecastData(skuId: number, periodId: number, value: string | undefined, targetWeek?: string) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(forecastData)
    .where(and(eq(forecastData.skuId, skuId), eq(forecastData.periodId, periodId))).limit(1);
  const setData: Record<string, string> = {};
  if (value !== undefined) setData.value = value;
  if (targetWeek) setData.targetWeek = targetWeek;
  if (existing.length > 0) {
    if (Object.keys(setData).length > 0) {
      await db.update(forecastData).set(setData).where(eq(forecastData.id, existing[0].id));
    }
  } else {
    await db.insert(forecastData).values({ skuId, periodId, value: value ?? "0", targetWeek: targetWeek ?? "week1" });
  }
}

// ==================== IMS DATA ====================
export async function getImsData() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(imsData).orderBy(asc(imsData.skuId), asc(imsData.periodId));
}

export async function upsertImsData(skuId: number, periodId: number, value: string, isActual: boolean) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(imsData)
    .where(and(eq(imsData.skuId, skuId), eq(imsData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(imsData).set({ value, isActual }).where(eq(imsData.id, existing[0].id));
  } else {
    await db.insert(imsData).values({ skuId, periodId, value, isActual });
  }
}

// ==================== SHIPMENT DATA ====================
export async function getShipmentData() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(shipmentData).orderBy(asc(shipmentData.skuId), asc(shipmentData.periodId));
}

export async function upsertShipmentData(
  skuId: number,
  periodId: number,
  data: { week1?: string; week2?: string; week3?: string; week4?: string; arrivalOffsetValue?: number; arrivalOffsetUnit?: string; note?: string | null; invoiceRef?: string | null; containerRef?: string | null }
) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(shipmentData).set(data).where(eq(shipmentData.id, existing[0].id));
  } else {
    await db.insert(shipmentData).values({ skuId, periodId, ...data });
  }
}

// Update only the arrivalStatus field for a shipment row (Syria/Libya)
export async function updateShipmentArrivalStatus(
  skuId: number,
  periodId: number,
  status: "Pending" | "In Transit" | "Arrived" | "Delayed" | "Cleared" | "Partially Cleared"
) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(shipmentData).set({ arrivalStatus: status }).where(eq(shipmentData.id, existing[0].id));
  } else {
    // Create the row with just the status
    await db.insert(shipmentData).values({ skuId, periodId, arrivalStatus: status });
  }
}

// Update clearedQty for a shipment row and auto-set status (Syria/Libya)
export async function updateShipmentClearedQty(
  skuId: number,
  periodId: number,
  clearedQty: number | null,
  totalQty: number
) {
  const db = await getDb();
  if (!db) return;
  // Auto-determine status based on cleared qty vs total
  let autoStatus: "Partially Cleared" | "Cleared" | null = null;
  if (clearedQty !== null && clearedQty > 0) {
    autoStatus = clearedQty >= totalQty ? "Cleared" : "Partially Cleared";
  }
  const updateData: Record<string, any> = {
    clearedQty: clearedQty !== null ? clearedQty.toString() : null,
  };
  if (autoStatus) updateData.arrivalStatus = autoStatus;
  const existing = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(shipmentData).set(updateData).where(eq(shipmentData.id, existing[0].id));
  } else {
    await db.insert(shipmentData).values({ skuId, periodId, clearedQty: clearedQty?.toString(), arrivalStatus: autoStatus ?? "Pending" });
  }
  return { autoStatus };
}

// Update clearedDate for a shipment row (Syria/Libya)
export async function updateShipmentClearedDate(
  skuId: number,
  periodId: number,
  clearedDateStr: string | null
) {
  const db = await getDb();
  if (!db) return;
  // Drizzle date column expects a string ("YYYY-MM-DD") or null
  const clearedDate = clearedDateStr ?? null;
  const existing = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(shipmentData).set({ clearedDate }).where(eq(shipmentData.id, existing[0].id));
  } else {
    await db.insert(shipmentData).values({ skuId, periodId, clearedDate: clearedDate ?? undefined });
  }
}

// ==================== CLEARANCE EVENTS ====================

export async function importClearanceEvent(ev: any): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(clearanceEvents).values({
    id: ev.id,
    skuId: ev.skuId,
    periodId: ev.periodId,
    country: ev.country as Country,
    clearedQty: ev.clearedQty,
    clearedDate: ev.clearedDate ? new Date(ev.clearedDate) as any : null,
    pendingClearDate: ev.pendingClearDate ? new Date(ev.pendingClearDate) as any : null,
    notes: ev.notes ?? null,
  }).onConflictDoNothing();
}

export async function getClearanceEventsForCountry(country: Country): Promise<ClearanceEvent[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clearanceEvents)
    .where(eq(clearanceEvents.country, country))
    .orderBy(asc(clearanceEvents.skuId), asc(clearanceEvents.periodId), asc(clearanceEvents.clearedDate));
}

export async function addClearanceEvent(data: {
  skuId: number;
  periodId: number;
  country: Country;
  clearedQty: string;
  clearedDate: string; // YYYY-MM-DD
  pendingClearDate?: string | null;
  notes?: string | null;
  invoiceRef?: string | null;
  containerRef?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(clearanceEvents).values({
    skuId: data.skuId,
    periodId: data.periodId,
    country: data.country,
    clearedQty: data.clearedQty,
    clearedDate: new Date(data.clearedDate) as any,
    pendingClearDate: data.pendingClearDate ? new Date(data.pendingClearDate) as any : null,
    notes: data.notes ?? null,
    invoiceRef: data.invoiceRef ?? null,
    containerRef: data.containerRef ?? null,
  }).returning({ id: clearanceEvents.id });
  // After adding event, sync shipmentData.clearedQty and status
  await syncShipmentClearedFromEvents(data.skuId, data.periodId, data.country);
  return result?.id ?? 0;
}

export async function deleteClearanceEvent(eventId: number, skuId: number, periodId: number, country: Country): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(clearanceEvents).where(eq(clearanceEvents.id, eventId));
  await syncShipmentClearedFromEvents(skuId, periodId, country);
}

export async function updateClearanceEvent(eventId: number, data: {
  clearedQty?: string;
  clearedDate?: string;
  pendingClearDate?: string | null;
  notes?: string | null;
  invoiceRef?: string | null;
  containerRef?: string | null;
  skuId: number;
  periodId: number;
  country: Country;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, any> = {};
  if (data.clearedQty !== undefined) updateData.clearedQty = data.clearedQty;
  if (data.clearedDate !== undefined) updateData.clearedDate = new Date(data.clearedDate);
  if (data.pendingClearDate !== undefined) updateData.pendingClearDate = data.pendingClearDate ? new Date(data.pendingClearDate) : null;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.invoiceRef !== undefined) updateData.invoiceRef = data.invoiceRef;
  if (data.containerRef !== undefined) updateData.containerRef = data.containerRef;
  if (Object.keys(updateData).length > 0) {
    await db.update(clearanceEvents).set(updateData).where(eq(clearanceEvents.id, eventId));
  }
  await syncShipmentClearedFromEvents(data.skuId, data.periodId, data.country);
}

// Sync shipmentData.clearedQty + arrivalStatus from sum of clearance events
async function syncShipmentClearedFromEvents(skuId: number, periodId: number, country: Country): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const events = await db.select().from(clearanceEvents)
    .where(and(eq(clearanceEvents.skuId, skuId), eq(clearanceEvents.periodId, periodId), eq(clearanceEvents.country, country)));
  const totalCleared = events.reduce((s, e) => s + parseFloat(e.clearedQty ?? "0"), 0);
  // Get production total to determine status
  const shipRow = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))).limit(1);
  const productionTotal = shipRow.length > 0
    ? (parseFloat(shipRow[0].week1 ?? "0") + parseFloat(shipRow[0].week2 ?? "0") + parseFloat(shipRow[0].week3 ?? "0") + parseFloat(shipRow[0].week4 ?? "0"))
    : 0;
  let newStatus: string;
  if (totalCleared <= 0) {
    newStatus = shipRow[0]?.arrivalStatus ?? "Pending"; // keep existing if no clearances
    if (["Cleared", "Partially Cleared"].includes(newStatus)) newStatus = "Arrived";
  } else if (productionTotal > 0 && totalCleared >= productionTotal) {
    newStatus = "Cleared";
  } else {
    newStatus = "Partially Cleared";
  }
  const clearedQtyStr = totalCleared > 0 ? totalCleared.toString() : null;
  if (shipRow.length > 0) {
    await db.update(shipmentData).set({ clearedQty: clearedQtyStr as any, arrivalStatus: newStatus as any }).where(eq(shipmentData.id, shipRow[0].id));
  } else {
    await db.insert(shipmentData).values({ skuId, periodId, clearedQty: clearedQtyStr as any, arrivalStatus: newStatus as any });
  }
}

// Update pendingClearDate for a shipment row (Syria/Libya)
export async function updateShipmentPendingClearDate(
  skuId: number,
  periodId: number,
  pendingClearDateStr: string | null
) {
  const db = await getDb();
  if (!db) return;
  const pendingClearDate = pendingClearDateStr ?? null;
  const existing = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(shipmentData).set({ pendingClearDate }).where(eq(shipmentData.id, existing[0].id));
  } else {
    await db.insert(shipmentData).values({ skuId, periodId, pendingClearDate: pendingClearDate ?? undefined });
  }
}

// ==================== ARRIVAL DATA ====================
export async function getArrivalData() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(arrivalData).orderBy(asc(arrivalData.skuId), asc(arrivalData.periodId));
}

export async function upsertArrivalData(skuId: number, periodId: number, data: { week1?: string; week2?: string; week3?: string; week4?: string }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(arrivalData)
    .where(and(eq(arrivalData.skuId, skuId), eq(arrivalData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(arrivalData).set(data).where(eq(arrivalData.id, existing[0].id));
  } else {
    await db.insert(arrivalData).values({ skuId, periodId, ...data });
  }
}

// ==================== PLANNING FG DATA ====================
export async function getPlanningFgData() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(planningFgData).orderBy(asc(planningFgData.skuId), asc(planningFgData.periodId));
}

export async function upsertPlanningFgData(skuId: number, periodId: number, data: { openingStock?: string; adjustments?: string; invoiced?: string; arrivals?: string }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(planningFgData)
    .where(and(eq(planningFgData.skuId, skuId), eq(planningFgData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(planningFgData).set(data).where(eq(planningFgData.id, existing[0].id));
  } else {
    await db.insert(planningFgData).values({ skuId, periodId, ...data });
  }
}

// ==================== BULK OPERATIONS ====================
export async function bulkUpsertForecast(records: { skuId: number; periodId: number; value: string }[]) {
  const pool = await getPool();
  if (!pool || records.length === 0) return;
  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const values = batch.map((r, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`).join(",");
    const params = batch.flatMap(r => [r.skuId, r.periodId, r.value]);
    await pool.query(`INSERT INTO forecast_data ("skuId", "periodId", value) VALUES ${values} ON CONFLICT ("skuId", "periodId") DO UPDATE SET value = EXCLUDED.value`, params);
  }
}

export async function bulkUpsertIms(records: { skuId: number; periodId: number; value: string; isActual: boolean }[]) {
  const pool = await getPool();
  if (!pool || records.length === 0) return;
  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const values = batch.map((r, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`).join(",");
    const params = batch.flatMap(r => [r.skuId, r.periodId, r.value, r.isActual]);
    await pool.query(`INSERT INTO ims_data ("skuId", "periodId", value, "isActual") VALUES ${values} ON CONFLICT ("skuId", "periodId") DO UPDATE SET value = EXCLUDED.value, "isActual" = EXCLUDED."isActual"`, params);
  }
}

export async function bulkUpsertShipment(records: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[]) {
  const pool = await getPool();
  if (!pool || records.length === 0) return;
  const batchSize = 200;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const values = batch.map((r, idx) => `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`).join(",");
    const params = batch.flatMap(r => [r.skuId, r.periodId, r.week1, r.week2, r.week3, r.week4]);
    await pool.query(`INSERT INTO shipment_data ("skuId", "periodId", week1, week2, week3, week4) VALUES ${values} ON CONFLICT ("skuId", "periodId") DO UPDATE SET week1 = EXCLUDED.week1, week2 = EXCLUDED.week2, week3 = EXCLUDED.week3, week4 = EXCLUDED.week4`, params);
  }
}

export async function bulkUpsertArrival(records: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[]) {
  const pool = await getPool();
  if (!pool || records.length === 0) return;
  const batchSize = 200;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const values = batch.map((r, idx) => `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`).join(",");
    const params = batch.flatMap(r => [r.skuId, r.periodId, r.week1, r.week2, r.week3, r.week4]);
    await pool.query(`INSERT INTO arrival_data ("skuId", "periodId", week1, week2, week3, week4) VALUES ${values} ON CONFLICT ("skuId", "periodId") DO UPDATE SET week1 = EXCLUDED.week1, week2 = EXCLUDED.week2, week3 = EXCLUDED.week3, week4 = EXCLUDED.week4`, params);
  }
}

export async function bulkUpsertPlanningFg(records: { skuId: number; periodId: number; openingStock?: string; adjustments?: string; invoiced?: string; arrivals?: string }[]) {
  const pool = await getPool();
  if (!pool || records.length === 0) return;
  const batchSize = 200;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const values = batch.map((r, idx) => `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`).join(",");
    const params = batch.flatMap(r => [r.skuId, r.periodId, r.openingStock || "0", r.adjustments || "0", r.invoiced || "0", r.arrivals || "0"]);
    await pool.query(`INSERT INTO planning_fg_data ("skuId", "periodId", "openingStock", adjustments, invoiced, arrivals) VALUES ${values} ON CONFLICT ("skuId", "periodId") DO UPDATE SET "openingStock" = EXCLUDED."openingStock", adjustments = EXCLUDED.adjustments, invoiced = EXCLUDED.invoiced, arrivals = EXCLUDED.arrivals`, params);
  }
}

export async function ensureDataIndexes() {
  const pool = await getPool();
  if (!pool) return;
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS forecast_data_sku_period_idx ON forecast_data ("skuId", "periodId")`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ims_data_sku_period_idx ON ims_data ("skuId", "periodId")`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS shipment_data_sku_period_idx ON shipment_data ("skuId", "periodId")`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS arrival_data_sku_period_idx ON arrival_data ("skuId", "periodId")`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS planning_fg_data_sku_period_idx ON planning_fg_data ("skuId", "periodId")`);
  } catch (err) {
    console.warn("[DB] Failed to create indexes (may already exist):", err);
  }
}

// ==================== ADD YEAR ====================
export async function addYear(year: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if year already exists
  const existing = await db.select().from(periods).where(eq(periods.year, year));
  if (existing.length > 0) throw new Error(`Year ${year} already exists`);
  
  // Get max sort order
  const allPeriods = await getAllPeriods();
  const maxOrder = allPeriods.length > 0 ? Math.max(...allPeriods.map(p => p.sortOrder)) : -1;
  
  // Create 12 periods for the new year
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortYear = year.toString().slice(2);
  const newPeriods = [];
  for (let month = 1; month <= 12; month++) {
    newPeriods.push({
      year,
      month,
      label: `${monthNames[month - 1]} ${shortYear}`,
      sortOrder: maxOrder + month,
    });
  }
  await db.insert(periods).values(newPeriods);
  
  // Get the newly created period IDs
  const createdPeriods = await db.select().from(periods).where(eq(periods.year, year));
  
  // Initialize data for all existing SKUs
  const allSkus = await getAllSkus();
  if (allSkus.length > 0 && createdPeriods.length > 0) {
    for (const sku of allSkus) {
      await db.insert(forecastData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "0" })));
      await db.insert(imsData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "0", isActual: false })));
      await db.insert(shipmentData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
      await db.insert(arrivalData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0" })));
      await db.insert(planningFgData).values(createdPeriods.map(p => ({ skuId: sku.id, periodId: p.id, openingStock: "0", adjustments: "0", invoiced: "0", arrivals: "0" })));
    }
  }
  
  return createdPeriods;
}

export async function getExistingYears() {
  const db = await getDb();
  if (!db) return [];
  const allPeriods = await getAllPeriods();
  const years = Array.from(new Set(allPeriods.map(p => p.year)));
  return years.sort();
}

export async function getExistingYearsForFilter(country?: Country) {
  if (country) return getExistingYearsForCountry(country);
  return getExistingYears();
}

// ==================== UPLOAD HISTORY ====================
export async function createUploadRecord(data: { userId?: number; uploadType: string; fileName?: string }) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(uploadHistory).values({
    userId: data.userId,
    uploadType: data.uploadType,
    fileName: data.fileName,
    status: "processing",
  }).returning({ id: uploadHistory.id });
  return result;
}

export async function updateUploadRecord(id: number, data: { status: string; recordsProcessed?: number; errorMessage?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(uploadHistory).set(data).where(eq(uploadHistory.id, id));
}

export async function getUploadHistory() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(uploadHistory).orderBy(desc(uploadHistory.createdAt)).limit(20);
}

// ==================== AUDIT TRAIL ====================
export async function logAudit(entry: Omit<InsertAuditTrail, 'id' | 'createdAt'>) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(auditTrail).values(entry);
  } catch (error) {
    console.error('[Audit] Failed to log:', error);
  }
}

export async function getAuditLogs(opts?: { limit?: number; offset?: number; username?: string; action?: string; sheet?: string }) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;

  let conditions: any[] = [];
  if (opts?.username) conditions.push(eq(auditTrail.username, opts.username));
  if (opts?.action) conditions.push(eq(auditTrail.action, opts.action));
  if (opts?.sheet) conditions.push(eq(auditTrail.sheet, opts.sheet));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db.select().from(auditTrail)
    .where(whereClause)
    .orderBy(desc(auditTrail.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db.select({ count: sql<number>`count(*)` }).from(auditTrail).where(whereClause);
  const total = Number(countResult[0]?.count || 0);

  return { logs, total };
}

// ==================== COMPUTED DATA ====================
export async function getFullPlanningData(weightFilter?: string) {
  const db = await getDb();
  if (!db) return { skus: [], periods: [], forecast: [], ims: [], shipment: [], arrival: [], planningFg: [] };
  
  let skuList = await getSkusForCountry('Lebanon');
  if (weightFilter) {
    skuList = skuList.filter(s => s.weight === weightFilter);
  }
  const skuIds = skuList.map(s => s.id);
  if (skuIds.length === 0) return { skus: skuList, periods: await getPeriodsForCountry('Lebanon'), forecast: [], ims: [], shipment: [], arrival: [], planningFg: [] };
  
  const periodList = await getPeriodsForCountry('Lebanon');
  const forecast = await db.select().from(forecastData).where(inArray(forecastData.skuId, skuIds));
  const ims = await db.select().from(imsData).where(inArray(imsData.skuId, skuIds));
  const shipment = await db.select().from(shipmentData).where(inArray(shipmentData.skuId, skuIds));
  const arrival = await db.select().from(arrivalData).where(inArray(arrivalData.skuId, skuIds));
  const planning = await db.select().from(planningFgData).where(inArray(planningFgData.skuId, skuIds));
  
  return { skus: skuList, periods: periodList, forecast, ims, shipment, arrival, planningFg: planning };
}

// ==================== SSOF VERSIONS ====================

export async function getFullSnapshot(country?: Country) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // If country is specified, only snapshot data for that country's SKUs
  let countrySkuIds: number[] | null = null;
  let countryPeriodIds: number[] | null = null;
  
  if (country) {
    const countrySkus = await getSkusForCountry(country, true);
    countrySkuIds = countrySkus.map(s => s.id);
    const countryPeriods = await getPeriodsForCountry(country);
    countryPeriodIds = countryPeriods.map(p => p.id);
  }
  
  const allSkus = await db.select().from(skus).orderBy(asc(skus.sortOrder));
  const allPeriods = await db.select().from(periods).orderBy(asc(periods.sortOrder));
  const allForecast = await db.select().from(forecastData);
  const allIms = await db.select().from(imsData);
  const allShipment = await db.select().from(shipmentData);
  const allArrival = await db.select().from(arrivalData);
  const allPlanning = await db.select().from(planningFgData);
  
  if (countrySkuIds && countryPeriodIds) {
    const skuSet = new Set(countrySkuIds);
    const periodSet = new Set(countryPeriodIds);
    return {
      skus: allSkus.filter(s => skuSet.has(s.id)),
      periods: allPeriods.filter(p => periodSet.has(p.id)),
      forecast: allForecast.filter(f => skuSet.has(f.skuId) && periodSet.has(f.periodId)),
      ims: allIms.filter(i => skuSet.has(i.skuId) && periodSet.has(i.periodId)),
      shipment: allShipment.filter(s => skuSet.has(s.skuId) && periodSet.has(s.periodId)),
      arrival: allArrival.filter(a => skuSet.has(a.skuId) && periodSet.has(a.periodId)),
      planningFg: allPlanning.filter(p => skuSet.has(p.skuId) && periodSet.has(p.periodId)),
    };
  }
  
  return {
    skus: allSkus,
    periods: allPeriods,
    forecast: allForecast,
    ims: allIms,
    shipment: allShipment,
    arrival: allArrival,
    planningFg: allPlanning,
  };
}

export async function saveVersion(data: { name: string; description?: string; savedBy: string; snapshotData: any; changesSummary?: any; docUrl?: string; country?: Country }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(ssofVersions).values({
    name: data.name,
    description: data.description || null,
    savedBy: data.savedBy,
    snapshotData: data.snapshotData,
    changesSummary: data.changesSummary || null,
    docUrl: data.docUrl || null,
    country: data.country || 'Lebanon',
  }).returning({ id: ssofVersions.id });
  return result;
}

export async function listVersions(country?: Country) {
  const db = await getDb();
  if (!db) return [];
  // Return without snapshotData to keep it lightweight
  const q = db.select({
    id: ssofVersions.id,
    country: ssofVersions.country,
    name: ssofVersions.name,
    description: ssofVersions.description,
    savedBy: ssofVersions.savedBy,
    docUrl: ssofVersions.docUrl,
    createdAt: ssofVersions.createdAt,
  }).from(ssofVersions);
  if (country) {
    return q.where(eq(ssofVersions.country, country)).orderBy(desc(ssofVersions.createdAt));
  }
  return q.orderBy(desc(ssofVersions.createdAt));
}

export async function getVersionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(ssofVersions).where(eq(ssofVersions.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deleteVersion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(ssofVersions).where(eq(ssofVersions.id, id));
}

export async function restoreSnapshot(snapshot: any, country?: Country) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (country) {
    // Country-scoped restore: only delete and restore data for this country's SKUs/periods
    const countrySkus = await getSkusForCountry(country, true);
    const countryPeriods = await getPeriodsForCountry(country);
    const skuIds = countrySkus.map(s => s.id);
    const periodIds = countryPeriods.map(p => p.id);
    
    // Delete existing data for this country's SKUs
    if (skuIds.length > 0) {
      for (const chunk of chunkArray(skuIds, 100)) {
        await db.delete(forecastData).where(inArray(forecastData.skuId, chunk));
        await db.delete(imsData).where(inArray(imsData.skuId, chunk));
        await db.delete(shipmentData).where(inArray(shipmentData.skuId, chunk));
        await db.delete(arrivalData).where(inArray(arrivalData.skuId, chunk));
        await db.delete(planningFgData).where(inArray(planningFgData.skuId, chunk));
        await db.delete(skus).where(inArray(skus.id, chunk));
      }
    }
    // Delete country periods
    if (periodIds.length > 0) {
      for (const chunk of chunkArray(periodIds, 100)) {
        await db.delete(periods).where(inArray(periods.id, chunk));
      }
    }
  } else {
    // Global restore: clear everything
    await db.delete(forecastData);
    await db.delete(imsData);
    await db.delete(shipmentData);
    await db.delete(arrivalData);
    await db.delete(planningFgData);
    await db.delete(skus);
    await db.delete(periods);
  }
  
  // Restore periods (include country field!)
  if (snapshot.periods?.length > 0) {
    const chunks = chunkArray(snapshot.periods, 500);
    for (const chunk of chunks) {
      await db.insert(periods).values(chunk.map((p: any) => ({
        id: p.id,
        country: p.country ?? country ?? 'Lebanon',
        year: p.year,
        month: p.month,
        label: p.label,
        sortOrder: p.sortOrder,
      })));
    }
  }
  
  // Restore SKUs (include ALL fields: country, packagingType, isActive, etc.)
  if (snapshot.skus?.length > 0) {
    const chunks = chunkArray(snapshot.skus, 500);
    for (const chunk of chunks) {
      await db.insert(skus).values(chunk.map((s: any) => ({
        id: s.id,
        country: s.country ?? country ?? 'Lebanon',
        name: s.name,
        weight: s.weight,
        category: s.category ?? 'Core',
        packagingType: s.packagingType ?? 'New',
        sortOrder: s.sortOrder ?? 0,
        isExcludedFromTotal: s.isExcludedFromTotal ?? false,
        isActive: s.isActive ?? true,
      })));
    }
  }
  
  // Restore forecast data
  if (snapshot.forecast?.length > 0) {
    const chunks = chunkArray(snapshot.forecast, 500);
    for (const chunk of chunks) {
      await db.insert(forecastData).values(chunk.map((d: any) => ({
        skuId: d.skuId, periodId: d.periodId, value: d.value ?? "0",
      })));
    }
  }
  
  // Restore IMS data
  if (snapshot.ims?.length > 0) {
    const chunks = chunkArray(snapshot.ims, 500);
    for (const chunk of chunks) {
      await db.insert(imsData).values(chunk.map((d: any) => ({
        skuId: d.skuId, periodId: d.periodId, value: d.value ?? "0", isActual: d.isActual ?? false,
      })));
    }
  }
  
  // Restore shipment data (include ALL fields: arrivalOffsetValue, arrivalStatus, clearedQty, etc.)
  if (snapshot.shipment?.length > 0) {
    const chunks = chunkArray(snapshot.shipment, 500);
    for (const chunk of chunks) {
      await db.insert(shipmentData).values(chunk.map((d: any) => ({
        skuId: d.skuId, periodId: d.periodId,
        week1: d.week1 ?? "0", week2: d.week2 ?? "0", week3: d.week3 ?? "0", week4: d.week4 ?? "0",
        arrivalOffsetValue: d.arrivalOffsetValue ?? 0,
        arrivalOffsetUnit: d.arrivalOffsetUnit ?? 'days',
        arrivalStatus: d.arrivalStatus ?? 'Pending',
        clearedQty: d.clearedQty ?? null,
        clearedDate: d.clearedDate ?? null,
        pendingClearDate: d.pendingClearDate ?? null,
        note: d.note ?? null,
        invoiceRef: d.invoiceRef ?? null,
        containerRef: d.containerRef ?? null,
      })));
    }
  }
  
  // Restore arrival data (include arrivalOffsetWeeks)
  if (snapshot.arrival?.length > 0) {
    const chunks = chunkArray(snapshot.arrival, 500);
    for (const chunk of chunks) {
      await db.insert(arrivalData).values(chunk.map((d: any) => ({
        skuId: d.skuId, periodId: d.periodId,
        week1: d.week1 ?? "0", week2: d.week2 ?? "0", week3: d.week3 ?? "0", week4: d.week4 ?? "0",
        arrivalOffsetWeeks: d.arrivalOffsetWeeks ?? 0,
      })));
    }
  }
  
  // Restore planning FG data
  if (snapshot.planningFg?.length > 0) {
    const chunks = chunkArray(snapshot.planningFg, 500);
    for (const chunk of chunks) {
      await db.insert(planningFgData).values(chunk.map((d: any) => ({
        skuId: d.skuId, periodId: d.periodId,
        openingStock: d.openingStock ?? "0", adjustments: d.adjustments ?? "0",
        invoiced: d.invoiced ?? "0", arrivals: d.arrivals ?? "0",
      })));
    }
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ==================== VERSION COMMENTS ====================

export async function getVersionComments(versionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(versionComments).where(eq(versionComments.versionId, versionId)).orderBy(desc(versionComments.createdAt));
}

export async function addVersionComment(data: { versionId: number; username: string; comment: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(versionComments).values({
    versionId: data.versionId,
    username: data.username,
    comment: data.comment,
  }).returning({ id: versionComments.id });
  return { id: result.id };
}

export async function deleteVersionComment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(versionComments).where(eq(versionComments.id, id));
}

// ==================== EDIT COUNTER (for auto-save reminders) ====================

export async function getEditCountSinceVersion(country?: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  // Get the latest version's createdAt
  const latestVersions = await db.select({ createdAt: ssofVersions.createdAt })
    .from(ssofVersions)
    .orderBy(desc(ssofVersions.createdAt))
    .limit(1);
  const since = latestVersions.length > 0 ? latestVersions[0].createdAt : new Date(0);
  // Count edit_cell actions since then, optionally filtered by country
  const conditions = [
    gt(auditTrail.createdAt, since),
    eq(auditTrail.action, 'edit_cell'),
    ...(country ? [eq(auditTrail.country, country as 'Lebanon' | 'Syria' | 'Libya')] : []),
  ];
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(auditTrail)
    .where(and(...conditions));
  return Number(result[0]?.count ?? 0);
}


// ==================== ANALYSIS QUERIES ====================

/** Overview: total SKUs, total forecast, total production, total arrival, avg weeks of stock */
export async function getAnalysisOverview() {
  const db = await getDb();
  if (!db) return { totalSkus: 0, totalForecast: 0, totalProduction: 0, totalArrival: 0, avgWeeksOfStock: 0, monthlyTrend: [] };

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allForecast = await db.select().from(forecastData);
  const allShipment = await db.select().from(shipmentData);
  const allArrival = await db.select().from(arrivalData);
  const allPlanningFg = await db.select().from(planningFgData);

  const totalForecast = allForecast.reduce((s, d) => s + (parseFloat(d.value ?? "0") || 0), 0);
  const totalProduction = allShipment.reduce((s, d) => {
    return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
  }, 0);
  const totalArrival = allArrival.reduce((s, d) => {
    return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
  }, 0);

  // Monthly trend: forecast + production per month
  const monthlyTrend = allPeriods.map(p => {
    const fVal = allForecast.filter(f => f.periodId === p.id).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
    const pVal = allShipment.filter(s => s.periodId === p.id).reduce((s, d) => {
      return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    }, 0);
    const aVal = allArrival.filter(a => a.periodId === p.id).reduce((s, d) => {
      return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    }, 0);
    return { period: p.label, year: p.year, month: p.month, forecast: fVal, production: pVal, arrival: aVal };
  });

  // Compute closing stock weeks server-side (same formula as frontend)
  const allImsForWeeks = await db.select().from(imsData);
  const imsLookup = new Map<string, number>();
  for (const d of allImsForWeeks) imsLookup.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
  const forecastLookup = new Map<string, number>();
  for (const d of allForecast) forecastLookup.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const getEffIms = (skuId: number, periodId: number) => {
    const v = imsLookup.get(`${skuId}-${periodId}`) ?? 0;
    if (v !== 0) return v;
    const per = allPeriods.find(p => p.id === periodId);
    if (per && (per.year > curYear || (per.year === curYear && per.month > curMonth))) {
      return forecastLookup.get(`${skuId}-${periodId}`) ?? 0;
    }
    return 0;
  };
  const weeksVals: number[] = [];
  for (const sku of allSkusList) {
    let prevCS = 0;
    for (let i = 0; i < allPeriods.length; i++) {
      const p = allPeriods[i];
      const pf = allPlanningFg.find(d => d.skuId === sku.id && d.periodId === p.id);
      const ims = getEffIms(sku.id, p.id);
      const opening = i === 0 ? (parseFloat(pf?.openingStock ?? "0") || 0) : prevCS;
      const adj = parseFloat(pf?.adjustments ?? "0") || 0;
      const arr = parseFloat(pf?.arrivals ?? "0") || 0;
      const cs = opening + adj + arr - ims;
      if (cs !== 0) {
        const n1 = i + 1 < allPeriods.length ? getEffIms(sku.id, allPeriods[i + 1].id) : 0;
        const n2 = i + 2 < allPeriods.length ? getEffIms(sku.id, allPeriods[i + 2].id) : 0;
        const avg = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
        if (avg !== 0) weeksVals.push((cs / avg) * 4.3);
      }
      prevCS = cs;
    }
  }
  const avgWeeksOfStock = weeksVals.length > 0 ? weeksVals.reduce((a, b) => a + b, 0) / weeksVals.length : 0;

  return {
    totalSkus: allSkusList.length,
    totalForecast: Math.round(totalForecast),
    totalProduction: Math.round(totalProduction),
    totalArrival: Math.round(totalArrival),
    avgWeeksOfStock: Math.round(avgWeeksOfStock * 10) / 10,
    monthlyTrend,
  };
}

/** By SKU: per-SKU totals for forecast, production, arrival */
export async function getAnalysisBySku() {
  const db = await getDb();
  if (!db) return [];

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allForecast = await db.select().from(forecastData);
  const allShipment = await db.select().from(shipmentData);
  const allIms = await db.select().from(imsData);
  const allPlanningFg = await db.select().from(planningFgData);
  const nowB = new Date();
  const curYr = nowB.getFullYear();
  const curMo = nowB.getMonth() + 1;

  return allSkusList.map(sku => {
    const fTotal = allForecast.filter(f => f.skuId === sku.id).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
    const pTotal = allShipment.filter(s => s.skuId === sku.id).reduce((s, d) => {
      return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    }, 0);
    const imsTotal = allIms.filter(i => i.skuId === sku.id).reduce((s, i) => s + (parseFloat(i.value ?? "0") || 0), 0);

    // Monthly breakdown
    const monthly = allPeriods.map(p => {
      const f = allForecast.find(f => f.skuId === sku.id && f.periodId === p.id);
      const i = allIms.find(i => i.skuId === sku.id && i.periodId === p.id);
      return {
        period: p.label,
        forecast: parseFloat(f?.value ?? "0") || 0,
        ims: parseFloat(i?.value ?? "0") || 0,
      };
    });

    // Compute avg weeks of stock server-side
    let avgWeeks = 0;
    {
      let prevCS = 0;
      const wkVals: number[] = [];
      for (let i = 0; i < allPeriods.length; i++) {
        const p = allPeriods[i];
        const pf = allPlanningFg.find(d => d.skuId === sku.id && d.periodId === p.id);
        const imsVal = parseFloat(allIms.find(d => d.skuId === sku.id && d.periodId === p.id)?.value ?? "0") || 0;
        const effIms = imsVal !== 0 ? imsVal : (() => {
          if (p.year > curYr || (p.year === curYr && p.month > curMo)) return parseFloat(allForecast.find(f => f.skuId === sku.id && f.periodId === p.id)?.value ?? "0") || 0;
          return 0;
        })();
        const opening = i === 0 ? (parseFloat(pf?.openingStock ?? "0") || 0) : prevCS;
        const adj = parseFloat(pf?.adjustments ?? "0") || 0;
        const arr = parseFloat(pf?.arrivals ?? "0") || 0;
        const cs = opening + adj + arr - effIms;
        if (cs !== 0) {
          const getEffImsLocal = (idx: number) => {
            if (idx >= allPeriods.length) return 0;
            const pp = allPeriods[idx];
            const iv = parseFloat(allIms.find(d => d.skuId === sku.id && d.periodId === pp.id)?.value ?? "0") || 0;
            if (iv !== 0) return iv;
            if (pp.year > curYr || (pp.year === curYr && pp.month > curMo)) return parseFloat(allForecast.find(f => f.skuId === sku.id && f.periodId === pp.id)?.value ?? "0") || 0;
            return 0;
          };
          const n1 = getEffImsLocal(i + 1);
          const n2 = getEffImsLocal(i + 2);
          const avgN = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
          if (avgN !== 0) wkVals.push((cs / avgN) * 4.3);
        }
        prevCS = cs;
      }
      avgWeeks = wkVals.length > 0 ? wkVals.reduce((a, b) => a + b, 0) / wkVals.length : 0;
    }

    // Forecast accuracy: how close IMS is to Forecast
    const accuracyPeriods = allPeriods.filter(p => {
      const f = allForecast.find(f => f.skuId === sku.id && f.periodId === p.id);
      const i = allIms.find(i => i.skuId === sku.id && i.periodId === p.id);
      return f && i && parseFloat(f.value ?? "0") > 0;
    });
    const accuracy = accuracyPeriods.length > 0
      ? accuracyPeriods.reduce((s, p) => {
          const fv = parseFloat(allForecast.find(f => f.skuId === sku.id && f.periodId === p.id)?.value ?? "0");
          const iv = parseFloat(allIms.find(i => i.skuId === sku.id && i.periodId === p.id)?.value ?? "0");
          return s + (fv > 0 ? Math.min(iv / fv, 2) : 0);
        }, 0) / accuracyPeriods.length * 100
      : 0;

    return {
      id: sku.id,
      name: sku.name,
      weight: sku.weight,
      category: sku.category,
      totalForecast: Math.round(fTotal),
      totalProduction: Math.round(pTotal),
      totalIms: Math.round(imsTotal),
      avgWeeksOfStock: Math.round(avgWeeks * 10) / 10,
      forecastAccuracy: Math.round(accuracy),
      monthly,
    };
  });
}

/** By Weight: aggregate by weight category */
export async function getAnalysisByWeight() {
  const db = await getDb();
  if (!db) return [];

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allForecast = await db.select().from(forecastData);
  const allShipment = await db.select().from(shipmentData);
  const allIms = await db.select().from(imsData);

  const weights = Array.from(new Set(allSkusList.map(s => s.weight))).sort();

  return weights.map(weight => {
    const weightSkus = allSkusList.filter(s => s.weight === weight);
    const skuIds = new Set(weightSkus.map(s => s.id));

    const fTotal = allForecast.filter(f => skuIds.has(f.skuId)).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
    const pTotal = allShipment.filter(s => skuIds.has(s.skuId)).reduce((s, d) => {
      return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    }, 0);
    const iTotal = allIms.filter(i => skuIds.has(i.skuId)).reduce((s, i) => s + (parseFloat(i.value ?? "0") || 0), 0);

    // Monthly trend per weight
    const monthly = allPeriods.map(p => {
      const fVal = allForecast.filter(f => skuIds.has(f.skuId) && f.periodId === p.id).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
      const pVal = allShipment.filter(s => skuIds.has(s.skuId) && s.periodId === p.id).reduce((s, d) => {
        return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
      }, 0);
      return { period: p.label, year: p.year, month: p.month, forecast: fVal, production: pVal };
    });

    return {
      weight,
      skuCount: weightSkus.length,
      totalForecast: Math.round(fTotal),
      totalProduction: Math.round(pTotal),
      totalIms: Math.round(iTotal),
      monthly,
    };
  });
}

/** By Category: Core vs NPI breakdown */
export async function getAnalysisByCategory() {
  const db = await getDb();
  if (!db) return [];

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allForecast = await db.select().from(forecastData);
  const allShipment = await db.select().from(shipmentData);
  const allIms = await db.select().from(imsData);

  const categories = Array.from(new Set(allSkusList.map(s => s.category))).sort();

  return categories.map(category => {
    const catSkus = allSkusList.filter(s => s.category === category);
    const skuIds = new Set(catSkus.map(s => s.id));

    const fTotal = allForecast.filter(f => skuIds.has(f.skuId)).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
    const pTotal = allShipment.filter(s => skuIds.has(s.skuId)).reduce((s, d) => {
      return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    }, 0);
    const iTotal = allIms.filter(i => skuIds.has(i.skuId)).reduce((s, i) => s + (parseFloat(i.value ?? "0") || 0), 0);

    const monthly = allPeriods.map(p => {
      const fVal = allForecast.filter(f => skuIds.has(f.skuId) && f.periodId === p.id).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
      const pVal = allShipment.filter(s => skuIds.has(s.skuId) && s.periodId === p.id).reduce((s, d) => {
        return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
      }, 0);
      return { period: p.label, year: p.year, month: p.month, forecast: fVal, production: pVal };
    });

    // Weight breakdown within category
    const weightBreakdown = Array.from(new Set(catSkus.map(s => s.weight))).map(w => ({
      weight: w,
      count: catSkus.filter(s => s.weight === w).length,
      forecast: Math.round(allForecast.filter(f => catSkus.filter(s => s.weight === w).map(s => s.id).includes(f.skuId)).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0)),
    }));

    return {
      category,
      skuCount: catSkus.length,
      totalForecast: Math.round(fTotal),
      totalProduction: Math.round(pTotal),
      totalIms: Math.round(iTotal),
      weightBreakdown,
      monthly,
    };
  });
}

/** By Flavor: extract flavor from SKU names */
export async function getAnalysisByFlavor() {
  const db = await getDb();
  if (!db) return [];

  const allSkusList = await db.select().from(skus);
  const allForecast = await db.select().from(forecastData);
  const allIms = await db.select().from(imsData);
  const allShipment = await db.select().from(shipmentData);

  // Extract flavor from SKU name: "Al Fakher <Flavor> <Weight>" pattern
  const extractFlavor = (name: string): string => {
    // Remove "Al Fakher " prefix and weight suffix
    let flavor = name.replace(/^Al Fakher\s*/i, "").replace(/\s*\d+g$/i, "").replace(/\s*\d+kg$/i, "").trim();
    return flavor || name;
  };

  const flavorMap = new Map<string, typeof allSkusList>();
  for (const sku of allSkusList) {
    const flavor = extractFlavor(sku.name);
    if (!flavorMap.has(flavor)) flavorMap.set(flavor, []);
    flavorMap.get(flavor)!.push(sku);
  }

  return Array.from(flavorMap.entries()).map(([flavor, flavorSkus]) => {
    const skuIds = new Set(flavorSkus.map(s => s.id));
    const fTotal = allForecast.filter(f => skuIds.has(f.skuId)).reduce((s, f) => s + (parseFloat(f.value ?? "0") || 0), 0);
    const iTotal = allIms.filter(i => skuIds.has(i.skuId)).reduce((s, i) => s + (parseFloat(i.value ?? "0") || 0), 0);
    const pTotal = allShipment.filter(s => skuIds.has(s.skuId)).reduce((s, d) => {
      return s + (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    }, 0);

    return {
      flavor,
      skus: flavorSkus.map(s => ({ id: s.id, name: s.name, weight: s.weight })),
      weights: Array.from(new Set(flavorSkus.map(s => s.weight))),
      totalForecast: Math.round(fTotal),
      totalIms: Math.round(iTotal),
      totalProduction: Math.round(pTotal),
    };
  }).sort((a, b) => b.totalForecast - a.totalForecast);
}

/** Production Analysis: shipment vs arrival gap, monthly efficiency */
export async function getAnalysisProduction() {
  const db = await getDb();
  if (!db) return { monthly: [], skuEfficiency: [] };

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allShipment = await db.select().from(shipmentData);
  const allArrival = await db.select().from(arrivalData);

  const sumWeeks = (d: { week1: string | null; week2: string | null; week3: string | null; week4: string | null }) => {
    return (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
  };

  // Monthly production vs arrival
  const monthly = allPeriods.map(p => {
    const shipped = allShipment.filter(s => s.periodId === p.id).reduce((s, d) => s + sumWeeks(d), 0);
    const arrived = allArrival.filter(a => a.periodId === p.id).reduce((s, d) => s + sumWeeks(d), 0);
    return {
      period: p.label,
      year: p.year,
      month: p.month,
      shipped: Math.round(shipped),
      arrived: Math.round(arrived),
      gap: Math.round(shipped - arrived),
      efficiency: shipped > 0 ? Math.round(arrived / shipped * 100) : 0,
    };
  });

  // Per-SKU efficiency
  const skuEfficiency = allSkusList.map(sku => {
    const totalShipped = allShipment.filter(s => s.skuId === sku.id).reduce((s, d) => s + sumWeeks(d), 0);
    const totalArrived = allArrival.filter(a => a.skuId === sku.id).reduce((s, d) => s + sumWeeks(d), 0);
    return {
      id: sku.id,
      name: sku.name,
      weight: sku.weight,
      category: sku.category,
      totalShipped: Math.round(totalShipped),
      totalArrived: Math.round(totalArrived),
      gap: Math.round(totalShipped - totalArrived),
      efficiency: totalShipped > 0 ? Math.round(totalArrived / totalShipped * 100) : 0,
    };
  }).sort((a, b) => a.efficiency - b.efficiency);

  return { monthly, skuEfficiency };
}

/** Stock Health: zone distribution from Planning FG data */
export async function getAnalysisStockHealth() {
  const db = await getDb();
  if (!db) return { zones: [], skuHealth: [], periodHealth: [] };

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allPlanningFg = await db.select().from(planningFgData);
  const allImsH = await db.select().from(imsData);
  const allForecastH = await db.select().from(forecastData);
  const nowH = new Date();
  const curYrH = nowH.getFullYear();
  const curMoH = nowH.getMonth() + 1;

  // Compute weeks of stock for each SKU/period server-side
  const weeksMap = new Map<string, number>(); // key: skuId-periodId
  for (const sku of allSkusList) {
    let prevCS = 0;
    for (let i = 0; i < allPeriods.length; i++) {
      const p = allPeriods[i];
      const pf = allPlanningFg.find(d => d.skuId === sku.id && d.periodId === p.id);
      const imsVal = parseFloat(allImsH.find(d => d.skuId === sku.id && d.periodId === p.id)?.value ?? "0") || 0;
      const effIms = imsVal !== 0 ? imsVal : (() => {
        if (p.year > curYrH || (p.year === curYrH && p.month > curMoH))
          return parseFloat(allForecastH.find(f => f.skuId === sku.id && f.periodId === p.id)?.value ?? "0") || 0;
        return 0;
      })();
      const opening = i === 0 ? (parseFloat(pf?.openingStock ?? "0") || 0) : prevCS;
      const adj = parseFloat(pf?.adjustments ?? "0") || 0;
      const arr = parseFloat(pf?.arrivals ?? "0") || 0;
      const cs = opening + adj + arr - effIms;
      let weeks = 0;
      if (cs !== 0) {
        const getEff = (idx: number) => {
          if (idx >= allPeriods.length) return 0;
          const pp = allPeriods[idx];
          const iv = parseFloat(allImsH.find(d => d.skuId === sku.id && d.periodId === pp.id)?.value ?? "0") || 0;
          if (iv !== 0) return iv;
          if (pp.year > curYrH || (pp.year === curYrH && pp.month > curMoH))
            return parseFloat(allForecastH.find(f => f.skuId === sku.id && f.periodId === pp.id)?.value ?? "0") || 0;
          return 0;
        };
        const n1 = getEff(i + 1);
        const n2 = getEff(i + 2);
        const avgN = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
        weeks = avgN !== 0 ? (cs / avgN) * 4.3 : (cs > 0 ? Infinity : -Infinity);
      }
      weeksMap.set(`${sku.id}-${p.id}`, weeks);
      prevCS = cs;
    }
  }

  // Zone classification
  const classifyZone = (weeks: number): string => {
    if (!isFinite(weeks) && weeks > 0) return "Overstock";
    if (!isFinite(weeks) && weeks < 0) return "Negative";
    if (weeks === 0) return "Out of Stock";
    if (weeks < 0) return "Negative";
    if (weeks < 4) return "Critical";
    if (weeks <= 6) return "Healthy";
    return "Overstock";
  };

  const zoneColors: Record<string, string> = {
    "Out of Stock": "#6b7280",
    "Negative": "#111827",
    "Critical": "#dc2626",
    "Healthy": "#16a34a",
    "Overstock": "#ea580c",
  };

  // Count zones across all data points
  const zoneCounts: Record<string, number> = {};
  let totalDataPoints = 0;
  for (const [, weeks] of Array.from(weeksMap)) {
    const zone = classifyZone(weeks);
    zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
    totalDataPoints++;
  }

  const zones = Object.entries(zoneCounts).map(([zone, count]) => ({
    zone,
    count,
    percentage: totalDataPoints > 0 ? Math.round(count / totalDataPoints * 100) : 0,
    color: zoneColors[zone] || "#6b7280",
  }));

  // Per-SKU health summary
  const skuHealth = allSkusList.map(sku => {
    const skuWeeks: number[] = [];
    const zoneBreakdown: Record<string, number> = {};
    for (const p of allPeriods) {
      const w = weeksMap.get(`${sku.id}-${p.id}`);
      if (w !== undefined) {
        skuWeeks.push(isFinite(w) ? w : 0);
        const zone = classifyZone(w);
        zoneBreakdown[zone] = (zoneBreakdown[zone] || 0) + 1;
      }
    }
    const avgWeeks = skuWeeks.length > 0 ? skuWeeks.reduce((a, b) => a + b, 0) / skuWeeks.length : 0;
    const healthScore = skuWeeks.length > 0 ? Math.round((zoneBreakdown["Healthy"] || 0) / skuWeeks.length * 100) : 0;

    return {
      id: sku.id,
      name: sku.name,
      weight: sku.weight,
      category: sku.category,
      avgWeeksOfStock: Math.round(avgWeeks * 10) / 10,
      healthScore,
      zoneBreakdown,
      totalPeriods: skuWeeks.length,
    };
  }).sort((a, b) => a.healthScore - b.healthScore);

  // Per-period health (how many SKUs in each zone per month)
  const periodHealth = allPeriods.map(p => {
    const zoneBreakdown: Record<string, number> = {};
    let totalSkus = 0;
    for (const sku of allSkusList) {
      const w = weeksMap.get(`${sku.id}-${p.id}`);
      if (w !== undefined) {
        const zone = classifyZone(w);
        zoneBreakdown[zone] = (zoneBreakdown[zone] || 0) + 1;
        totalSkus++;
      }
    }
    return {
      period: p.label,
      year: p.year,
      month: p.month,
      zoneBreakdown,
      totalSkus,
    };
  });

  return { zones, skuHealth, periodHealth };
}

// ==================== STOCK SNAPSHOT ====================
export async function getStockSnapshot() {
  const db = await getDb();
  if (!db) return { summary: { critical: 0, warning: 0, healthy: 0, overstock: 0, outOfStock: 0, total: 0 }, criticalSkus: [], overstockedSkus: [], heatmap: [], periodLabels: [], actionSummary: { needForecastReduction: 0, needProductionIncrease: 0, needBoth: 0 } };

  const allSkusList = await db.select().from(skus);
  const allPeriods = await db.select().from(periods).orderBy(periods.sortOrder);
  const allPlanningFg = await db.select().from(planningFgData);
  const allImsH = await db.select().from(imsData);
  const allForecastH = await db.select().from(forecastData);
  const allShipmentH = await db.select().from(shipmentData);
  const now = new Date();
  const curYr = now.getFullYear();
  const curMo = now.getMonth() + 1;

  // Only future periods (current month onwards)
  const futurePeriods = allPeriods.filter(p => p.year > curYr || (p.year === curYr && p.month >= curMo));

  // Compute closing stock and weeks for each SKU × period
  const weeksGrid = new Map<string, number>(); // skuId-periodId → weeks
  const closingStockGrid = new Map<string, number>(); // skuId-periodId → closing stock

  for (const sku of allSkusList) {
    let prevCS = 0;
    for (let i = 0; i < allPeriods.length; i++) {
      const p = allPeriods[i];
      const pf = allPlanningFg.find(d => d.skuId === sku.id && d.periodId === p.id);
      const imsVal = parseFloat(allImsH.find(d => d.skuId === sku.id && d.periodId === p.id)?.value ?? "0") || 0;
      const isFuture = p.year > curYr || (p.year === curYr && p.month > curMo);
      const effIms = imsVal !== 0 ? imsVal : (isFuture ? (parseFloat(allForecastH.find(f => f.skuId === sku.id && f.periodId === p.id)?.value ?? "0") || 0) : 0);
      const opening = i === 0 ? (parseFloat(pf?.openingStock ?? "0") || 0) : prevCS;
      const adj = parseFloat(pf?.adjustments ?? "0") || 0;
      const arr = parseFloat(pf?.arrivals ?? "0") || 0;
      const cs = opening + adj + arr - effIms;
      closingStockGrid.set(`${sku.id}-${p.id}`, cs);

      const getEff = (idx: number) => {
        if (idx >= allPeriods.length) return 0;
        const pp = allPeriods[idx];
        const iv = parseFloat(allImsH.find(d => d.skuId === sku.id && d.periodId === pp.id)?.value ?? "0") || 0;
        if (iv !== 0) return iv;
        const isFut = pp.year > curYr || (pp.year === curYr && pp.month > curMo);
        if (isFut) return parseFloat(allForecastH.find(f => f.skuId === sku.id && f.periodId === pp.id)?.value ?? "0") || 0;
        return 0;
      };
      const n1 = getEff(i + 1);
      const n2 = getEff(i + 2);
      const avgN = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
      const weeks = cs === 0 ? 0 : avgN !== 0 ? (cs / avgN) * 4.3 : (cs > 0 ? 99 : -99);
      weeksGrid.set(`${sku.id}-${p.id}`, weeks);
      prevCS = cs;
    }
  }

  const classifyZone = (w: number): "Critical" | "Warning" | "Healthy" | "Overstock" | "Out of Stock" | "Negative" => {
    if (w <= 0) return w < 0 ? "Negative" : "Out of Stock";
    if (w < 4) return "Critical";
    if (w <= 6) return "Healthy";
    if (w > 6 && w < 99) return "Overstock";
    if (w >= 99) return "Overstock";
    return "Warning";
  };

  // Build per-SKU snapshot for future periods only
  const skuSnapshots = allSkusList.map(sku => {
    const futureWeeks = futurePeriods.map(p => ({
      periodId: p.id,
      periodLabel: p.label,
      year: p.year,
      month: p.month,
      weeks: weeksGrid.get(`${sku.id}-${p.id}`) ?? 0,
      closingStock: closingStockGrid.get(`${sku.id}-${p.id}`) ?? 0,
      zone: classifyZone(weeksGrid.get(`${sku.id}-${p.id}`) ?? 0),
    }));

    const unhealthyPeriods = futureWeeks.filter(fw => fw.zone !== "Healthy");
    const criticalPeriods = futureWeeks.filter(fw => fw.zone === "Critical" || fw.zone === "Negative" || fw.zone === "Out of Stock");
    const overstockPeriods = futureWeeks.filter(fw => fw.zone === "Overstock");

    // First critical period
    const firstCritical = criticalPeriods.length > 0 ? criticalPeriods[0] : null;
    const firstOverstock = overstockPeriods.length > 0 ? overstockPeriods[0] : null;

    // Trend: compare first half vs second half avg weeks
    const mid = Math.floor(futureWeeks.length / 2);
    const firstHalfAvg = futureWeeks.slice(0, mid).reduce((s, fw) => s + Math.min(fw.weeks, 12), 0) / (mid || 1);
    const secondHalfAvg = futureWeeks.slice(mid).reduce((s, fw) => s + Math.min(fw.weeks, 12), 0) / ((futureWeeks.length - mid) || 1);
    const trend: "improving" | "deteriorating" | "stable" =
      secondHalfAvg - firstHalfAvg > 0.5 ? "improving" :
      firstHalfAvg - secondHalfAvg > 0.5 ? "deteriorating" : "stable";

    // Current period weeks
    const currentPeriodWeeks = futureWeeks.length > 0 ? futureWeeks[0].weeks : 0;
    const currentZone = classifyZone(currentPeriodWeeks);

    // Shipment total (future)
    const futureShipment = futurePeriods.reduce((s, p) => {
      const sd = allShipmentH.find(d => d.skuId === sku.id && d.periodId === p.id);
      const sv = sd ? (parseFloat(sd.week1 ?? "0") + parseFloat(sd.week2 ?? "0") + parseFloat(sd.week3 ?? "0") + parseFloat(sd.week4 ?? "0")) : 0;
      return s + sv;
    }, 0);

    // Forecast total (future)
    const futureForecast = futurePeriods.reduce((s, p) => {
      const fv = parseFloat(allForecastH.find(f => f.skuId === sku.id && f.periodId === p.id)?.value ?? "0") || 0;
      return s + fv;
    }, 0);

    const unhealthyCount = unhealthyPeriods.length;
    const criticalCount = criticalPeriods.length;
    const overstockCount = overstockPeriods.length;
    const healthyCount = futureWeeks.filter(fw => fw.zone === "Healthy").length;
    const healthScore = futureWeeks.length > 0 ? Math.round(healthyCount / futureWeeks.length * 100) : 100;

    return {
      id: sku.id,
      name: sku.name,
      weight: sku.weight,
      category: sku.category,
      currentWeeks: Math.round(currentPeriodWeeks * 10) / 10,
      currentZone,
      trend,
      healthScore,
      unhealthyCount,
      criticalCount,
      overstockCount,
      healthyCount,
      totalFuturePeriods: futureWeeks.length,
      firstCriticalPeriod: firstCritical ? firstCritical.periodLabel : null,
      firstOverstockPeriod: firstOverstock ? firstOverstock.periodLabel : null,
      futureForecast,
      futureShipment,
      periodWeeks: futureWeeks.map(fw => ({ label: fw.periodLabel, weeks: Math.round(fw.weeks * 10) / 10, zone: fw.zone, closingStock: fw.closingStock })),
    };
  });

  // Summary counts (based on current period zone)
  const summary = {
    critical: skuSnapshots.filter(s => s.currentZone === "Critical" || s.currentZone === "Negative" || s.currentZone === "Out of Stock").length,
    warning: skuSnapshots.filter(s => s.criticalCount > 0 && s.currentZone === "Healthy").length,
    healthy: skuSnapshots.filter(s => s.currentZone === "Healthy" && s.criticalCount === 0 && s.overstockCount === 0).length,
    overstock: skuSnapshots.filter(s => s.currentZone === "Overstock").length,
    outOfStock: skuSnapshots.filter(s => s.currentZone === "Out of Stock").length,
    total: skuSnapshots.length,
  };

  // Critical SKUs (currently critical or will become critical soon)
  const criticalSkus = skuSnapshots
    .filter(s => s.currentZone === "Critical" || s.currentZone === "Negative" || s.currentZone === "Out of Stock" || s.criticalCount > 0)
    .sort((a, b) => a.healthScore - b.healthScore);

  // Overstocked SKUs
  const overstockedSkus = skuSnapshots
    .filter(s => s.currentZone === "Overstock" || s.overstockCount > 0)
    .sort((a, b) => b.currentWeeks - a.currentWeeks);

  // Heatmap: each SKU row, future period columns
  const heatmap = skuSnapshots.map(s => ({
    skuId: s.id,
    skuName: s.name,
    weight: s.weight,
    category: s.category,
    healthScore: s.healthScore,
    periods: s.periodWeeks,
  })).sort((a, b) => a.healthScore - b.healthScore);

  const periodLabels = futurePeriods.map(p => p.label);

  // Action summary
  const actionSummary = {
    needForecastReduction: overstockedSkus.filter(s => s.futureForecast > 0).length,
    needProductionIncrease: criticalSkus.filter(s => s.futureShipment < s.futureForecast).length,
    needBoth: skuSnapshots.filter(s => s.criticalCount > 0 && s.overstockCount > 0).length,
  };

  return { summary, criticalSkus, overstockedSkus, heatmap, periodLabels, actionSummary };
}

// ==================== COUNTRY-SCOPED PLANNING FG ====================
export async function getFullPlanningDataForCountry(country: Country) {
  const db = await getDb();
  if (!db) return { skus: [], periods: [], forecast: [], ims: [], shipment: [], arrival: [], planningFg: [], clearanceEvents: [] };
  const skuList = await getSkusForCountry(country);
  const skuIds = skuList.map(s => s.id);
  if (skuIds.length === 0) {
    const periodList = await getPeriodsForCountry(country);
    return { skus: skuList, periods: periodList, forecast: [], ims: [], shipment: [], arrival: [], planningFg: [], clearanceEvents: [] };
  }
  const periodList = await getPeriodsForCountry(country);
  const forecast = await db.select().from(forecastData).where(inArray(forecastData.skuId, skuIds));
  const ims = await db.select().from(imsData).where(inArray(imsData.skuId, skuIds));
  const shipment = await db.select().from(shipmentData).where(inArray(shipmentData.skuId, skuIds));
  const arrival = await db.select().from(arrivalData).where(inArray(arrivalData.skuId, skuIds));
  const planning = await db.select().from(planningFgData).where(inArray(planningFgData.skuId, skuIds));
  const clearEvts = await db.select().from(clearanceEvents).where(inArray(clearanceEvents.skuId, skuIds));
  return { skus: skuList, periods: periodList, forecast, ims, shipment, arrival, planningFg: planning, clearanceEvents: clearEvts };
}

export async function upsertCountryPlanningFgCell(skuId: number, periodId: number, data: { openingStock?: string; adjustments?: string; invoiced?: string; arrivals?: string }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(planningFgData)
    .where(and(eq(planningFgData.skuId, skuId), eq(planningFgData.periodId, periodId))).limit(1);
  if (existing.length > 0) {
    await db.update(planningFgData).set(data).where(eq(planningFgData.id, existing[0].id));
  } else {
    await db.insert(planningFgData).values({ skuId, periodId, openingStock: "0", adjustments: "0", invoiced: "0", arrivals: "0", ...data });
  }
}

// ==================== INTL ANALYSIS (Syria / Libya) ====================

export async function getIntlAnalysis(country: "Syria" | "Libya") {
  const db = await getDb();
  if (!db) return null;

  const skuList = await getSkusForCountry(country);
  const skuIds = skuList.map((s) => s.id);
  if (skuIds.length === 0) return null;

  const periodList = await getPeriodsForCountry(country);
  const shipmentRows = await db.select().from(shipmentData).where(inArray(shipmentData.skuId, skuIds));
  const imsRows = await db.select().from(imsData).where(inArray(imsData.skuId, skuIds));
  const planningRows = await db.select().from(planningFgData).where(inArray(planningFgData.skuId, skuIds));

  const periodMap = new Map(periodList.map((p) => [p.id, p]));
  const skuMap = new Map(skuList.map((s) => [s.id, s]));

  // - Production analysis -
  // Monthly production totals (by period label)
  const monthlyProd = new Map<string, number>();
  const skuProd = new Map<number, number>();
  const weightProd = new Map<string, number>();

  for (const row of shipmentRows) {
    const total =
      (parseFloat(row.week1 ?? "0") || 0) +
      (parseFloat(row.week2 ?? "0") || 0) +
      (parseFloat(row.week3 ?? "0") || 0) +
      (parseFloat(row.week4 ?? "0") || 0);
    if (total === 0) continue;
    const p = periodMap.get(row.periodId);
    if (!p) continue;
    const label = p.label;
    monthlyProd.set(label, (monthlyProd.get(label) ?? 0) + total);
    skuProd.set(row.skuId, (skuProd.get(row.skuId) ?? 0) + total);
    const sku = skuMap.get(row.skuId);
    if (sku) weightProd.set(sku.weight, (weightProd.get(sku.weight) ?? 0) + total);
  }

  // - Clearance analysis -
  type ClearanceBatch = {
    skuId: number;
    skuName: string;
    weight: string;
    periodLabel: string;
    totalQty: number;
    clearedQty: number;
    pendingQty: number;
    status: string;
    clearedDate: string | null;
    arrivalDate: string | null;
    daysAtPort: number | null;
  };

  const clearanceBatches: ClearanceBatch[] = [];
  let totalProduced = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let batchesWithDelay = 0;
  const today = new Date();

  for (const row of shipmentRows) {
    const prodTotal =
      (parseFloat(row.week1 ?? "0") || 0) +
      (parseFloat(row.week2 ?? "0") || 0) +
      (parseFloat(row.week3 ?? "0") || 0) +
      (parseFloat(row.week4 ?? "0") || 0);
    if (prodTotal === 0 && !(row as any).arrivalOffsetValue) continue;
    const sku = skuMap.get(row.skuId);
    const p = periodMap.get(row.periodId);
    if (!sku || !p) continue;

    const clearedQty = (row as any).clearedQty != null ? parseFloat((row as any).clearedQty) : 0;
    const pendingQty = Math.max(0, prodTotal - clearedQty);
    const status = (row as any).arrivalStatus ?? "Pending";
    const clearedDate = (row as any).clearedDate ?? null;

    // Compute arrival date from offset
    let arrivalDate: string | null = null;
    let daysAtPort: number | null = null;
    const offVal = (row as any).arrivalOffsetValue ?? 0;
    const offUnit = (row as any).arrivalOffsetUnit ?? "days";
    if (offVal > 0) {
      const d = new Date(p.year, p.month - 1, 15);
      if (offUnit === "days") d.setDate(d.getDate() + offVal);
      else if (offUnit === "weeks") d.setDate(d.getDate() + offVal * 7);
      else d.setMonth(d.getMonth() + offVal);
      arrivalDate = d.toISOString().substring(0, 10);
      if (d <= today && status !== "Pending" && status !== "In Transit") {
        daysAtPort = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (daysAtPort > 7 && status !== "Cleared") batchesWithDelay++;
      }
    }

    totalProduced += prodTotal;
    totalCleared += clearedQty;
    totalPending += pendingQty;

    clearanceBatches.push({
      skuId: row.skuId,
      skuName: sku.name,
      weight: sku.weight,
      periodLabel: p.label,
      totalQty: prodTotal,
      clearedQty,
      pendingQty,
      status,
      clearedDate: clearedDate ? String(clearedDate) : null,
      arrivalDate,
      daysAtPort,
    });
  }

  const clearanceRate = totalProduced > 0 ? Math.round((totalCleared / totalProduced) * 100) : 0;

  // Status distribution
  const statusCounts: Record<string, number> = {};
  for (const b of clearanceBatches) {
    statusCounts[b.status] = (statusCounts[b.status] ?? 0) + 1;
  }

  // - IMS analysis -
  const monthlyIms = new Map<string, number>();
  const skuIms = new Map<number, number>();
  const weightIms = new Map<string, number>();

  for (const row of imsRows) {
    const val = parseFloat(row.value ?? "0") || 0;
    if (val === 0) continue;
    const p = periodMap.get(row.periodId);
    if (!p) continue;
    monthlyIms.set(p.label, (monthlyIms.get(p.label) ?? 0) + val);
    skuIms.set(row.skuId, (skuIms.get(row.skuId) ?? 0) + val);
    const sku = skuMap.get(row.skuId);
    if (sku) weightIms.set(sku.weight, (weightIms.get(sku.weight) ?? 0) + val);
  }

  // - Planning FG analysis (closing stock health) -
  const skuClosingStock = new Map<number, number[]>();
  for (const row of planningRows) {
    const sku = skuMap.get(row.skuId);
    if (!sku) continue;
    const openingStock = parseFloat(row.openingStock ?? "0") || 0;
    const adjustments = parseFloat(row.adjustments ?? "0") || 0;
    const arrivals = parseFloat(row.arrivals ?? "0") || 0;
    const imsVal = imsRows.find((i) => i.skuId === row.skuId && i.periodId === row.periodId);
    const ims = imsVal ? parseFloat(imsVal.value ?? "0") || 0 : 0;
    const closing = openingStock + adjustments + arrivals - ims;
    if (!skuClosingStock.has(row.skuId)) skuClosingStock.set(row.skuId, []);
    skuClosingStock.get(row.skuId)!.push(closing);
  }

  // - Build sorted period labels -
  const sortedPeriods = [...periodList].sort((a, b) => a.sortOrder - b.sortOrder);
  const periodLabels = sortedPeriods.map((p) => p.label);

  // Monthly production array aligned to sorted periods
  const monthlyProductionSeries = periodLabels.map((lbl) => monthlyProd.get(lbl) ?? 0);
  const monthlyImsSeries = periodLabels.map((lbl) => monthlyIms.get(lbl) ?? 0);

  // Per-SKU production breakdown
  // - Forecast data (revised forecast) -
  const forecastRows = await db.select().from(forecastData).where(inArray(forecastData.skuId, skuIds));
  const revisedForecastRows = await db.select().from(revisedForecastData).where(inArray(revisedForecastData.skuId, skuIds));

  const monthlyForecast = new Map<string, number>();
  const monthlyRevisedForecast = new Map<string, number>();
  for (const row of forecastRows) {
    const p = periodMap.get(row.periodId);
    if (!p) continue;
    const val = parseFloat(row.value ?? '0') || 0;
    monthlyForecast.set(p.label, (monthlyForecast.get(p.label) ?? 0) + val);
  }
  for (const row of revisedForecastRows) {
    const p = periodMap.get(row.periodId);
    if (!p) continue;
    const val = parseFloat(row.value ?? '0') || 0;
    monthlyRevisedForecast.set(p.label, (monthlyRevisedForecast.get(p.label) ?? 0) + val);
  }

  const monthlyForecastSeries = periodLabels.map((lbl) => monthlyForecast.get(lbl) ?? 0);
  const monthlyRevisedForecastSeries = periodLabels.map((lbl) => monthlyRevisedForecast.get(lbl) ?? 0);

  // Forecast accuracy: compare forecast vs actual production per period
  const forecastAccuracyByPeriod = periodLabels.map((lbl, i) => {
    const forecast = monthlyForecastSeries[i];
    const actual = monthlyProductionSeries[i];
    const accuracy = forecast > 0 ? Math.round(Math.min(actual, forecast) / Math.max(actual, forecast) * 100) : null;
    const variance = forecast > 0 ? Math.round(((actual - forecast) / forecast) * 100) : null;
    return { label: lbl, forecast, actual, accuracy, variance };
  }).filter((p) => p.forecast > 0 || p.actual > 0);

  // Overall forecast accuracy
  const accuracyPoints = forecastAccuracyByPeriod.filter((p) => p.accuracy !== null);
  const overallForecastAccuracy = accuracyPoints.length > 0
    ? Math.round(accuracyPoints.reduce((s, p) => s + (p.accuracy ?? 0), 0) / accuracyPoints.length)
    : null;

  // IMS growth rate (last 3 months vs prior 3 months)
  const recentIms = monthlyImsSeries.slice(-3).reduce((a, b) => a + b, 0);
  const priorIms = monthlyImsSeries.slice(-6, -3).reduce((a, b) => a + b, 0);
  const imsGrowthRate = priorIms > 0 ? Math.round(((recentIms - priorIms) / priorIms) * 100) : null;

  // Stock health per SKU (latest closing stock in weeks based on avg monthly IMS)
  const skuStockHealth = new Map<number, { closingStock: number; weeksOfStock: number | null; zone: 'Critical' | 'Healthy' | 'Overstock' }>();
  for (const [skuId, closingStocks] of Array.from(skuClosingStock.entries())) {
    const latestClosing = closingStocks[closingStocks.length - 1] ?? 0;
    const avgMonthlyIms = (skuIms.get(skuId) ?? 0) / Math.max(periodLabels.length, 1);
    const weeksOfStock = avgMonthlyIms > 0 ? Math.round((latestClosing / avgMonthlyIms) * 4.33) : null;
    const zone: 'Critical' | 'Healthy' | 'Overstock' =
      weeksOfStock === null ? 'Healthy' :
      weeksOfStock < 4 ? 'Critical' :
      weeksOfStock > 12 ? 'Overstock' : 'Healthy';
    skuStockHealth.set(skuId, { closingStock: latestClosing, weeksOfStock, zone });
  }

  // Packaging breakdown
  const packagingProd = new Map<string, number>();
  const packagingIms = new Map<string, number>();
  for (const sku of skuList) {
    const pt = (sku as any).packagingType ?? 'New';
    packagingProd.set(pt, (packagingProd.get(pt) ?? 0) + (skuProd.get(sku.id) ?? 0));
    packagingIms.set(pt, (packagingIms.get(pt) ?? 0) + (skuIms.get(sku.id) ?? 0));
  }
  const packagingBreakdown = ['Old', 'New'].map((pt) => ({
    packagingType: pt,
    totalProduction: packagingProd.get(pt) ?? 0,
    totalIms: packagingIms.get(pt) ?? 0,
  }));

  const skuProductionBreakdown = skuList
    .map((sku) => {
      const health = skuStockHealth.get(sku.id);
      return {
        id: sku.id,
        name: sku.name,
        weight: sku.weight,
        packagingType: (sku as any).packagingType ?? 'New',
        category: sku.category ?? "Core",
        totalProduction: skuProd.get(sku.id) ?? 0,
        totalIms: skuIms.get(sku.id) ?? 0,
        stockHealth: health ?? null,
        monthly: periodLabels.map((lbl) => {
          const p = sortedPeriods.find((pp) => pp.label === lbl);
          if (!p) return { label: lbl, production: 0, ims: 0, forecast: 0 };
          const shipRow = shipmentRows.find((r) => r.skuId === sku.id && r.periodId === p.id);
          const imsRow = imsRows.find((r) => r.skuId === sku.id && r.periodId === p.id);
          const fRow = forecastRows.find((r) => r.skuId === sku.id && r.periodId === p.id);
          const prod = shipRow
            ? (parseFloat(shipRow.week1 ?? "0") || 0) +
              (parseFloat(shipRow.week2 ?? "0") || 0) +
              (parseFloat(shipRow.week3 ?? "0") || 0) +
              (parseFloat(shipRow.week4 ?? "0") || 0)
            : 0;
          const ims = imsRow ? parseFloat(imsRow.value ?? "0") || 0 : 0;
          const forecast = fRow ? parseFloat(fRow.value ?? "0") || 0 : 0;
          return { label: lbl, production: prod, ims, forecast };
        }),
      };
    })
    .filter((s) => s.totalProduction > 0 || s.totalIms > 0);

  // Weight breakdown
  const weights = ["1kg", "250g", "50g"];
  const weightBreakdown = weights.map((w) => ({
    weight: w,
    totalProduction: weightProd.get(w) ?? 0,
    totalIms: weightIms.get(w) ?? 0,
    skuCount: skuList.filter((s) => s.weight === w).length,
  }));

  // Top SKUs by IMS
  const topSkusByIms = [...skuList]
    .map((sku) => ({ id: sku.id, name: sku.name, weight: sku.weight, packagingType: (sku as any).packagingType ?? 'New', totalIms: skuIms.get(sku.id) ?? 0 }))
    .filter((s) => s.totalIms > 0)
    .sort((a, b) => b.totalIms - a.totalIms)
    .slice(0, 10);

  return {
    country,
    totalSkus: skuList.length,
    totalProduction: totalProduced,
    totalCleared,
    totalPending,
    clearanceRate,
    batchesWithDelay,
    statusCounts,
    monthlyProductionSeries,
    monthlyImsSeries,
    monthlyForecastSeries,
    monthlyRevisedForecastSeries,
    periodLabels,
    skuProductionBreakdown,
    weightBreakdown,
    packagingBreakdown,
    clearanceBatches,
    forecastAccuracyByPeriod,
    overallForecastAccuracy,
    imsGrowthRate,
    topSkusByIms,
  };
}

// - SKU Reorder -

/**
 * Batch-update sortOrder for Lebanon SKUs.
 * orderedIds: array of SKU IDs in the new desired order.
 */
export async function reorderLebanonSkus(orderedIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(skus)
      .set({ sortOrder: i })
      .where(eq(skus.id, orderedIds[i]));
  }
}
/**
 * Batch-update sortOrder for Syria/Libya SKUs.
 * orderedIds: array of SKU IDs in the new desired order (must all belong to the same country).
 */
export async function reorderCountrySkus(
  country: "Syria" | "Libya",
  orderedIds: number[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(skus)
      .set({ sortOrder: i })
      .where(and(eq(skus.id, orderedIds[i]), eq(skus.country, country)));
  }
}

// -- App Users (server-side, cross-device) --
export async function listAppUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appUsers).orderBy(asc(appUsers.createdAt));
}
export async function getAppUserByUsername(username: string): Promise<AppUserRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appUsers).where(eq(appUsers.username, username.toLowerCase().trim())).limit(1);
  return rows[0] ?? null;
}
export async function createAppUser(data: { username: string; displayName: string; password: string; role: "admin" | "viewer"; countries: string[]; isOwner?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(appUsers).values({
    username: data.username.toLowerCase().trim(),
    displayName: data.displayName,
    password: data.password.toLowerCase().trim(),
    role: data.role,
    countries: JSON.stringify(data.countries),
    isOwner: data.isOwner ?? false,
  });
}
export async function updateAppUser(id: number, data: Partial<{ displayName: string; password: string; role: "admin" | "viewer"; countries: string[] }>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const update: Record<string, unknown> = {};
  if (data.displayName !== undefined) update.displayName = data.displayName;
  if (data.password !== undefined) update.password = data.password.toLowerCase().trim();
  if (data.role !== undefined) update.role = data.role;
  if (data.countries !== undefined) update.countries = JSON.stringify(data.countries);
  if (Object.keys(update).length > 0) {
    await db.update(appUsers).set(update).where(eq(appUsers.id, id));
  }
}
export async function deleteAppUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(appUsers).where(eq(appUsers.id, id));
}

export async function changeAppUserPassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  if (rows.length === 0) return { success: false, error: "User not found" };
  const user = rows[0];
  if (user.password !== currentPassword.toLowerCase().trim()) {
    return { success: false, error: "Current password is incorrect" };
  }
  const trimmedNew = newPassword.toLowerCase().trim();
  if (!trimmedNew) return { success: false, error: "New password cannot be empty" };
  await db.update(appUsers).set({ password: trimmedNew, updatedAt: new Date() }).where(eq(appUsers.id, userId));
  return { success: true };
}

export async function verifyAppUserLogin(username: string, password: string, country: string): Promise<{ success: boolean; user?: AppUserRow; error?: string }> {
  const user = await getAppUserByUsername(username);
  if (!user) return { success: false, error: "Invalid username or password" };
  if (user.password !== password.toLowerCase().trim()) return { success: false, error: "Invalid username or password" };
  const countries: string[] = JSON.parse(user.countries);
  const countryLower = country.toLowerCase();
  if (!user.isOwner && !countries.some(c => c.toLowerCase() === countryLower)) {
    return { success: false, error: `You do not have access to ${country}` };
  }
  return { success: true, user };
}

export async function verifyAppUserLoginNoCountry(username: string, password: string): Promise<{ success: boolean; user?: AppUserRow; error?: string }> {
  const user = await getAppUserByUsername(username);
  if (!user) return { success: false, error: "Invalid username or password" };
  if (user.password !== password.toLowerCase().trim()) return { success: false, error: "Invalid username or password" };
  return { success: true, user };
}

export async function ensureOwnerExists(username: string, displayName: string) {
  const existing = await getAppUserByUsername(username);
  if (!existing) {
    await createAppUser({ username, displayName, password: username, role: "admin", countries: ["Lebanon", "Syria", "Libya"], isOwner: true });
  }
}

// ==================== PRESENCE ====================
export async function upsertPresence(data: { username: string; displayName: string; country: string; currentPage: string }) {
  const database = await getDb();
  if (!database) return;
  const { userPresence } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const existing = await database.select().from(userPresence).where(eq(userPresence.username, data.username)).limit(1);
  if (existing.length > 0) {
    await database.update(userPresence)
      .set({ displayName: data.displayName, country: data.country, currentPage: data.currentPage })
      .where(eq(userPresence.username, data.username));
  } else {
    await database.insert(userPresence).values({
      username: data.username,
      displayName: data.displayName,
      country: data.country,
      currentPage: data.currentPage,
    });
  }
}

export async function getOnlineUsers() {
  const database = await getDb();
  if (!database) return [];
  const { userPresence } = await import("../drizzle/schema");
  const { gt } = await import("drizzle-orm");
  // Consider users online if seen in the last 2 minutes
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  return database.select().from(userPresence).where(gt(userPresence.lastSeen, cutoff));
}

export async function removePresence(username: string) {
  const database = await getDb();
  if (!database) return;
  const { userPresence } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  await database.delete(userPresence).where(eq(userPresence.username, username));
}

// ==================== EXPIRY DASHBOARD ====================
/**
 * Product Expiry Dashboard for Syria/Libya — Batch Lifecycle Tracking.
 *
 * Each production batch (skuId × periodId) is tracked through its full lifecycle:
 *   Produced → Cleared (customs) → Sold (IMS) → Remaining
 *
 * Per-batch breakdown:
 *   - producedQty: total produced (sum of week1..week4 from shipmentData)
 *   - clearedQty: total cleared through customs (from clearanceEvents)
 *   - atPortQty: producedQty - clearedQty (still at port, not yet in-country)
 *   - soldQty: IMS consumption attributed to this batch via FIFO (oldest cleared first)
 *   - inCountryQty: clearedQty - soldQty (in-country warehouse stock)
 *   - totalRemaining: atPortQty + inCountryQty (total unsold/uncleared)
 *
 * IMS is attributed to batches using FIFO: the oldest cleared batch absorbs sales first.
 * The closing stock from Planning FG is used as a cross-check.
 *
 * Alert tiers based on months until expiry (production date + 2 years):
 *   ≤ 0  → "Expired", 1-2 → "2M", 3-4 → "4M", 5-6 → "6M",
 *   7-9 → "9M", 10-12 → "12M", 13-18 → "18M", 19-24 → "24M", > 24 → "OK"
 */
export async function getExpiryDashboard(country: "Syria" | "Libya") {
  const emptySummary = { expired: 0, twoMonth: 0, fourMonth: 0, sixMonth: 0, nineMonth: 0, twelveMonth: 0, eighteenMonth: 0, twentyFourMonth: 0 };
  const database = await getDb();
  if (!database) return { rows: [] as ExpiryRow[], summary: emptySummary };

  const { eq, and } = await import("drizzle-orm");
  const { inArray } = await import("drizzle-orm");

  // 1. Fetch all active SKUs for the country
  const countrySkus = await database.select().from(skus).where(
    and(eq(skus.country, country), eq(skus.isActive, true))
  );
  if (countrySkus.length === 0) return { rows: [] as ExpiryRow[], summary: emptySummary };

  const skuIds = countrySkus.map(s => s.id);

  // 2. Fetch all periods for the country, sorted ascending
  const allPeriods = await database.select().from(periods).where(eq(periods.country, country));
  allPeriods.sort((a, b) => a.sortOrder - b.sortOrder);
  const periodMap = new Map(allPeriods.map(p => [p.id, p]));

  // 3. Fetch production data (shipmentData = production batches)
  const shipment = await database.select().from(shipmentData).where(inArray(shipmentData.skuId, skuIds));

  // 4. Fetch clearance events → sum per batch (skuId-periodId)
  const clearEvents = await database.select().from(clearanceEvents).where(
    and(eq(clearanceEvents.country, country), inArray(clearanceEvents.skuId, skuIds))
  );
  const clearedByBatch = new Map<string, number>();
  for (const ev of clearEvents) {
    const key = `${ev.skuId}-${ev.periodId}`;
    clearedByBatch.set(key, (clearedByBatch.get(key) ?? 0) + (parseFloat(ev.clearedQty) || 0));
  }

  // Also check shipmentData.clearedQty as fallback (if no clearanceEvents exist for a batch)
  const shipmentClearedByBatch = new Map<string, number>();
  for (const s of shipment) {
    if (s.clearedQty) {
      const key = `${s.skuId}-${s.periodId}`;
      shipmentClearedByBatch.set(key, parseFloat(s.clearedQty) || 0);
    }
  }

  // 5. Fetch IMS data per SKU per period
  const imsRows = await database.select().from(imsData).where(inArray(imsData.skuId, skuIds));
  const imsMap = new Map<string, number>();
  for (const d of imsRows) imsMap.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);

  // 6. Fetch planning FG data (for arrivals field as additional clearance source)
  const planningFg = await database.select().from(planningFgData).where(inArray(planningFgData.skuId, skuIds));
  const planningArrivals = new Map<string, number>();
  for (const d of planningFg) {
    const arr = parseFloat(d.arrivals ?? "0") || 0;
    if (arr > 0) planningArrivals.set(`${d.skuId}-${d.periodId}`, arr);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function monthsUntil(target: Date): number {
    const diffMs = target.getTime() - today.getTime();
    return diffMs / (1000 * 60 * 60 * 24 * 30.44);
  }

  function getAlertTier(monthsLeft: number): "Expired" | "2M" | "4M" | "6M" | "9M" | "12M" | "18M" | "24M" | "OK" {
    if (monthsLeft <= 0) return "Expired";
    if (monthsLeft <= 2) return "2M";
    if (monthsLeft <= 4) return "4M";
    if (monthsLeft <= 6) return "6M";
    if (monthsLeft <= 9) return "9M";
    if (monthsLeft <= 12) return "12M";
    if (monthsLeft <= 18) return "18M";
    if (monthsLeft <= 24) return "24M";
    return "OK";
  }

  // 7. Build batch lifecycle for each SKU
  const rows: ExpiryRow[] = [];

  for (const sku of countrySkus) {
    // Build production batches sorted by period ascending (oldest first)
    const skuBatches = shipment
      .filter(s => s.skuId === sku.id)
      .map(s => {
        const p = periodMap.get(s.periodId);
        if (!p) return null;
        const produced = (parseFloat(s.week1 ?? "0") || 0) + (parseFloat(s.week2 ?? "0") || 0)
          + (parseFloat(s.week3 ?? "0") || 0) + (parseFloat(s.week4 ?? "0") || 0);
        return { periodId: s.periodId, period: p, producedQty: produced };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.producedQty > 0)
      .sort((a, b) => a.period.sortOrder - b.period.sortOrder);

    if (skuBatches.length === 0) continue;

    // Determine cleared qty per batch:
    // Priority: clearanceEvents sum > shipmentData.clearedQty > planningFg arrivals for same period
    const batchesWithCleared = skuBatches.map(batch => {
      const key = `${sku.id}-${batch.periodId}`;
      let cleared = clearedByBatch.get(key) ?? 0;
      // Fallback to shipmentData.clearedQty if no clearance events
      if (cleared === 0) {
        cleared = shipmentClearedByBatch.get(key) ?? 0;
      }
      // Fallback to planning FG arrivals for this batch's period if still 0
      if (cleared === 0) {
        cleared = planningArrivals.get(key) ?? 0;
      }
      // Cleared cannot exceed produced
      cleared = Math.min(cleared, batch.producedQty);
      const atPort = Math.max(0, batch.producedQty - cleared);
      return { ...batch, clearedQty: cleared, atPortQty: atPort };
    });

    // FIFO: attribute total IMS (across all periods) to oldest cleared batches first
    // Total IMS for this SKU across all periods
    let totalIms = 0;
    for (const p of allPeriods) {
      totalIms += imsMap.get(`${sku.id}-${p.id}`) ?? 0;
    }

    let remainingIms = totalIms;
    const batchesWithSold = batchesWithCleared.map(batch => {
      // IMS can only consume from cleared qty (what's in-country)
      const consumable = batch.clearedQty;
      const sold = Math.min(remainingIms, consumable);
      remainingIms = Math.max(0, remainingIms - sold);
      const inCountry = Math.max(0, batch.clearedQty - sold);
      const totalRemaining = batch.atPortQty + inCountry;
      return { ...batch, soldQty: sold, inCountryQty: inCountry, totalRemaining };
    });

    // Build rows for batches within the 24M window
    for (const batch of batchesWithSold) {
      const prodDate = new Date(batch.period.year, batch.period.month - 1, 1);
      const expiryDate = new Date(prodDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 2);

      const mLeft = monthsUntil(expiryDate);
      const tier = getAlertTier(mLeft);

      // Skip batches with > 24 months remaining (OK tier)
      if (tier === "OK") continue;

      rows.push({
        skuId: sku.id,
        skuName: sku.name,
        weight: sku.weight,
        category: sku.category,
        packagingType: sku.packagingType ?? "New",
        productionPeriodId: batch.periodId,
        productionPeriodLabel: batch.period.label,
        productionDate: `${batch.period.year}-${String(batch.period.month).padStart(2, "0")}-01`,
        expiryDate: expiryDate.toISOString().slice(0, 10),
        producedQty: batch.producedQty,
        clearedQty: batch.clearedQty,
        atPortQty: batch.atPortQty,
        soldQty: batch.soldQty,
        inCountryQty: batch.inCountryQty,
        totalRemaining: batch.totalRemaining,
        monthsUntilExpiry: Math.round(mLeft * 10) / 10,
        alertTier: tier,
      });
    }
  }

  // Sort: Expired first, then by tier urgency, then by SKU name
  const tierOrder: Record<string, number> = { Expired: 0, "2M": 1, "4M": 2, "6M": 3, "9M": 4, "12M": 5, "18M": 6, "24M": 7, OK: 8 };
  rows.sort((a, b) => {
    const td = (tierOrder[a.alertTier] ?? 9) - (tierOrder[b.alertTier] ?? 9);
    if (td !== 0) return td;
    return a.skuName.localeCompare(b.skuName);
  });

  const summary = {
    expired: rows.filter(r => r.alertTier === "Expired").length,
    twoMonth: rows.filter(r => r.alertTier === "2M").length,
    fourMonth: rows.filter(r => r.alertTier === "4M").length,
    sixMonth: rows.filter(r => r.alertTier === "6M").length,
    nineMonth: rows.filter(r => r.alertTier === "9M").length,
    twelveMonth: rows.filter(r => r.alertTier === "12M").length,
    eighteenMonth: rows.filter(r => r.alertTier === "18M").length,
    twentyFourMonth: rows.filter(r => r.alertTier === "24M").length,
  };

  return { rows, summary };
}

// ==================== RUNNING RATE ANALYSIS ====================
export async function getRunningRateAnalysis(country: "Lebanon" | "Syria" | "Libya") {
  const db = await getDb();
  if (!db) return null;

  const skuList = await getSkusForCountry(country);
  const skuIds = skuList.map(s => s.id);
  if (skuIds.length === 0) return null;

  const periodList = await getPeriodsForCountry(country);
  const imsRows = await db.select().from(imsData).where(inArray(imsData.skuId, skuIds));
  const forecastRows = await db.select().from(forecastData).where(inArray(forecastData.skuId, skuIds));

  const periodMap = new Map(periodList.map(p => [p.id, p]));
  const skuMap = new Map(skuList.map(s => [s.id, s]));
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const sortedPeriods = [...periodList].sort((a, b) => a.sortOrder - b.sortOrder);
  const periodLabels = sortedPeriods.map(p => p.label);

  const extractFlavor = (name: string) => {
    return name.replace(/^Al Fakher\s*/i, "").replace(/\s*(50g|250g|1kg)\s*$/i, "").trim() || name;
  };

  type SkuRateData = {
    id: number;
    name: string;
    weight: string;
    category: string;
    packagingType: string;
    flavor: string;
    monthlyValues: number[];
    avg3m: number;
    avg6m: number;
    avgAll: number;
    trend: number;
    trendDirection: "growing" | "stable" | "declining";
    lastMonthValue: number;
    peakMonth: string;
    peakValue: number;
    monthsWithData: number;
  };

  const skuRates: SkuRateData[] = [];

  for (const sku of skuList) {
    const monthlyValues: number[] = [];

    for (const p of sortedPeriods) {
      const imsRow = imsRows.find(r => r.skuId === sku.id && r.periodId === p.id);
      const val = parseFloat(imsRow?.value ?? "0") || 0;
      monthlyValues.push(val);
    }

    const nonZeroValues = monthlyValues.filter(v => v > 0);
    const monthsWithData = nonZeroValues.length;

    let lastDataIdx = monthlyValues.length - 1;
    for (let li = monthlyValues.length - 1; li >= 0; li--) {
      if (monthlyValues[li] > 0) { lastDataIdx = li; break; }
    }
    const anchorIdx = lastDataIdx + 1;
    const recent = monthlyValues.slice(0, anchorIdx);

    const last3 = recent.slice(-3).filter(v => v > 0);
    const last6 = recent.slice(-6).filter(v => v > 0);
    const avg3m = last3.length > 0 ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
    const avg6m = last6.length > 0 ? last6.reduce((a, b) => a + b, 0) / last6.length : 0;
    const avgAll = nonZeroValues.length > 0 ? nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length : 0;

    const prior3 = recent.slice(-6, -3).filter(v => v > 0);
    const avgPrior3 = prior3.length > 0 ? prior3.reduce((a, b) => a + b, 0) / prior3.length : 0;
    const trend = avgPrior3 > 0 ? Math.round(((avg3m - avgPrior3) / avgPrior3) * 100) : 0;
    const trendDirection: "growing" | "stable" | "declining" = trend > 5 ? "growing" : trend < -5 ? "declining" : "stable";

    const lastMonthValue = recent.length > 0 ? recent[recent.length - 1] : 0;
    let peakIdx = 0;
    let peakVal = 0;
    monthlyValues.forEach((v, i) => { if (v > peakVal) { peakVal = v; peakIdx = i; } });

    skuRates.push({
      id: sku.id,
      name: sku.name,
      weight: sku.weight,
      category: sku.category ?? "Core",
      packagingType: (sku as any).packagingType ?? "New",
      flavor: extractFlavor(sku.name),
      monthlyValues,
      avg3m: Math.round(avg3m),
      avg6m: Math.round(avg6m),
      avgAll: Math.round(avgAll),
      trend,
      trendDirection,
      lastMonthValue: Math.round(lastMonthValue),
      peakMonth: periodLabels[peakIdx] || "",
      peakValue: Math.round(peakVal),
      monthsWithData,
    });
  }

  const byFlavor = new Map<string, { flavor: string; totalIms: number; avg3m: number; skuCount: number; trend: number }>();
  for (const sr of skuRates) {
    const existing = byFlavor.get(sr.flavor) || { flavor: sr.flavor, totalIms: 0, avg3m: 0, skuCount: 0, trend: 0 };
    existing.totalIms += sr.monthlyValues.reduce((a, b) => a + b, 0);
    existing.avg3m += sr.avg3m;
    existing.skuCount += 1;
    existing.trend += sr.trend;
    byFlavor.set(sr.flavor, existing);
  }
  const flavorSummary = Array.from(byFlavor.values()).map(f => ({
    ...f,
    trend: f.skuCount > 0 ? Math.round(f.trend / f.skuCount) : 0,
  })).sort((a, b) => b.totalIms - a.totalIms);

  const byWeight = new Map<string, { weight: string; totalIms: number; avg3m: number; skuCount: number; trend: number }>();
  for (const sr of skuRates) {
    const existing = byWeight.get(sr.weight) || { weight: sr.weight, totalIms: 0, avg3m: 0, skuCount: 0, trend: 0 };
    existing.totalIms += sr.monthlyValues.reduce((a, b) => a + b, 0);
    existing.avg3m += sr.avg3m;
    existing.skuCount += 1;
    existing.trend += sr.trend;
    byWeight.set(sr.weight, existing);
  }
  const weightSummary = Array.from(byWeight.values()).map(w => ({
    ...w,
    trend: w.skuCount > 0 ? Math.round(w.trend / w.skuCount) : 0,
  })).sort((a, b) => b.totalIms - a.totalIms);

  const totalIms = skuRates.reduce((s, r) => s + r.monthlyValues.reduce((a, b) => a + b, 0), 0);
  const totalAvg3m = skuRates.reduce((s, r) => s + r.avg3m, 0);
  const overallTrend = skuRates.length > 0 ? Math.round(skuRates.reduce((s, r) => s + r.trend, 0) / skuRates.length) : 0;

  const monthlyTotals = sortedPeriods.map((_, i) => skuRates.reduce((s, r) => s + r.monthlyValues[i], 0));

  return {
    periodLabels,
    skuRates,
    flavorSummary,
    weightSummary,
    totalIms: Math.round(totalIms),
    totalAvg3m: Math.round(totalAvg3m),
    overallTrend,
    monthlyTotals,
    totalSkus: skuRates.length,
  };
}

// ==================== STOCK LEVEL ANALYSIS ====================
export async function getStockLevelAnalysis(country: "Lebanon" | "Syria" | "Libya") {
  const db = await getDb();
  if (!db) return null;

  const skuList = await getSkusForCountry(country);
  const skuIds = skuList.map(s => s.id);
  if (skuIds.length === 0) return null;

  const periodList = await getPeriodsForCountry(country);
  const planningRows = await db.select().from(planningFgData).where(inArray(planningFgData.skuId, skuIds));
  const imsRows = await db.select().from(imsData).where(inArray(imsData.skuId, skuIds));
  const forecastRows = await db.select().from(forecastData).where(inArray(forecastData.skuId, skuIds));

  const skuMap = new Map(skuList.map(s => [s.id, s]));
  const sortedPeriods = [...periodList].sort((a, b) => a.sortOrder - b.sortOrder);
  const periodLabels = sortedPeriods.map(p => p.label);

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const classifyZone = (weeks: number): string => {
    if (!isFinite(weeks) && weeks > 0) return "Overstock";
    if (!isFinite(weeks) && weeks < 0) return "Negative";
    if (weeks === 0) return "Out of Stock";
    if (weeks < 0) return "Negative";
    if (weeks < 4) return "Critical";
    if (weeks <= 6) return "Healthy";
    return "Overstock";
  };

  const zoneColors: Record<string, string> = {
    "Out of Stock": "#6b7280",
    "Negative": "#111827",
    "Critical": "#dc2626",
    "Healthy": "#16a34a",
    "Overstock": "#ea580c",
  };

  type SkuStockData = {
    id: number;
    name: string;
    weight: string;
    category: string;
    packagingType: string;
    closingStocks: number[];
    weeksOfStock: number[];
    zones: string[];
    currentClosingStock: number;
    currentWeeks: number;
    currentZone: string;
    avgWeeks: number;
    healthScore: number;
    coverageMonths: number;
    monthlyIms: number[];
    monthlyArrivals: number[];
  };

  const skuStocks: SkuStockData[] = [];

  for (const sku of skuList) {
    let prevCS = 0;
    const closingStocks: number[] = [];
    const weeksArr: number[] = [];
    const zonesArr: string[] = [];
    const monthlyIms: number[] = [];
    const monthlyArrivals: number[] = [];

    for (let i = 0; i < sortedPeriods.length; i++) {
      const p = sortedPeriods[i];
      const pf = planningRows.find(d => d.skuId === sku.id && d.periodId === p.id);
      const imsVal = parseFloat(imsRows.find(d => d.skuId === sku.id && d.periodId === p.id)?.value ?? "0") || 0;

      const effIms = imsVal !== 0 ? imsVal : (() => {
        if (p.year > curYear || (p.year === curYear && p.month > curMonth))
          return parseFloat(forecastRows.find(f => f.skuId === sku.id && f.periodId === p.id)?.value ?? "0") || 0;
        return 0;
      })();

      const opening = i === 0 ? (parseFloat(pf?.openingStock ?? "0") || 0) : prevCS;
      const adj = parseFloat(pf?.adjustments ?? "0") || 0;
      const arr = parseFloat(pf?.arrivals ?? "0") || 0;
      const cs = opening + adj + arr - effIms;

      let weeks = 0;
      if (cs !== 0) {
        const getEff = (idx: number) => {
          if (idx >= sortedPeriods.length) return 0;
          const pp = sortedPeriods[idx];
          const iv = parseFloat(imsRows.find(d => d.skuId === sku.id && d.periodId === pp.id)?.value ?? "0") || 0;
          if (iv !== 0) return iv;
          if (pp.year > curYear || (pp.year === curYear && pp.month > curMonth))
            return parseFloat(forecastRows.find(f => f.skuId === sku.id && f.periodId === pp.id)?.value ?? "0") || 0;
          return 0;
        };
        const n1 = getEff(i + 1);
        const n2 = getEff(i + 2);
        const avgN = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
        weeks = avgN !== 0 ? (cs / avgN) * 4.3 : (cs > 0 ? Infinity : -Infinity);
      }

      closingStocks.push(Math.round(cs));
      weeksArr.push(isFinite(weeks) ? Math.round(weeks * 10) / 10 : (weeks > 0 ? 99 : -99));
      zonesArr.push(classifyZone(weeks));
      monthlyIms.push(Math.round(effIms));
      monthlyArrivals.push(Math.round(arr));
      prevCS = cs;
    }

    const currentIdx = sortedPeriods.findIndex(p =>
      (p.year === curYear && p.month === curMonth) ||
      (p.year > curYear || (p.year === curYear && p.month > curMonth))
    );
    const cIdx = currentIdx >= 0 ? currentIdx : sortedPeriods.length - 1;

    const validWeeks = weeksArr.filter(w => Math.abs(w) < 99);
    const avgWeeks = validWeeks.length > 0 ? validWeeks.reduce((a, b) => a + b, 0) / validWeeks.length : 0;
    const healthyCount = zonesArr.filter(z => z === "Healthy").length;
    const healthScore = zonesArr.length > 0 ? Math.round((healthyCount / zonesArr.length) * 100) : 0;

    const avg3mIms = monthlyIms.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const coverageMonths = avg3mIms > 0 ? Math.round((closingStocks[cIdx] / avg3mIms) * 10) / 10 : 0;

    skuStocks.push({
      id: sku.id,
      name: sku.name,
      weight: sku.weight,
      category: sku.category ?? "Core",
      packagingType: (sku as any).packagingType ?? "New",
      closingStocks,
      weeksOfStock: weeksArr,
      zones: zonesArr,
      currentClosingStock: closingStocks[cIdx] || 0,
      currentWeeks: weeksArr[cIdx] || 0,
      currentZone: zonesArr[cIdx] || "Unknown",
      avgWeeks: Math.round(avgWeeks * 10) / 10,
      healthScore,
      coverageMonths,
      monthlyIms,
      monthlyArrivals,
    });
  }

  const zoneCounts: Record<string, number> = {};
  const currentPeriodIdx = sortedPeriods.findIndex(p => p.year === curYear && p.month === curMonth);
  const activeIdx = currentPeriodIdx >= 0 ? currentPeriodIdx : sortedPeriods.length - 1;
  for (const ss of skuStocks) {
    const zone = ss.zones[activeIdx] || "Unknown";
    zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
  }
  const zoneDistribution = Object.entries(zoneCounts).map(([zone, count]) => ({
    zone,
    count,
    percentage: skuStocks.length > 0 ? Math.round((count / skuStocks.length) * 100) : 0,
    color: zoneColors[zone] || "#6b7280",
  }));

  const periodZones = sortedPeriods.map((p, pIdx) => {
    const counts: Record<string, number> = {};
    for (const ss of skuStocks) {
      const zone = ss.zones[pIdx] || "Unknown";
      counts[zone] = (counts[zone] || 0) + 1;
    }
    return { period: p.label, zones: counts };
  });

  const byWeight = new Map<string, { totalStock: number; avgWeeks: number; count: number }>();
  for (const ss of skuStocks) {
    const existing = byWeight.get(ss.weight) || { totalStock: 0, avgWeeks: 0, count: 0 };
    existing.totalStock += ss.currentClosingStock;
    existing.avgWeeks += ss.currentWeeks;
    existing.count += 1;
    byWeight.set(ss.weight, existing);
  }
  const weightStockSummary = Array.from(byWeight.entries()).map(([weight, d]) => ({
    weight,
    totalStock: d.totalStock,
    avgWeeks: d.count > 0 ? Math.round((d.avgWeeks / d.count) * 10) / 10 : 0,
    skuCount: d.count,
  }));

  const totalClosingStock = skuStocks.reduce((s, r) => s + r.currentClosingStock, 0);
  const avgWeeksAll = skuStocks.length > 0
    ? Math.round((skuStocks.reduce((s, r) => s + (Math.abs(r.currentWeeks) < 99 ? r.currentWeeks : 0), 0) / skuStocks.length) * 10) / 10
    : 0;
  const avgHealthScore = skuStocks.length > 0
    ? Math.round(skuStocks.reduce((s, r) => s + r.healthScore, 0) / skuStocks.length)
    : 0;

  return {
    periodLabels,
    skuStocks,
    zoneDistribution,
    periodZones,
    weightStockSummary,
    totalClosingStock,
    avgWeeksAll,
    avgHealthScore,
    totalSkus: skuStocks.length,
    zoneColors,
  };
}

/** Row type for the expiry dashboard */
type ExpiryRow = {
  skuId: number;
  skuName: string;
  weight: string;
  category: string;
  packagingType: string;
  productionPeriodId: number;
  productionPeriodLabel: string;
  productionDate: string;
  expiryDate: string;
  producedQty: number;
  clearedQty: number;
  atPortQty: number;
  soldQty: number;
  inCountryQty: number;
  totalRemaining: number;
  monthsUntilExpiry: number;
  alertTier: "Expired" | "2M" | "4M" | "6M" | "9M" | "12M" | "18M" | "24M" | "OK";
};
