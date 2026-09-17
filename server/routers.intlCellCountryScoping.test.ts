import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Guards the country-scoping safety net on the PER-CELL edit mutations in the
// `country.*` router (server/routers.ts) used by the Syria/Libya/KSA intl
// pages: updateForecast / updateForecastWeek / updateActualProduction /
// updateProduction / updateProductionRefs / updateArrival /
// updateArrivalStatus / updateClearedQty / updateClearedDate /
// updatePendingClearDate / addClearanceEvent / updateClearanceEvent /
// deleteClearanceEvent / updateIms / updatePlanningFgCell.
//
// These mutations already required access to the posted country, but access
// alone is not enough: a user with access to BOTH Syria and Libya could (via
// a stale or buggy client) post a Libya skuId/periodId under country=Syria
// and silently corrupt the other market's data. Each mutation now calls
// assertRecordsScopedToCountry before any write, so a foreign id aborts the
// mutation with zero writes — the same guarantee the Lebanon per-cell
// mutations get in routers.cellCountryScoping.test.ts.
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
  Syria: {
    skus: [
      { id: 301, name: "Double Apple", weight: "250g", packagingType: "New", isActive: true },
    ],
    periods: [
      { id: 401, label: "Apr 25", year: 2025, month: 4 },
      { id: 402, label: "May 25", year: 2025, month: 5 },
    ],
  },
  Libya: {
    skus: [
      { id: 501, name: "Double Apple", weight: "250g", packagingType: "New", isActive: true },
    ],
    periods: [{ id: 601, label: "Apr 25", year: 2025, month: 4 }],
  },
};

vi.mock("./db", () => {
  return {
    logAudit: vi.fn(async () => undefined),
    getSkusForCountry: vi.fn(async (country: string) => SEED[country]?.skus ?? []),
    getPeriodsForCountry: vi.fn(async (country: string) => SEED[country]?.periods ?? []),
    // Country-access gate: the test caller is an owner so requireCountryAccess passes.
    getAppUserByUsername: vi.fn(async () => ({
      id: 1,
      username: "Test Admin",
      isOwner: true,
      countries: null,
    })),
    // Read used by updateForecastWeek after its first write.
    getForecastCellValue: vi.fn(async () => ({ value: "5" })),
    // Write sinks — the assertions inspect these.
    upsertForecastData: vi.fn(async () => undefined),
    upsertActualProductionData: vi.fn(async () => undefined),
    upsertShipmentData: vi.fn(async () => undefined),
    upsertArrivalData: vi.fn(async () => undefined),
    upsertImsData: vi.fn(async () => undefined),
    upsertCountryPlanningFgCell: vi.fn(async () => undefined),
    updateShipmentArrivalStatus: vi.fn(async () => undefined),
    updateShipmentClearedQty: vi.fn(async () => ({ autoStatus: "Cleared" })),
    updateShipmentClearedDate: vi.fn(async () => undefined),
    updateShipmentPendingClearDate: vi.fn(async () => undefined),
    addClearanceEvent: vi.fn(async () => 1),
    updateClearanceEvent: vi.fn(async () => undefined),
    deleteClearanceEvent: vi.fn(async () => undefined),
  };
});

// Import AFTER vi.mock so the router picks up the mocked db helpers.
const { appRouter } = await import("./routers");
const dbModule = await import("./db");
import type { TrpcContext } from "./_core/context";

const writeMocks = {
  forecast: vi.mocked(dbModule.upsertForecastData),
  actualProduction: vi.mocked(dbModule.upsertActualProductionData),
  shipment: vi.mocked(dbModule.upsertShipmentData),
  arrival: vi.mocked(dbModule.upsertArrivalData),
  ims: vi.mocked(dbModule.upsertImsData),
  planningFg: vi.mocked(dbModule.upsertCountryPlanningFgCell),
  arrivalStatus: vi.mocked(dbModule.updateShipmentArrivalStatus),
  clearedQty: vi.mocked(dbModule.updateShipmentClearedQty),
  clearedDate: vi.mocked(dbModule.updateShipmentClearedDate),
  pendingClearDate: vi.mocked(dbModule.updateShipmentPendingClearDate),
  addClearance: vi.mocked(dbModule.addClearanceEvent),
  updateClearance: vi.mocked(dbModule.updateClearanceEvent),
  deleteClearance: vi.mocked(dbModule.deleteClearanceEvent),
};

