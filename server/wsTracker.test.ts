import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPlan, buildPlan, resolveTrackerSku, validateTrackerFeed, type Feed } from "./wsTracker";
import { getPool } from "./db";
import { buildStockLedger } from "../shared/performance/stock";

const data = vi.hoisted(() => ({ skus: [] as any[], periods: [] as any[], ims: [] as any[],
  arrival: [] as any[], shipment: [] as any[], events: [] as any[], forecast: [] as any[], actual: [] as any[], foc: [] as any[] }));
vi.mock("./focPlanning", () => ({ getFocPlanning: vi.fn(async () => ({ cells: data.foc })) }));
vi.mock("./db", () => ({
  getSkusForCountry: vi.fn(async () => data.skus), getPeriodsForCountry: vi.fn(async () => data.periods),
  getImsDataForCountry: vi.fn(async () => data.ims), getArrivalDataForCountry: vi.fn(async () => data.arrival),
  getShipmentDataForCountry: vi.fn(async () => data.shipment), getClearanceEventsForCountry: vi.fn(async () => data.events),
  getForecastDataForCountry: vi.fn(async () => data.forecast), getActualProductionDataForCountry: vi.fn(async () => data.actual),
  getPool: vi.fn(),
}));
const product = { flavour: "Red", format: "50g" };
function feed(): Feed {
  return { country: "Syria", unit: "MC", generatedAt: "2026-10-10",
    period: { from: "2026-10", to: "2026-10", firstMovement: "2026-10-05", lastMovement: "2026-10-05" },
    products: [{ ...product, trackerProducts: [] }], ims: [{ ...product, month: "2026-10", qty: 20 }],
    arrivals: [{ ...product, month: "2026-10", week: 1, qty: 110 }],
    arrivalMovements: [{ ...product, date: "2026-10-05", qty: 110 }], totals: { ims: 20, arrivals: 110 } };
}
beforeEach(() => {
  vi.clearAllMocks();
  data.skus = [{ id: 1, country: "Syria", name: "Double Apple", weight: "50g", packagingType: "Old", isActive: true },
    { id: 2, country: "Syria", name: "Double Apple", weight: "50g", packagingType: "New", isActive: true },
    { id: 3, country: "Syria", name: "Mint", weight: "50g", packagingType: "New", isActive: true }];
  data.periods = [{ id: 10, country: "Syria", year: 2026, month: 10, label: "Oct 26", sortOrder: 1 }];
  data.ims = []; data.arrival = []; data.shipment = []; data.events = []; data.actual = []; data.foc = [];
  data.forecast = [{ skuId: 1, periodId: 10, value: "100" }];
});

