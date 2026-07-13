import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// This file guards the country-scoping safety net on the in-app bulk-save
// tRPC mutations (upload.forecast / imsActuals / openingStock / shipment /
// arrival / planningFgBulk in server/routers.ts).
//
// The Excel import already aborts loudly if a resolved SKU or period id would
// land under the wrong country (assertRecordsScopedToCountry, now shared via
// server/countryScope.ts). These tests prove the same guarantee holds for the
// bulk-save endpoints: if any skuId/periodId in the batch does not belong to
// the requested country, the whole save is rejected and NOTHING is written.
//
// Setup mirrors excelImport.countryScoping.test.ts: two countries share a SKU
// name ("Double Apple") and a period label ("Apr 25") but use disjoint ID
// spaces. We poison the FIRST call to a country-scoped getter (the one used
// for name→id resolution) so it returns the WRONG country's rows, while the
// guard's own fresh fetch returns the right rows — the save must abort before
// any bulkUpsert / upsert write.
// ---------------------------------------------------------------------------

interface SeedSku {
  id: number;
  name: string;
  weight: string;
  packagingType: string;
  isActive: boolean;
}
interface SeedPeriod {
  id: number;
  label: string;
  year: number;
  month: number;
}

const SEED: Record<string, { skus: SeedSku[]; periods: SeedPeriod[] }> = {
  Lebanon: {
    skus: [
      { id: 101, name: "Double Apple", weight: "250g", packagingType: "New", isActive: true },
    ],
    periods: [{ id: 201, label: "Apr 25", year: 2025, month: 4 }],
  },
  Syria: {
    skus: [
      { id: 301, name: "Double Apple", weight: "250g", packagingType: "New", isActive: true },
    ],
    periods: [{ id: 401, label: "Apr 25", year: 2025, month: 4 }],
  },
};

vi.mock("./db", () => {
  return {
    logAudit: vi.fn(async () => undefined),
    getSkusForCountry: vi.fn(async (country: string) => SEED[country]?.skus ?? []),
    getPeriodsForCountry: vi.fn(async (country: string) => SEED[country]?.periods ?? []),
    ensurePeriods: vi.fn(async () => undefined),
    createSkuForCountry: vi.fn(async () => ({ id: 999 })),
    // Admin gate: the test caller is an owner so requireCountryAdmin passes.
    getAppUserByUsername: vi.fn(async () => ({
      id: 1,
      username: "Test Admin",
      isOwner: true,
      countries: null,
    })),
    // Write sinks — the assertions inspect these.
    bulkUpsertForecast: vi.fn(async () => undefined),
    bulkUpsertIms: vi.fn(async () => undefined),
    bulkUpsertShipment: vi.fn(async () => undefined),
    bulkUpsertArrival: vi.fn(async () => undefined),
    bulkUpsertPlanningFg: vi.fn(async () => undefined),
    upsertPlanningFgData: vi.fn(async () => undefined),
  };
});

// Import AFTER vi.mock so the router picks up the mocked db helpers.
const { appRouter } = await import("./routers");
const dbModule = await import("./db");
import type { TrpcContext } from "./_core/context";

const writeMocks = {
  forecast: vi.mocked(dbModule.bulkUpsertForecast),
  ims: vi.mocked(dbModule.bulkUpsertIms),
  shipment: vi.mocked(dbModule.bulkUpsertShipment),
  arrival: vi.mocked(dbModule.bulkUpsertArrival),
  planningFg: vi.mocked(dbModule.bulkUpsertPlanningFg),
  planningFgSingle: vi.mocked(dbModule.upsertPlanningFgData),
};

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 2, openId: "test-admin", email: "admin@example.com", name: "Test Admin",
      loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

type WrittenRow = { skuId: number; periodId: number };

/** Gather every (skuId, periodId) pair written across all write mocks. */
function collectWrittenRows(): WrittenRow[] {
  const rows: WrittenRow[] = [];
  for (const [name, mock] of Object.entries(writeMocks)) {
    for (const call of mock.mock.calls) {
      if (name === "planningFgSingle") {
        rows.push({ skuId: call[0] as number, periodId: call[1] as number });
      } else {
        for (const rec of call[0] as WrittenRow[]) {
          rows.push({ skuId: rec.skuId, periodId: rec.periodId });
        }
      }
    }
  }
  return rows;
}