function createOwnerContext(): TrpcContext {
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

function expectNoWrites() {
  for (const mock of Object.values(writeMocks)) {
    expect(mock).not.toHaveBeenCalled();
  }
}

function expectSomeWrite() {
  const total = Object.values(writeMocks).reduce(
    (sum, mock) => sum + mock.mock.calls.length,
    0,
  );
  expect(total).toBeGreaterThan(0);
}

function caller() {
  return appRouter.createCaller(createOwnerContext());
}

type Country = "Lebanon" | "Syria" | "Libya" | "KSA";

// Each entry runs its mutation posting the given ids as a Syria edit.
const mutations: {
  name: string;
  run: (ids: { skuId: number; periodId: number; country: Country }) => Promise<unknown>;
}[] = [
  {
    name: "country.updateForecast",
    run: (ids) => caller().country.updateForecast({ ...ids, value: "10" }),
  },
  {
    name: "country.updateForecastWeek",
    run: (ids) => caller().country.updateForecastWeek({ ...ids, targetWeek: "week2" }),
  },
  {
    name: "country.updateActualProduction",
    run: (ids) => caller().country.updateActualProduction({ ...ids, value: "8" }),
  },
  {
    name: "country.updateProduction",
    run: (ids) =>
      caller().country.updateProduction({ ...ids, week1: "1", week2: "2", week3: "3", week4: "4" }),
  },
  {
    name: "country.updateProductionRefs",
    run: (ids) => caller().country.updateProductionRefs({ ...ids, invoiceRef: "INV-1" }),
  },
  {
    name: "country.updateArrival",
    run: (ids) =>
      caller().country.updateArrival({ ...ids, week1: "1", week2: "2", week3: "3", week4: "4" }),
  },
  {
    name: "country.updateArrivalStatus",
    run: (ids) => caller().country.updateArrivalStatus({ ...ids, status: "In Transit" }),
  },
  {
    name: "country.updateClearedQty",
    run: (ids) => caller().country.updateClearedQty({ ...ids, clearedQty: 5, totalQty: 10 }),
  },
  {
    name: "country.updateClearedDate",
    run: (ids) => caller().country.updateClearedDate({ ...ids, clearedDate: "2025-04-15" }),
  },
  {
    name: "country.updatePendingClearDate",
    run: (ids) => caller().country.updatePendingClearDate({ ...ids, pendingClearDate: "2025-04-20" }),
  },
  {
    name: "country.addClearanceEvent",
    run: (ids) =>
      caller().country.addClearanceEvent({ ...ids, clearedQty: "5", clearedDate: "2025-04-15" }),
  },
  {
    name: "country.updateClearanceEvent",
    run: (ids) =>
      caller().country.updateClearanceEvent({ ...ids, eventId: 7, clearedQty: "6" }),
  },
  {
    name: "country.deleteClearanceEvent",
    run: (ids) => caller().country.deleteClearanceEvent({ ...ids, eventId: 7 }),
  },
  {
    name: "country.updateIms",
    run: (ids) => caller().country.updateIms({ ...ids, value: "12" }),
  },
  {
    name: "country.updatePlanningFgCell",
    run: (ids) => caller().country.updatePlanningFgCell({ ...ids, label: "Opening Stock", value: "40" }),
  },
];

const SY = { skuId: 301, periodId: 401 };
const FOREIGN_SKU = { skuId: 501, periodId: 401 }; // Libya SKU id posted against Syria
const FOREIGN_PERIOD = { skuId: 301, periodId: 601 }; // Libya period id posted against Syria

describe("country.* per-cell edit mutations: wrong-country safety net", () => {
  for (const m of mutations) {
    it(`${m.name}: accepts a Syria edit with Syria ids`, async () => {
      await m.run({ ...SY, country: "Syria" });
      expectSomeWrite();
    });

    it(`${m.name}: rejects (no writes) when the skuId belongs to another country`, async () => {
      await expect(m.run({ ...FOREIGN_SKU, country: "Syria" })).rejects.toThrow(
        /does not belong to Syria/,
      );
      expectNoWrites();
    });

    it(`${m.name}: rejects (no writes) when the periodId belongs to another country`, async () => {
      await expect(m.run({ ...FOREIGN_PERIOD, country: "Syria" })).rejects.toThrow(
        /does not belong to Syria/,
      );
      expectNoWrites();
    });
  }
});
