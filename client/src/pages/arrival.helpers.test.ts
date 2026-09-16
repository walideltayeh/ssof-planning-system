import { describe, it, expect } from "vitest";
import { decideBatchSurface, summarizeOrphans, collectOrphanClearances } from "./arrival.helpers";

describe("decideBatchSurface", () => {
  it("lists a batch with actual production as a normal batch", () => {
    expect(decideBatchSurface({ actualTotal: 3600, plannedTotal: 0, eventCount: 0 }))
      .toEqual({ surface: true, isOrphan: false });
  });

  it("lists a planned-only batch (awaiting actual) as a normal batch", () => {
    expect(decideBatchSurface({ actualTotal: 0, plannedTotal: 1750, eventCount: 2 }))
      .toEqual({ surface: true, isOrphan: false });
  });

  it("hides a batch with no production and no clearance events", () => {
    expect(decideBatchSurface({ actualTotal: 0, plannedTotal: 0, eventCount: 0 }))
      .toEqual({ surface: false });
  });

  // Regression: production was moved from Mar-2026 to Apr/May-2026 after
  // clearances had been logged against Mar. Those events must stay visible
  // (flagged) — Planning FG keeps counting them by cleared date either way.
  it("keeps a batch visible as ORPHANED when it has clearance events but no production", () => {
    expect(decideBatchSurface({ actualTotal: 0, plannedTotal: 0, eventCount: 3 }))
      .toEqual({ surface: true, isOrphan: true });
  });
});

describe("summarizeOrphans", () => {
  it("returns zeros when nothing is orphaned", () => {
    expect(summarizeOrphans([])).toEqual({ batchCount: 0, eventCount: 0, totalQty: 0 });
  });

  it("counts batches, events and total cleared qty (string or numeric qty)", () => {
    const summary = summarizeOrphans([
      { events: [{ clearedQty: "3600.00" }, { clearedQty: "3250" }] },
      { events: [{ clearedQty: 9000 }] },
      { events: [{ clearedQty: null }] }, // malformed qty is ignored, batch still counted
    ]);
    expect(summary).toEqual({ batchCount: 3, eventCount: 4, totalQty: 15850 });
  });
});

describe("collectOrphanClearances", () => {
  // Production per batch: Mar-26 was zeroed (moved to Apr-26 by a re-import),
  // Apr-26 has production. Events were logged against both.
  const production = new Map<string, number>([
    ["1-16", 3600], // sku 1, Apr-26
  ]);
  const forecast = new Map<string, number>([
    ["1-16", 3600],
    ["2-15", 1750], // sku 2 has a PLAN in Mar-26 → awaiting actual, not orphaned
  ]);
  const labels = new Map<number, string>([[15, "Mar-26"], [16, "Apr-26"], [20, "Aug-26"]]);
  const events = [
    { skuId: 1, periodId: 15, clearedQty: "3600" }, // orphan (Mar, no production)
    { skuId: 1, periodId: 16, clearedQty: "3600" }, // fine (Apr has production)
    { skuId: 2, periodId: 15, clearedQty: "1750" }, // fine (Mar has a plan for sku 2)
    { skuId: 1, periodId: 20, clearedQty: "9000" }, // orphan (Aug, nothing)
    { skuId: 1, periodId: 20, clearedQty: "0" },    // zero qty → ignored
    { skuId: 3, periodId: 15, clearedQty: "500" },  // sku not on this page → ignored
  ];
  const opts = {
    includeSku: (skuId: number) => skuId !== 3,
    actualFor: (s: number, p: number) => production.get(`${s}-${p}`) ?? 0,
    plannedFor: (s: number, p: number) => forecast.get(`${s}-${p}`) ?? 0,
    periodLabel: (p: number) => labels.get(p),
  };

  it("reports only events attached to batches with no plan and no actual", () => {
    expect(collectOrphanClearances(events, opts)).toEqual({
      eventCount: 2,
      batchCount: 2,
      totalQty: 12600,
      periodLabels: ["Mar-26", "Aug-26"],
    });
  });

  it("is empty when every event sits on a batch with production", () => {
    const healthy = events.filter(e => e.periodId === 16);
    expect(collectOrphanClearances(healthy, opts)).toEqual({ eventCount: 0, batchCount: 0, totalQty: 0, periodLabels: [] });
  });
});