function expectNoWrites() {
  for (const mock of Object.values(writeMocks)) {
    expect(mock).not.toHaveBeenCalled();
  }
}

function assertScopedTo(target: string, foreign: string) {
  const ownSkuIds = new Set(SEED[target].skus.map((s) => s.id));
  const ownPeriodIds = new Set(SEED[target].periods.map((p) => p.id));
  const foreignSkuIds = new Set(SEED[foreign].skus.map((s) => s.id));
  const foreignPeriodIds = new Set(SEED[foreign].periods.map((p) => p.id));

  const rows = collectWrittenRows();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(ownSkuIds.has(row.skuId)).toBe(true);
    expect(ownPeriodIds.has(row.periodId)).toBe(true);
    expect(foreignSkuIds.has(row.skuId)).toBe(false);
    expect(foreignPeriodIds.has(row.periodId)).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Payload builders — one per bulk-save mutation
// ---------------------------------------------------------------------------

function caller() {
  return appRouter.createCaller(createAdminContext());
}

const mutations: { name: string; run: (country: string) => Promise<unknown> }[] = [
  {
    name: "upload.forecast",
    run: (country) => caller().upload.forecast({
      country,
      records: [{ skuName: "Double Apple", weight: "250g", values: [{ year: 2025, month: 4, value: "100" }] }],
    }),
  },
  {
    name: "upload.imsActuals",
    run: (country) => caller().upload.imsActuals({
      country,
      records: [{ skuName: "Double Apple", values: [{ year: 2025, month: 4, value: "80", isActual: true }] }],
    }),
  },
  {
    name: "upload.openingStock",
    run: (country) => caller().upload.openingStock({
      country,
      records: [{ skuName: "Double Apple", value: "50", periodYear: 2025, periodMonth: 4 }],
    }),
  },
  {
    name: "upload.shipment",
    run: (country) => caller().upload.shipment({
      country,
      records: [{ skuName: "Double Apple", values: [{ year: 2025, month: 4, week1: "10", week2: "20", week3: "30", week4: "40" }] }],
    }),
  },
  {
    name: "upload.arrival",
    run: (country) => caller().upload.arrival({
      country,
      records: [{ skuName: "Double Apple", values: [{ year: 2025, month: 4, week1: "11", week2: "21", week3: "31", week4: "41" }] }],
    }),
  },
  {
    name: "upload.planningFgBulk",
    run: (country) => caller().upload.planningFgBulk({
      country,
      records: [{ skuName: "Double Apple", weight: "250g", values: [{ year: 2025, month: 4, openingStock: "50", adjustments: "5", ims: "10" }] }],
    }),
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bulk-save mutations: wrong-country safety net", () => {
  for (const m of mutations) {
    it(`${m.name}: a Lebanon save writes only Lebanon ids`, async () => {
      await m.run("Lebanon");
      assertScopedTo("Lebanon", "Syria");
    });

    it(`${m.name}: a Syria save writes only Syria ids`, async () => {
      await m.run("Syria");
      assertScopedTo("Syria", "Lebanon");
    });

    it(`${m.name}: rejects the whole save (no writes) when a foreign SKU id would be written`, async () => {
      // Poison the resolution phase: the first country-scoped SKU fetch
      // returns SYRIA's SKUs while saving for Lebanon, so the batch carries a
      // foreign skuId. The guard's own fresh fetch stays correct and must
      // abort the save before any write.
      vi.mocked(dbModule.getSkusForCountry).mockImplementationOnce(
        (async () => SEED.Syria.skus) as unknown as typeof dbModule.getSkusForCountry,
      );
      await expect(m.run("Lebanon")).rejects.toThrow(/does not belong to Lebanon/);
      expectNoWrites();
    });

    it(`${m.name}: rejects the whole save (no writes) when a foreign period id would be written`, async () => {
      vi.mocked(dbModule.getPeriodsForCountry).mockImplementationOnce(
        (async () => SEED.Syria.periods) as unknown as typeof dbModule.getPeriodsForCountry,
      );
      await expect(m.run("Lebanon")).rejects.toThrow(/does not belong to Lebanon/);
      expectNoWrites();
    });
  }
});
