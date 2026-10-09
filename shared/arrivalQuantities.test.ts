import { describe, expect, it } from "vitest";
import { arrivalFocMap, arrivalStatusWithFoc, combinedArrivalQuantities } from "./arrivalQuantities";

describe("Syria physical arrival quantities", () => {
  it("adds Production and FOC exactly once to plan, actual and batch quantities", () => {
    expect(combinedArrivalQuantities(10000, 10000, 500)).toEqual({
      plannedTotal: 10500, actualTotal: 10500, productionTotal: 10000, focTotal: 500, total: 10500,
    });
  });
  it("preserves manual actual overrides without losing FOC or changing variance", () => {
    const q = combinedArrivalQuantities(10000, 9000, 500);
    expect(q.actualTotal).toBe(9500);
    expect(q.total).toBe(9500);
    expect(q.actualTotal - q.plannedTotal).toBe(-1000);
  });
  it("does not invent paid actual production for forecast-only or FOC-only batches", () => {
    expect(combinedArrivalQuantities(10000, 0, 500)).toMatchObject({ total: 10500, plannedTotal: 10500, actualTotal: 0 });
    expect(combinedArrivalQuantities(0, 0, 500)).toMatchObject({ total: 500, plannedTotal: 500, actualTotal: 500, productionTotal: 0 });
  });
  it("counts only Received FOC, including received detail lines without double-counting", () => {
    const map = arrivalFocMap("Syria", [
      { skuId: 1, periodId: 2, country: "Syria", value: "500", received: false, lines: [{ quantityMC: 500 } as never] },
      { skuId: 1, periodId: 3, country: "Syria", value: "600", received: true },
      { skuId: 1, periodId: 4, country: "Libya", value: "900" },
      { skuId: 1, periodId: 5, value: null },
    ]);
    expect([...map.entries()]).toEqual([["1-3", 600]]);
    expect(arrivalFocMap("Syria", [{ skuId: 1, periodId: 2, value: "500", received: false,
      lines: [{ quantityMC: 200, received: true } as never, { quantityMC: 300, received: false } as never] }]).get("1-2")).toBe(200);
  });
  it.each(["Libya", "Lebanon", "KSA"])("keeps %s unchanged", country => {
    expect(arrivalFocMap(country, [{ skuId: 1, periodId: 2, value: 500 }]).size).toBe(0);
  });
  it("retains precision and reports additional FOC as pending instead of fully cleared", () => {
    expect(combinedArrivalQuantities(0.1, 0.1, 0.2).total).toBe(0.3);
    expect(arrivalStatusWithFoc("Cleared", 500, 10500, 10000)).toBe("Partially Cleared");
    expect(arrivalStatusWithFoc("Cleared", 500, 10500, 10500)).toBe("Cleared");
    expect(arrivalStatusWithFoc("Cleared", 0, 10000, 10000)).toBe("Cleared");
  });
});
