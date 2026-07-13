import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Guards the country-scoping safety net on the PER-CELL edit mutations in
// server/routers.ts (update.imsCell / shipmentCell / arrivalCell /
// planningFgCell / invoicedSHP / syncPlanningFgArrival / syncImsAndForecast).
//
// The bulk-save endpoints already reject any save whose skuId/periodId does
// not belong to the requested country (see routers.countryScoping.test.ts).
// These tests prove the same guarantee now holds for single-cell edits: the
// client sends the country it is editing, the server re-validates the ids
// against that country's own SKU/period sets, and a foreign id aborts the
// mutation before ANY write. A stale client that omits `country` defaults to
// Lebanon server-side, so foreign ids are still rejected.
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
    periods: [
      { id: 201, label: "Apr 25", year: 2025, month: 4 },
      { id: 202, label: "May 25", year: 2025, month: 5 },
    ],
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
    // Country-access gate: the test caller is an owner so requireCountryAccess passes.
    getAppUserByUsername: vi.fn(async () => ({
      id: 1,
      username: "Test Admin",
      isOwner: true,
      countries: null,
    })),
    // Read used by invoicedSHP after its writes.
    getArrivalData: vi.fn(async () => []),
    // Write sinks — the assertions inspect these.
    upsertImsData: vi.fn(async () => undefined),
    upsertForecastData: vi.fn(async () => undefined),
    upsertShipmentData: vi.fn(async () => undefined),
    upsertArrivalData: vi.fn(async () => undefined),
    upsertPlanningFgData: vi.fn(async () => undefined),
  };
});

// Import AFTER vi.mock so the router picks up the mocked db helpers.
const { appRouter } = await import("./routers");
const dbModule = await import("./db");
import type { TrpcContext } from "./_core/context";

const writeMocks = {
  ims: vi.mocked(dbModule.upsertImsData),
  forecast: vi.mocked(dbModule.upsertForecastData),
  shipment: vi.mocked(dbModule.upsertShipmentData),
  arrival: vi.mocked(dbModule.upsertArrivalData),
  planningFg: vi.mocked(dbModule.upsertPlanningFgData),
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

// Each entry runs its mutation with the given ids for Lebanon.
const mutations: {
  name: string;
  run: (ids: { skuId: number; periodId: number; country?: string }) => Promise<unknown>;
}[] = [
  {
    name: "update.imsCell",
    run: (ids) => caller().update.imsCell({ ...ids, value: "10", isActual: true }),
  },
  {
    name: "update.shipmentCell",
    run: (ids) => caller().update.shipmentCell({ ...ids, week1: "5" }),
  },
  {
    name: "update.arrivalCell",
    run: (ids) => caller().update.arrivalCell({ ...ids, week2: "7" }),
  },
  {
    name: "update.planningFgCell",
    run: (ids) => caller().update.planningFgCell({ ...ids, openingStock: "40" }),
  },
  {
    name: "update.invoicedSHP",
    run: (ids) => caller().update.invoicedSHP({ ...ids, week1: 1, week2: 2, week3: 3, week4: 4 }),
  },
  {
    name: "update.syncPlanningFgArrival",
    run: (ids) => caller().update.syncPlanningFgArrival({ ...ids, value: "12" }),
  },
  {
    name: "update.syncImsAndForecast",
    run: (ids) => caller().update.syncImsAndForecast({ ...ids, value: "15" }),
  },
];

const LB = { skuId: 101, periodId: 201 };
const FOREIGN_SKU = { skuId: 301, periodId: 201 }; // Syria SKU id posted against Lebanon
const FOREIGN_PERIOD = { skuId: 101, periodId: 401 }; // Syria period id posted against Lebanon

describe("per-cell edit mutations: wrong-country safety net", () => {
  for (const m of mutations) {
    it(`${m.name}: accepts a Lebanon edit with Lebanon ids`, async () => {
      await m.run({ ...LB, country: "Lebanon" });
      expectSomeWrite();
    });

    it(`${m.name}: rejects (no writes) when the skuId belongs to another country`, async () => {
      await expect(m.run({ ...FOREIGN_SKU, country: "Lebanon" })).rejects.toThrow(
        /does not belong to Lebanon/,
      );
      expectNoWrites();
    });

    it(`${m.name}: rejects (no writes) when the periodId belongs to another country`, async () => {
      await expect(m.run({ ...FOREIGN_PERIOD, country: "Lebanon" })).rejects.toThrow(
        /does not belong to Lebanon/,
      );
      expectNoWrites();
    });

    it(`${m.name}: a stale client omitting country still cannot land foreign ids (defaults to Lebanon)`, async () => {
      await expect(m.run({ ...FOREIGN_SKU })).rejects.toThrow(
        /does not belong to Lebanon/,
      );
      expectNoWrites();
    });
  }
});
