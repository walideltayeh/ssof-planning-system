import { describe, expect, it } from "vitest";
import { reassignFocCells } from "./focReassignment";
import type { FocCell } from "./performance/foc";

const skus = [
  { id: 1, country: "Libya", name: "Mint", weight: "50g", packagingType: "New" },
  { id: 2, country: "Libya", name: "Mint", weight: "50g", packagingType: "Old" },
  { id: 3, country: "Syria", name: "Mint", weight: "50g", packagingType: "Old" },
  { id: 4, country: "Libya", name: "Mint", weight: "1kg", packagingType: "New", isActive: false },
];
const periods = [6, 7, 8, 9].map(month => ({ id: month, country: "Libya", year: 2026, month, label: `${month}/2026` }));
describe("FOC reassignment preserves every source and target line", () => {
  it("merges two legacy balances without line-ID collisions, guessed creators or lost receipt decisions", () => {
    const source = { skuId: 1, periodId: 6, value: "0.12", received: true, receiptDecision: "separate", receiptReviewKey: "source-evidence" };
    const target = { skuId: 2, periodId: 6, value: "0.13", received: false };
    const { next, move } = reassignFocCells("Libya", skus, periods, [source, target], { sourceSkuId: 1, targetSkuId: 2 });
    expect(next.get("2-6")).toMatchObject({ value: "0.25", received: false, lines: [
      { id: "existing:2:6", quantityMC: 0.13, received: false, actor: "Existing record", recordedAt: "" },
      { id: "existing:1:6", quantityMC: 0.12, received: true, receiptDecision: "separate", receiptReviewKey: "source-evidence", actor: "Existing record", recordedAt: "" },
    ] });
    expect(move.months[0]).toMatchObject({ quantityMC: 0.12, receivedMC: 0.12, resultLineCount: 2 });
    expect(source.value).toBe("0.12"); expect(target.value).toBe("0.13");
  });
  it("keeps selected-month moves isolated and moves retained zero-quantity history rather than dropping it", () => {
    const zero = { id: "corrected-original", quantityMC: 0, originalQuantityMC: 25, received: true,
      source: "Recorded FOC" as const, actor: "Original creator", recordedAt: "2026-06-01", accType: "Wholesale", salesManager: "Original manager" };
    const cells: FocCell[] = [6, 7, 8].map(periodId => ({ skuId: 1, periodId, value: "10.00", received: false }));
    cells.push({ skuId: 1, periodId: 9, value: "0.00", lines: [zero] });
    const { next, move } = reassignFocCells("Libya", skus, periods, cells, { sourceSkuId: 1, targetSkuId: 2, periodIds: [7, 9] });
    expect(move.months.map(m => m.periodId)).toEqual([7, 9]);
    expect(next.get("1-6")?.value).toBe("10.00");
    expect(next.get("1-8")?.value).toBe("10.00");
    expect(next.get("2-9")?.lines).toEqual([zero]);
    expect(move).toMatchObject({ sourceTotalBefore: 30, sourceTotalAfter: 20, targetTotalAfter: 10 });
  });
  it.each([
    { sourceSkuId: 1, targetSkuId: 1 },
    { sourceSkuId: 1, targetSkuId: 3 },
    { sourceSkuId: 1, targetSkuId: 4 },
    { sourceSkuId: 1, targetSkuId: 2, periodIds: [] },
    { sourceSkuId: 1, targetSkuId: 2, periodIds: [99] },
  ])("rejects invalid source, target or month scope: %j", move => {
    expect(() => reassignFocCells("Libya", skus, periods, [{ skuId: 1, periodId: 6, value: "10" }], move)).toThrow();
  });
  it("fails explicitly rather than losing quantities if saved detail lines disagree with the balance", () => {
    const cell = { skuId: 1, periodId: 6, value: "10", lines: [{ id: "bad-line", quantityMC: 9,
      received: true, source: "Recorded FOC" as const, actor: "", recordedAt: "", accType: "", salesManager: "" }] };
    expect(() => reassignFocCells("Libya", skus, periods, [cell], { sourceSkuId: 1, targetSkuId: 2 })).toThrow("do not match");
  });
});
