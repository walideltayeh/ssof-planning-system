import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database module
vi.mock("./db", () => {
  let mockSkus: any[] = [];
  let mockPeriods: any[] = [];
  let mockForecastData: any[] = [];
  let mockImsData: any[] = [];
  let mockShipmentData: any[] = [];
  let mockArrivalData: any[] = [];
  let mockPlanningFgData: any[] = [];
  let mockUploadHistory: any[] = [];
  let nextSkuId = 1;
  let nextPeriodId = 1;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return {
    ensurePeriods: vi.fn(async () => {
      if (mockPeriods.length > 0) return mockPeriods;
      let sortOrder = 0;
      for (let year = 2025; year <= 2027; year++) {
        for (let month = 1; month <= 12; month++) {
          const shortYear = year.toString().slice(2);
          mockPeriods.push({
            id: nextPeriodId++,
            year, month,
            label: `${monthNames[month - 1]} ${shortYear}`,
            sortOrder: sortOrder++,
          });
        }
      }
      return mockPeriods;
    }),
    getAllPeriods: vi.fn(async () => mockPeriods),
    getPeriodsForCountry: vi.fn(async () => mockPeriods),
    getExistingYearsForFilter: vi.fn(async () => [2025, 2026, 2027]),
    getAllSkus: vi.fn(async () => mockSkus),
    getSkusForCountry: vi.fn(async (_country: string, _includeInactive?: boolean) => mockSkus),
    createSkuForCountry: vi.fn(async (_country: string, data: any) => {
      const id = nextSkuId++;
      const sku = { id, name: data.name, weight: data.weight, sortOrder: mockSkus.length, isExcludedFromTotal: data.isExcludedFromTotal || false, createdAt: new Date(), updatedAt: new Date() };
      mockSkus.push(sku);
      for (const p of mockPeriods) {
        mockForecastData.push({ id: mockForecastData.length + 1, skuId: id, periodId: p.id, value: "0", updatedAt: new Date() });
        mockImsData.push({ id: mockImsData.length + 1, skuId: id, periodId: p.id, value: "0", isActual: false, updatedAt: new Date() });
        mockShipmentData.push({ id: mockShipmentData.length + 1, skuId: id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0", updatedAt: new Date() });
        mockArrivalData.push({ id: mockArrivalData.length + 1, skuId: id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0", updatedAt: new Date() });
        mockPlanningFgData.push({ id: mockPlanningFgData.length + 1, skuId: id, periodId: p.id, openingStock: "0", adjustments: "0", updatedAt: new Date() });
      }
      return { id };
    }),
    createSku: vi.fn(async (data: any) => {
      const id = nextSkuId++;
      const sku = { id, name: data.name, weight: data.weight, sortOrder: mockSkus.length, isExcludedFromTotal: data.isExcludedFromTotal || false, createdAt: new Date(), updatedAt: new Date() };
      mockSkus.push(sku);
      // Initialize empty data for all periods
      for (const p of mockPeriods) {
        mockForecastData.push({ id: mockForecastData.length + 1, skuId: id, periodId: p.id, value: "0", updatedAt: new Date() });
        mockImsData.push({ id: mockImsData.length + 1, skuId: id, periodId: p.id, value: "0", isActual: false, updatedAt: new Date() });
        mockShipmentData.push({ id: mockShipmentData.length + 1, skuId: id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0", updatedAt: new Date() });
        mockArrivalData.push({ id: mockArrivalData.length + 1, skuId: id, periodId: p.id, week1: "0", week2: "0", week3: "0", week4: "0", updatedAt: new Date() });
        mockPlanningFgData.push({ id: mockPlanningFgData.length + 1, skuId: id, periodId: p.id, openingStock: "0", adjustments: "0", updatedAt: new Date() });
      }
      return { id };
    }),
    deleteSku: vi.fn(async (skuId: number) => {
      mockSkus = mockSkus.filter(s => s.id !== skuId);
      mockForecastData = mockForecastData.filter(d => d.skuId !== skuId);
      mockImsData = mockImsData.filter(d => d.skuId !== skuId);
      mockShipmentData = mockShipmentData.filter(d => d.skuId !== skuId);
      mockArrivalData = mockArrivalData.filter(d => d.skuId !== skuId);
      mockPlanningFgData = mockPlanningFgData.filter(d => d.skuId !== skuId);
    }),
    getForecastData: vi.fn(async () => mockForecastData),
    upsertForecastData: vi.fn(async (skuId: number, periodId: number, value: string) => {
      const existing = mockForecastData.find(d => d.skuId === skuId && d.periodId === periodId);
      if (existing) { existing.value = value; }
      else { mockForecastData.push({ id: mockForecastData.length + 1, skuId, periodId, value, updatedAt: new Date() }); }
    }),
    getImsData: vi.fn(async () => mockImsData),
    upsertImsData: vi.fn(async (skuId: number, periodId: number, value: string, isActual: boolean) => {
      const existing = mockImsData.find(d => d.skuId === skuId && d.periodId === periodId);
      if (existing) { existing.value = value; existing.isActual = isActual; }
      else { mockImsData.push({ id: mockImsData.length + 1, skuId, periodId, value, isActual, updatedAt: new Date() }); }
    }),
    getShipmentData: vi.fn(async () => mockShipmentData),
    upsertShipmentData: vi.fn(async (skuId: number, periodId: number, data: any) => {
      const existing = mockShipmentData.find(d => d.skuId === skuId && d.periodId === periodId);
      if (existing) { Object.assign(existing, data); }
      else { mockShipmentData.push({ id: mockShipmentData.length + 1, skuId, periodId, ...data, updatedAt: new Date() }); }
    }),
    getArrivalData: vi.fn(async () => mockArrivalData),
    upsertArrivalData: vi.fn(async (skuId: number, periodId: number, data: any) => {
      const existing = mockArrivalData.find(d => d.skuId === skuId && d.periodId === periodId);
      if (existing) { Object.assign(existing, data); }
      else { mockArrivalData.push({ id: mockArrivalData.length + 1, skuId, periodId, ...data, updatedAt: new Date() }); }
    }),
    getPlanningFgData: vi.fn(async () => mockPlanningFgData),
    upsertPlanningFgData: vi.fn(async (skuId: number, periodId: number, data: any) => {
      const existing = mockPlanningFgData.find(d => d.skuId === skuId && d.periodId === periodId);
      if (existing) { Object.assign(existing, data); }
      else { mockPlanningFgData.push({ id: mockPlanningFgData.length + 1, skuId, periodId, ...data, updatedAt: new Date() }); }
    }),
    getFullPlanningData: vi.fn(async (weightFilter?: string) => {
      let filteredSkus = mockSkus;
      if (weightFilter) filteredSkus = mockSkus.filter(s => s.weight === weightFilter);
      const skuIds = filteredSkus.map(s => s.id);
      return {
        skus: filteredSkus,
        periods: mockPeriods,
        forecast: mockForecastData.filter(d => skuIds.includes(d.skuId)),
        ims: mockImsData.filter(d => skuIds.includes(d.skuId)),
        shipment: mockShipmentData.filter(d => skuIds.includes(d.skuId)),
        arrival: mockArrivalData.filter(d => skuIds.includes(d.skuId)),
        planningFg: mockPlanningFgData.filter(d => skuIds.includes(d.skuId)),
      };
    }),
    bulkUpsertForecast: vi.fn(async () => {}),
    bulkUpsertIms: vi.fn(async () => {}),
    bulkUpsertShipment: vi.fn(async () => {}),
    bulkUpsertArrival: vi.fn(async () => {}),
    bulkUpsertPlanningFg: vi.fn(async () => {}),
    createUploadRecord: vi.fn(async () => ({ id: 1 })),
    updateUploadRecord: vi.fn(async () => {}),
    getUploadHistory: vi.fn(async () => mockUploadHistory),
    getDb: vi.fn(async () => ({})),
    upsertUser: vi.fn(async () => {}),
    getUserByOpenId: vi.fn(async () => undefined),
    logAudit: vi.fn(async () => {}),
    getAuditLogs: vi.fn(async () => ({ logs: [], total: 0 })),
    getExistingYears: vi.fn(async () => [2025]),
    addYear: vi.fn(async (year: number) => ({ periodsCreated: 12, dataRowsCreated: 0 })),
    updateSkuCategory: vi.fn(async () => {}),
    // Reset helper for tests
    _reset: () => {
      mockSkus = [];
      mockPeriods = [];
      mockForecastData = [];
      mockImsData = [];
      mockShipmentData = [];
      mockArrivalData = [];
      mockPlanningFgData = [];
      mockUploadHistory = [];
      nextSkuId = 1;
      nextPeriodId = 1;
    },
  };
});

// Import the mock module to access _reset
import * as dbModule from "./db";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1, openId: "test-user", email: "test@example.com", name: "Test User",
      loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// Admin context — satisfies both `protectedProcedure` and `adminProcedure`.
// Used for tests that exercise admin-only mutations (skus.create/delete,
// periods.init, upload.*) as well as protected mutations (update.*Cell).
function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 2, openId: "test-admin", email: "admin@example.com", name: "Test Admin",
      loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("SSOF Planning System", () => {
  beforeEach(() => {
    (dbModule as any)._reset();
  });

  describe("periods", () => {
    // periods.list became `protectedProcedure` in Task #15 (read endpoints
    // require sign-in to avoid leaking internal data on the deployed URL),
    // so these tests must use an authenticated context.
    it("initializes 36 periods (Jan 2025 - Dec 2027)", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.periods.list();
      expect(result.length).toBe(36);
      expect(result[0].label).toBe("Jan 25");
      expect(result[0].year).toBe(2025);
      expect(result[0].month).toBe(1);
      expect(result[35].label).toBe("Dec 27");
      expect(result[35].year).toBe(2027);
      expect(result[35].month).toBe(12);
    });

    it("does not duplicate periods on subsequent calls", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      await caller.periods.list();
      const result = await caller.periods.list();
      expect(result.length).toBe(36);
    });
  });

  describe("SKU management", () => {
    it("creates a new SKU with correct weight", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      const result = await caller.skus.create({ name: "Test Apple 50g", weight: "50g" });
      expect(result.id).toBeDefined();

      const skus = await caller.skus.list();
      expect(skus.length).toBe(1);
      expect(skus[0].name).toBe("Test Apple 50g");
      expect(skus[0].weight).toBe("50g");
    });

    it("creates SKUs with different weights", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Apple 50g", weight: "50g" });
      await caller.skus.create({ name: "Apple 250g", weight: "250g" });
      await caller.skus.create({ name: "Apple 1kg", weight: "1kg" });

      const skus = await caller.skus.list();
      expect(skus.length).toBe(3);
      expect(skus.map(s => s.weight)).toEqual(["50g", "250g", "1kg"]);
    });

    it("deletes a SKU and all associated data", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      const created = await caller.skus.create({ name: "To Delete", weight: "50g" });
      
      const result = await caller.skus.delete({ id: created.id });
      expect(result.success).toBe(true);

      const skus = await caller.skus.list();
      expect(skus.length).toBe(0);
    });
  });

  describe("data retrieval", () => {
    it("returns forecast data with skus and periods", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Test SKU", weight: "50g" });

      const result = await caller.data.forecast();
      expect(result.skus.length).toBe(1);
      expect(result.periods.length).toBe(36);
      expect(result.data.length).toBe(36); // one record per period
    });

    it("returns IMS vs Forecast comparison data", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Test SKU", weight: "50g" });

      const result = await caller.data.imsVsForecast();
      expect(result.skus.length).toBe(1);
      expect(result.forecast.length).toBe(36);
      expect(result.ims.length).toBe(36);
    });

    it("returns shipment data with weekly breakdown", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Test SKU", weight: "50g" });

      const result = await caller.data.shipment();
      expect(result.skus.length).toBe(1);
      expect(result.data.length).toBe(36);
      expect(result.data[0]).toHaveProperty("week1");
      expect(result.data[0]).toHaveProperty("week2");
      expect(result.data[0]).toHaveProperty("week3");
      expect(result.data[0]).toHaveProperty("week4");
    });

    it("returns arrival data with weekly breakdown", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Test SKU", weight: "50g" });

      const result = await caller.data.arrival();
      expect(result.skus.length).toBe(1);
      expect(result.data.length).toBe(36);
    });
  });

  describe("weight-based routing (Planning FG)", () => {
    it("filters SKUs by weight for Planning FG 50g", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Apple 50g", weight: "50g" });
      await caller.skus.create({ name: "Apple 250g", weight: "250g" });
      await caller.skus.create({ name: "Apple 1kg", weight: "1kg" });

      const result50g = await caller.data.planningFg({ weight: "50g" });
      expect(result50g.skus.length).toBe(1);
      expect(result50g.skus[0].weight).toBe("50g");
    });

    it("filters SKUs by weight for Planning FG 250g", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Apple 50g", weight: "50g" });
      await caller.skus.create({ name: "Apple 250g", weight: "250g" });

      const result250g = await caller.data.planningFg({ weight: "250g" });
      expect(result250g.skus.length).toBe(1);
      expect(result250g.skus[0].weight).toBe("250g");
    });

    it("filters SKUs by weight for Planning FG 1kg", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Apple 50g", weight: "50g" });
      await caller.skus.create({ name: "Apple 1kg", weight: "1kg" });

      const result1kg = await caller.data.planningFg({ weight: "1kg" });
      expect(result1kg.skus.length).toBe(1);
      expect(result1kg.skus[0].weight).toBe("1kg");
    });

    it("returns all SKUs when no weight filter is applied", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Apple 50g", weight: "50g" });
      await caller.skus.create({ name: "Apple 250g", weight: "250g" });
      await caller.skus.create({ name: "Apple 1kg", weight: "1kg" });

      const resultAll = await caller.data.planningFg({});
      expect(resultAll.skus.length).toBe(3);
    });

    it("returns full planning data including cross-sheet references", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Apple 50g", weight: "50g" });

      const result = await caller.data.planningFg({ weight: "50g" });
      expect(result.forecast.length).toBe(36);
      expect(result.ims.length).toBe(36);
      expect(result.shipment.length).toBe(36);
      expect(result.arrival.length).toBe(36);
      expect(result.planningFg.length).toBe(36);
    });
  });

  describe("cell updates", () => {
    // `update.*Cell` endpoints are `protectedProcedure` (any signed-in user
    // can edit cells), so exercise them with a regular auth caller — the
    // admin caller is only used for the admin-only setup (periods.init,
    // skus.create). This preserves the role-boundary fidelity of the test.
    it("updates a forecast cell value", async () => {
      const adminCaller = appRouter.createCaller(createAdminContext());
      await adminCaller.periods.init();
      await adminCaller.skus.create({ name: "Test SKU", weight: "50g" });

      const userCaller = appRouter.createCaller(createAuthContext());
      const result = await userCaller.update.forecastCell({ skuId: 1, periodId: 1, value: "5000" });
      expect(result.success).toBe(true);
    });

    it("updates an IMS cell with actual flag", async () => {
      const adminCaller = appRouter.createCaller(createAdminContext());
      await adminCaller.periods.init();
      await adminCaller.skus.create({ name: "Test SKU", weight: "50g" });

      const userCaller = appRouter.createCaller(createAuthContext());
      const result = await userCaller.update.imsCell({ skuId: 1, periodId: 1, value: "4500", isActual: true });
      expect(result.success).toBe(true);
    });

    it("updates shipment weekly data", async () => {
      const adminCaller = appRouter.createCaller(createAdminContext());
      await adminCaller.periods.init();
      await adminCaller.skus.create({ name: "Test SKU", weight: "50g" });

      const userCaller = appRouter.createCaller(createAuthContext());
      const result = await userCaller.update.shipmentCell({
        skuId: 1, periodId: 1,
        week1: "1000", week2: "1500", week3: "2000", week4: "500",
      });
      expect(result.success).toBe(true);
    });

    it("updates arrival weekly data", async () => {
      const adminCaller = appRouter.createCaller(createAdminContext());
      await adminCaller.periods.init();
      await adminCaller.skus.create({ name: "Test SKU", weight: "50g" });

      const userCaller = appRouter.createCaller(createAuthContext());
      const result = await userCaller.update.arrivalCell({
        skuId: 1, periodId: 1,
        week1: "1000", week2: "1500", week3: "2000", week4: "500",
      });
      expect(result.success).toBe(true);
    });

    it("updates planning FG opening stock and adjustments", async () => {
      const adminCaller = appRouter.createCaller(createAdminContext());
      await adminCaller.periods.init();
      await adminCaller.skus.create({ name: "Test SKU", weight: "50g" });

      const userCaller = appRouter.createCaller(createAuthContext());
      const result = await userCaller.update.planningFgCell({
        skuId: 1, periodId: 1,
        openingStock: "3000", adjustments: "100",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("bulk upload", () => {
    it("uploads forecast data for multiple SKUs", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();

      const result = await caller.upload.forecast({
        records: [
          {
            skuName: "New Apple 50g",
            weight: "50g",
            values: [
              { year: 2025, month: 1, value: "5000" },
              { year: 2025, month: 2, value: "6000" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);

      // Verify SKU was created
      const skus = await caller.skus.list();
      expect(skus.length).toBe(1);
      expect(skus[0].name).toBe("New Apple 50g");
      expect(skus[0].weight).toBe("50g");
    });

    it("uploads IMS actuals for existing SKUs", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Test SKU", weight: "50g" });

      const result = await caller.upload.imsActuals({
        records: [
          {
            skuName: "Test SKU",
            values: [
              { year: 2025, month: 1, value: "4500", isActual: true },
              { year: 2025, month: 2, value: "5500", isActual: true },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
    });

    it("uploads opening stock data", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Test SKU", weight: "50g" });

      const result = await caller.upload.openingStock({
        records: [
          { skuName: "Test SKU", value: "3000", periodYear: 2025, periodMonth: 1 },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.processed).toBe(1);
    });
  });

  describe("cross-sheet data integrity", () => {
    it("creating a SKU initializes data across all tables", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      await caller.skus.create({ name: "Cross Sheet Test", weight: "250g" });

      const forecast = await caller.data.forecast();
      const shipment = await caller.data.shipment();
      const arrival = await caller.data.arrival();
      const planning = await caller.data.planningFg({ weight: "250g" });

      // All tables should have data for the new SKU
      expect(forecast.data.filter(d => d.skuId === 1).length).toBe(36);
      expect(shipment.data.filter(d => d.skuId === 1).length).toBe(36);
      expect(arrival.data.filter(d => d.skuId === 1).length).toBe(36);
      expect(planning.planningFg.filter(d => d.skuId === 1).length).toBe(36);
    });

    it("deleting a SKU removes data from all tables", async () => {
      const caller = appRouter.createCaller(createAdminContext());
      await caller.periods.init();
      const created = await caller.skus.create({ name: "To Delete", weight: "50g" });

      await caller.skus.delete({ id: created.id });

      const forecast = await caller.data.forecast();
      const shipment = await caller.data.shipment();
      const arrival = await caller.data.arrival();

      expect(forecast.data.filter(d => d.skuId === created.id).length).toBe(0);
      expect(shipment.data.filter(d => d.skuId === created.id).length).toBe(0);
      expect(arrival.data.filter(d => d.skuId === created.id).length).toBe(0);
    });
  });
});
