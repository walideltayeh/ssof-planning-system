import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { appUsers } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// Task #20 added per-user country gating, which looks up `ctx.user.name`
// in the `appUsers` table. The test user below isn't a real app user, so
// we provision an owner row before the suite runs (and clean it up
// afterwards) to mirror an OAuth admin who has been added to the app.
const TEST_APP_USERNAME = "arrival-formula-test-user";

beforeAll(async () => {
  const handle = await db.getDb();
  if (!handle) return;
  await handle
    .insert(appUsers)
    .values({
      username: TEST_APP_USERNAME,
      displayName: "Arrival Formula Test User",
      password: "test-fixture-password",
      role: "admin",
      isOwner: true,
      countries: JSON.stringify(["Lebanon", "Syria", "Libya"]),
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  const handle = await db.getDb();
  if (!handle) return;
  await handle.delete(appUsers).where(eq(appUsers.username, TEST_APP_USERNAME));
});

/**
 * Tests for the Arrival to Regie API endpoint.
 * Verifies that the endpoint returns both arrival data and shipment data,
 * which the frontend uses to compute formula-based arrival values.
 *
 * Formula rules (from Excel):
 * - 2025-01 to 2025-11: all raw data (editable)
 * - 2025-12: W4 = Shipment(Dec 25).W2 (W1/W2/W3 raw)
 * - 2026-01: W3 = Shipment(Jan 26).W1, W4 = Shipment(Jan 26).W2 (W1/W2 raw)
 * - 2026-02+: W1=Ship(M-1).W3, W2=Ship(M-1).W4, W3=Ship(M).W1, W4=Ship(M).W2
 * - Total is always SUM(W1:W4)
 */

// `data.arrival` became `protectedProcedure` in Task #15 (read endpoints
// require sign-in to avoid leaking internal data on the deployed URL), so
// the test caller now needs an authenticated user on the context.
function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "arrival-formula-test-user",
      email: "test@example.com",
      name: TEST_APP_USERNAME,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

describe("data.arrival endpoint", () => {
  it("returns arrival data, shipment data, skus, and periods", { timeout: 15000 }, async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.data.arrival();

    // Verify the response shape includes shipment data for formula computation
    expect(result).toHaveProperty("skus");
    expect(result).toHaveProperty("periods");
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("shipment");

    // Verify arrays
    expect(Array.isArray(result.skus)).toBe(true);
    expect(Array.isArray(result.periods)).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(Array.isArray(result.shipment)).toBe(true);
  });

  it("returns periods with year and month for formula date computation", { timeout: 15000 }, async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.data.arrival();

    if (result.periods.length > 0) {
      const firstPeriod = result.periods[0];
      expect(firstPeriod).toHaveProperty("year");
      expect(firstPeriod).toHaveProperty("month");
      expect(firstPeriod).toHaveProperty("id");
      expect(firstPeriod).toHaveProperty("label");
      expect(firstPeriod).toHaveProperty("sortOrder");
    }
  });

  it("returns shipment data with weekly breakdown for formula computation", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.data.arrival();

    if (result.shipment.length > 0) {
      const firstShipment = result.shipment[0];
      expect(firstShipment).toHaveProperty("skuId");
      expect(firstShipment).toHaveProperty("periodId");
      expect(firstShipment).toHaveProperty("week1");
      expect(firstShipment).toHaveProperty("week2");
      expect(firstShipment).toHaveProperty("week3");
      expect(firstShipment).toHaveProperty("week4");
    }
  });
});

/**
 * Unit tests for the formula computation logic itself.
 * This tests the pure function that determines whether a cell is formula-based
 * and what its computed value should be.
 */