describe("strict packaging and complete tracker planning", () => {
  it("resolves Old and New separately and never uses name-weight fallback or arbitrary ambiguous packaging", async () => {
    expect(resolveTrackerSku(product, data.skus)?.id).toBe(1);
    expect(resolveTrackerSku({ flavour: "Two Apples Black", format: "50g" }, data.skus)?.id).toBe(2);
    data.skus = data.skus.filter(s => s.id !== 1);
    const p = await buildPlan(feed());
    expect(p.rows).toEqual([]);
    expect(p.clearance.events).toEqual([]);
    expect(p.unmatchedProducts[0].flavour).toBe("Red");
    expect(resolveTrackerSku({ flavour: "Two Apples Black", format: "50g" }, [...data.skus, { ...data.skus[0], id: 99 }])).toBeUndefined();
    expect(resolveTrackerSku(product, [{ name: "Double Apple", weight: "50g", packagingType: null }])).toBeUndefined();
  });
  it("does not zero an SSOF SKU absent from the published product population", async () => {
    data.ims = [{ skuId: 2, periodId: 10, value: "77" }];
    expect((await buildPlan(feed())).rows.some(r => r.skuId === 2)).toBe(false);
  });
  it("sums historical aliases before writing a destination cell", async () => {
    data.skus.push({ id: 4, name: "Double Apple Frosty", weight: "50g", packagingType: "New" });
    const f = feed(), a = { flavour: "Two Apples Iced", format: "50g" }, b = { flavour: "Two Apples Frosty", format: "50g" };
    f.products = [{ ...a, trackerProducts: [] }, { ...b, trackerProducts: [] }];
    f.ims = [{ ...a, month: "2026-10", qty: 3 }, { ...b, month: "2026-10", qty: 4 }];
    f.arrivals = []; f.arrivalMovements = []; f.totals = { ims: 7, arrivals: 0 };
    const rows = (await buildPlan(f)).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ skuId: 4, next: 7 });
  });
  it("reports missing delivery-month periods even if the production batch exists", async () => {
    data.periods.push({ id: 9, country: "Syria", year: 2026, month: 9, label: "Sep", sortOrder: 0 });
    data.forecast[0].periodId = 9;
    data.periods = data.periods.filter(p => p.id !== 10);
    const p = await buildPlan(feed());
    expect(p.clearance.overflow[0].qty).toBe(110);
    await expect(applyPlan(p)).rejects.toThrow("no Syria period");
    expect(getPool).not.toHaveBeenCalled();
  });
  it("reports early deliveries and keeps their full quantity on their actual date", async () => {
    data.forecast = [];
    const p = await buildPlan(feed());
    expect(p.clearance.beforeProduction?.[0].qty).toBe(110);
    expect(p.clearance.events[0]).toMatchObject({ date: "2026-10-05", qty: 110, periodId: 10 });
  });
  it("rejects inconsistent inbound representations, invalid dates, units and quantities", () => {
    const f = feed(); f.arrivalMovements[0].qty = 109;
    expect(() => validateTrackerFeed(f)).toThrow("disagree");
    f.arrivalMovements[0].qty = 110; f.arrivalMovements[0].date = "2026-10-32";
    expect(() => validateTrackerFeed(f)).toThrow("Invalid tracker delivery");
    expect(() => validateTrackerFeed({ ...feed(), unit: "Tons" })).toThrow("units");
    const bad = feed(); bad.ims[0].qty = NaN;
    expect(() => validateTrackerFeed(bad)).toThrow("quantity");
  });
});

function installPool(failClearance = false) {
  let saved: any;
  const queries: string[] = [], audits: any[] = [], summaries: any[] = [];
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    queries.push(sql);
    if (sql === "BEGIN") saved = structuredClone(data);
    if (sql === "ROLLBACK") Object.assign(data, saved);
    if (sql.startsWith("SELECT id FROM skus")) return { rows: data.skus.filter(s => s.country === params[0] && params[1].includes(s.id)).map(s => ({ id: s.id })) };
    if (sql.startsWith("SELECT id,year,month")) return { rows: data.periods };
    if (sql.startsWith("SELECT * FROM clearance")) return { rows: data.events.filter(e => e.country === params[0]) };
    if (sql.startsWith("SELECT * FROM ims")) return { rows: data.ims };
    if (sql.startsWith("SELECT * FROM arrival")) return { rows: data.arrival };
    if (sql.startsWith("SELECT * FROM shipment")) return { rows: data.shipment };
    if (sql.startsWith("SELECT * FROM forecast")) return { rows: data.forecast };
    if (sql.startsWith("SELECT * FROM actual_production")) return { rows: data.actual };
    if (sql.startsWith("SELECT * FROM foc")) return { rows: data.foc };
    if (sql.startsWith("INSERT INTO ims_data")) data.ims = [...data.ims.filter(r => r.skuId !== params[0] || r.periodId !== params[1]),
      { skuId: params[0], periodId: params[1], value: params[2], isActual: params[3], source: "ws_tracker" }];
    if (sql.startsWith("INSERT INTO arrival_data")) data.arrival = [...data.arrival.filter(r => r.skuId !== params[0] || r.periodId !== params[1]),
      { skuId: params[0], periodId: params[1], week1: params[2], week2: params[3], week3: params[4], week4: params[5] }];
    if (sql.startsWith("DELETE FROM clearance")) data.events = data.events.filter(e => !params[0].includes(e.id));
    if (sql.startsWith("INSERT INTO clearance_events")) {
      if (failClearance) throw new Error("simulated insert failure");
      data.events.push({ id: 1000 + data.events.length, skuId: params[0], periodId: params[1], country: "Syria",
        clearedQty: params[2], clearedDate: params[3], notes: "WS Tracker", containerRef: "WST" });
    }
    if (sql.startsWith("INSERT INTO audit_trail")) audits.push(JSON.parse(params[1]));
    if (sql.startsWith("INSERT INTO shipment_data")) summaries.push(params);
    return { rows: [] };
  });
  const release = vi.fn();
  vi.mocked(getPool).mockResolvedValue({ connect: async () => ({ query, release }) } as any);
  return { queries, audits, summaries, release };
}