describe("Arrival formula computation logic", () => {
  // Replicate the formula logic from ArrivalPage.tsx for testing
  function getFormulaStatus(
    year: number,
    month: number,
    weekKey: string,
    shipmentLookup: (y: number, m: number, wk: string) => number,
  ): { isFormula: boolean; value: number } {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    if (year < 2025 || (year === 2025 && month < 12)) {
      return { isFormula: false, value: 0 };
    }
    if (year === 2025 && month === 12) {
      if (weekKey === "week4") {
        return { isFormula: true, value: shipmentLookup(2025, 12, "week2") };
      }
      return { isFormula: false, value: 0 };
    }
    if (year === 2026 && month === 1) {
      if (weekKey === "week3") {
        return { isFormula: true, value: shipmentLookup(2026, 1, "week1") };
      }
      if (weekKey === "week4") {
        return { isFormula: true, value: shipmentLookup(2026, 1, "week2") };
      }
      return { isFormula: false, value: 0 };
    }
    if (year > 2026 || (year === 2026 && month >= 2)) {
      switch (weekKey) {
        case "week1":
          return { isFormula: true, value: shipmentLookup(prevYear, prevMonth, "week3") };
        case "week2":
          return { isFormula: true, value: shipmentLookup(prevYear, prevMonth, "week4") };
        case "week3":
          return { isFormula: true, value: shipmentLookup(year, month, "week1") };
        case "week4":
          return { isFormula: true, value: shipmentLookup(year, month, "week2") };
      }
    }
    return { isFormula: false, value: 0 };
  }

  // Mock shipment data
  const mockShipment: Record<string, number> = {
    "2025-12-week1": 100, "2025-12-week2": 200, "2025-12-week3": 300, "2025-12-week4": 400,
    "2026-1-week1": 500, "2026-1-week2": 600, "2026-1-week3": 700, "2026-1-week4": 800,
    "2026-2-week1": 150, "2026-2-week2": 250, "2026-2-week3": 350, "2026-2-week4": 450,
    "2026-3-week1": 160, "2026-3-week2": 260, "2026-3-week3": 360, "2026-3-week4": 460,
    "2026-6-week1": 170, "2026-6-week2": 270, "2026-6-week3": 370, "2026-6-week4": 470,
    "2026-5-week1": 180, "2026-5-week2": 280, "2026-5-week3": 380, "2026-5-week4": 480,
    "2027-1-week1": 190, "2027-1-week2": 290, "2027-1-week3": 390, "2027-1-week4": 490,
    "2026-12-week1": 200, "2026-12-week2": 300, "2026-12-week3": 400, "2026-12-week4": 500,
  };

  const lookup = (y: number, m: number, wk: string): number => {
    return mockShipment[`${y}-${m}-${wk}`] ?? 0;
  };

  it("returns raw (non-formula) for months before 2025-12", () => {
    expect(getFormulaStatus(2025, 1, "week1", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2025, 6, "week2", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2025, 11, "week4", lookup)).toEqual({ isFormula: false, value: 0 });
  });

  it("for 2025-12: only W4 is formula (Shipment Dec 25 W2)", () => {
    expect(getFormulaStatus(2025, 12, "week1", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2025, 12, "week2", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2025, 12, "week3", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2025, 12, "week4", lookup)).toEqual({ isFormula: true, value: 200 }); // Ship Dec25 W2
  });

  it("for 2026-01: W3=Shipment(Jan26).W1, W4=Shipment(Jan26).W2", () => {
    expect(getFormulaStatus(2026, 1, "week1", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2026, 1, "week2", lookup)).toEqual({ isFormula: false, value: 0 });
    expect(getFormulaStatus(2026, 1, "week3", lookup)).toEqual({ isFormula: true, value: 500 }); // Ship Jan26 W1
    expect(getFormulaStatus(2026, 1, "week4", lookup)).toEqual({ isFormula: true, value: 600 }); // Ship Jan26 W2
  });

  it("for 2026-02: full formula W1=Ship(Jan26).W3, W2=Ship(Jan26).W4, W3=Ship(Feb26).W1, W4=Ship(Feb26).W2", () => {
    expect(getFormulaStatus(2026, 2, "week1", lookup)).toEqual({ isFormula: true, value: 700 }); // Ship Jan26 W3
    expect(getFormulaStatus(2026, 2, "week2", lookup)).toEqual({ isFormula: true, value: 800 }); // Ship Jan26 W4
    expect(getFormulaStatus(2026, 2, "week3", lookup)).toEqual({ isFormula: true, value: 150 }); // Ship Feb26 W1
    expect(getFormulaStatus(2026, 2, "week4", lookup)).toEqual({ isFormula: true, value: 250 }); // Ship Feb26 W2
  });

  it("for 2026-03: W1=Ship(Feb26).W3, W2=Ship(Feb26).W4, W3=Ship(Mar26).W1, W4=Ship(Mar26).W2", () => {
    expect(getFormulaStatus(2026, 3, "week1", lookup)).toEqual({ isFormula: true, value: 350 }); // Ship Feb26 W3
    expect(getFormulaStatus(2026, 3, "week2", lookup)).toEqual({ isFormula: true, value: 450 }); // Ship Feb26 W4
    expect(getFormulaStatus(2026, 3, "week3", lookup)).toEqual({ isFormula: true, value: 160 }); // Ship Mar26 W1
    expect(getFormulaStatus(2026, 3, "week4", lookup)).toEqual({ isFormula: true, value: 260 }); // Ship Mar26 W2
  });

  it("handles year boundary correctly (2027-01 uses 2026-12 shipment)", () => {
    expect(getFormulaStatus(2027, 1, "week1", lookup)).toEqual({ isFormula: true, value: 400 }); // Ship Dec26 W3
    expect(getFormulaStatus(2027, 1, "week2", lookup)).toEqual({ isFormula: true, value: 500 }); // Ship Dec26 W4
    expect(getFormulaStatus(2027, 1, "week3", lookup)).toEqual({ isFormula: true, value: 190 }); // Ship Jan27 W1
    expect(getFormulaStatus(2027, 1, "week4", lookup)).toEqual({ isFormula: true, value: 290 }); // Ship Jan27 W2
  });

  it("all 4 weeks are formula for any month from 2026-06", () => {
    const result1 = getFormulaStatus(2026, 6, "week1", lookup);
    const result2 = getFormulaStatus(2026, 6, "week2", lookup);
    const result3 = getFormulaStatus(2026, 6, "week3", lookup);
    const result4 = getFormulaStatus(2026, 6, "week4", lookup);

    expect(result1.isFormula).toBe(true);
    expect(result2.isFormula).toBe(true);
    expect(result3.isFormula).toBe(true);
    expect(result4.isFormula).toBe(true);

    // W1 = Ship(May26).W3 = 380, W2 = Ship(May26).W4 = 480
    expect(result1.value).toBe(380);
    expect(result2.value).toBe(480);
    // W3 = Ship(Jun26).W1 = 170, W4 = Ship(Jun26).W2 = 270
    expect(result3.value).toBe(170);
    expect(result4.value).toBe(270);
  });

  it("total is always SUM(W1:W4) for formula months", () => {
    const w1 = getFormulaStatus(2026, 3, "week1", lookup).value;
    const w2 = getFormulaStatus(2026, 3, "week2", lookup).value;
    const w3 = getFormulaStatus(2026, 3, "week3", lookup).value;
    const w4 = getFormulaStatus(2026, 3, "week4", lookup).value;
    const total = w1 + w2 + w3 + w4;
    expect(total).toBe(350 + 450 + 160 + 260); // 1220
  });

  it("returns 0 for missing shipment data in formula months", () => {
    // 2026-04 has no shipment data in our mock
    const result = getFormulaStatus(2026, 4, "week1", lookup);
    expect(result.isFormula).toBe(true);
    // Ship(Mar26).W3 = 360
    expect(result.value).toBe(360);

    const result2 = getFormulaStatus(2026, 4, "week3", lookup);
    expect(result2.isFormula).toBe(true);
    // Ship(Apr26).W1 = 0 (no data)
    expect(result2.value).toBe(0);
  });
});