describe("transactional Syria sync ownership and single inbound stock path", () => {
  it("links Full Production 110 to clearance 110, never an extra 10 FOC receipt", async () => {
    data.foc = [{ country: "Syria", skuId: 1, periodId: 10, value: "10", received: true }];
    const focBefore = structuredClone(data.foc);
    const pool = installPool();
    await applyPlan(await buildPlan(feed()));
    expect(pool.summaries[0]).toEqual([1, 10, 110]);
    expect(data.foc).toEqual(focBefore);
    const ledger = buildStockLedger({ country: "Syria", now: new Date(), skus: data.skus, periods: data.periods,
      ims: data.ims, arrival: data.arrival, forecast: data.forecast, planningFg: [], clearanceEvents: data.events, foc: data.foc });
    expect(ledger.bySku.get(1)?.get(10)).toMatchObject({ arrivals: 110, closing: 90 });
  });
  it("marks covered zero IMS as tracker actuals instead of retaining a forecast suggestion", async () => {
    const f = feed(); f.ims = []; f.totals.ims = 0;
    data.ims = [{ skuId: 1, periodId: 10, value: "0", source: "auto_forecast", isActual: false }];
    installPool();
    await applyPlan(await buildPlan(f));
    expect(data.ims[0]).toMatchObject({ source: "ws_tracker", isActual: true, value: "0" });
  });
  it("rejects a foreign SKU within the transaction rather than writing any of its cells", async () => {
    const p = await buildPlan(feed());
    data.skus[0].country = "Libya";
    const before = structuredClone(data);
    const pool = installPool();
    await expect(applyPlan(p)).rejects.toThrow("outside Syria");
    expect(data).toEqual(before);
    expect(pool.queries.some(q => q.startsWith("INSERT"))).toBe(false);
  });
  it("preserves manual, uncarried, foreign and outside-range events across two resyncs; counts inbound once", async () => {
    data.events = [
      { id: 1, country: "Syria", skuId: 1, periodId: 10, clearedDate: new Date("2026-10-05"), clearedQty: "110", notes: "WS Tracker", containerRef: "WST" },
      { id: 2, country: "Syria", skuId: 1, periodId: 10, clearedDate: "2026-10-09", clearedQty: "3", notes: "Manual", containerRef: null },
      { id: 3, country: "Syria", skuId: 3, periodId: 10, clearedDate: "2026-10-09", clearedQty: "5", notes: "Manual", containerRef: null },
      { id: 4, country: "Libya", skuId: 77, periodId: 10, clearedDate: "2026-10-05", clearedQty: "999", notes: "WS Tracker", containerRef: "WST" },
      { id: 5, country: "Syria", skuId: 1, periodId: 10, clearedDate: "2025-12-01", clearedQty: "7", notes: "WS Tracker", containerRef: "WST" },
    ];
    data.ims = [{ skuId: 1, periodId: 10, value: "999", source: "forecast" }];
    const preserved = structuredClone(data.events.slice(1));
    const pool = installPool();
    const p = await buildPlan(feed());
    expect(p.clearance.replacing).toBe(1);
    await applyPlan(p);
    await applyPlan(await buildPlan(feed()));
    expect(data.events.filter(e => e.id < 1000)).toEqual(preserved);
    expect(data.ims[0]).toMatchObject({ value: "20", source: "ws_tracker", isActual: true });
    const ledger = buildStockLedger({ country: "Syria", now: new Date(), skus: data.skus, periods: data.periods,
      ims: data.ims, arrival: data.arrival, forecast: [], planningFg: [], clearanceEvents: data.events,
      foc: [{ country: "Syria", skuId: 1, periodId: 10, value: "10", received: true }] });
    expect(ledger.bySku.get(1)?.get(10)).toMatchObject({ arrivals: 113, closing: 93 });
    expect(pool.audits[0].removedClearances).toHaveLength(1);
    expect(pool.audits[0].ims[0].value).toBe("999");
    expect(pool.release).toHaveBeenCalledTimes(2);
  });
  it("blocks possible manual/tracker duplicates before any write rather than erasing or counting both", async () => {
    data.events = [{ id: 8, country: "Syria", skuId: 1, periodId: 10, clearedDate: "2026-10-05", clearedQty: "110", notes: null, containerRef: null }];
    const before = structuredClone(data);
    const p = await buildPlan(feed());
    expect(p.clearance.conflicts).toHaveLength(1);
    await expect(applyPlan(p)).rejects.toThrow("overlaps");
    expect(data).toEqual(before);
    expect(getPool).not.toHaveBeenCalled();
  });
  it("rechecks conflicts after preview and rolls back every IMS/arrival change on failure", async () => {
    const p = await buildPlan(feed());
    const before = structuredClone(data);
    const pool = installPool(true);
    await expect(applyPlan(p)).rejects.toThrow("simulated");
    expect(data).toEqual(before);
    expect(pool.queries).toContain("ROLLBACK"); expect(pool.queries).not.toContain("COMMIT");
    const successPool = installPool();
    data.events.push({ id: 8, country: "Syria", skuId: 1, periodId: 10, clearedDate: "2026-10-05", clearedQty: "110" });
    await expect(applyPlan(p)).rejects.toThrow("overlap");
    expect(successPool.queries.some(q => q.startsWith("INSERT INTO ims"))).toBe(false);
  });
  it("uses the actual PostgreSQL schema and rolls back the entire rehearsal", async ({ skip }) => {
    const actualDb = await vi.importActual<typeof import("./db")>("./db");
    const pool = await actualDb.getPool();
    if (!pool) return skip();
    const skus = await actualDb.getSkusForCountry("Syria");
    const periods = await actualDb.getPeriodsForCountry("Syria");
    const old = skus.find(s => s.name === "Double Apple" && s.weight === "50g" && s.packagingType === "Old");
    const october = periods.find(p => p.year === 2026 && p.month === 10);
    if (!old || !october) return skip();
    data.skus = skus; data.periods = periods; data.forecast = [];
    const client = await pool.connect();
    let rolledBack = false;
    try {
      vi.mocked(getPool).mockResolvedValue({ connect: async () => ({
        query: async (sql: string, params?: any[]) => {
          if (sql === "COMMIT") { rolledBack = true; return client.query("ROLLBACK"); }
          return client.query(sql, params);
        },
        release: () => {},
      }) } as any);
      const p = await buildPlan(feed());
      const r = await applyPlan(p, "Development rollback rehearsal");
      expect(r.clearanceEvents).toBe(1);
      expect(rolledBack).toBe(true);
    } finally {
      if (!rolledBack) await client.query("ROLLBACK");
      client.release();
    }
  });
});
