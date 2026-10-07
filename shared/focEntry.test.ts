import { describe, expect, it } from "vitest";
import { blankFocDraft, changeFocCell, focMonth, matchFocDrafts, parseFocPaste, receivedFocMC } from "./focEntry";
import { buildStockLedger } from "./performance/stock";
import { evaluateFocReceipts } from "./performance/focReceipts";
const skus = [{ id: 1, country: "Libya", name: "Double Apple", weight: "1kg", packagingType: "Old" },
  { id: 2, country: "Libya", name: "Mint", weight: "50g", packagingType: "New" },
  { id: 3, country: "Syria", name: "Mint", weight: "50g", packagingType: "New" }];
const periods = [{ id: 6, country: "Libya", year: 2026, month: 6, label: "Jun 26", sortOrder: 6 },
  { id: 7, country: "Libya", year: 2026, month: 7, label: "Jul 26", sortOrder: 7 }];
const header = "Date\tAcc Type\tSales Manager\tFlavor\tWeight\tPackaging\tQuantity in MC";
describe("FOC sheet parsing and exact country matching", () => {
  it("resolves selected IDs to canonical registered identities and allows repeated selections", () => {
    const selected = { ...blankFocDraft(), skuId: 2, date: "2026-06", quantityMC: "10",
      flavor: "Mistyped", weight: "Wrong", packaging: "Wrong" };
    const rows = matchFocDrafts([selected, { ...selected, quantityMC: "20" }], skus, periods, "Libya");
    expect(rows.map(r => [r.skuId, r.periodId, r.quantity])).toEqual([[2, 6, 10], [2, 6, 20]]);
    expect(rows[0]).toMatchObject({ flavor: "Mint", weight: "50g", packaging: "New", errors: [] });
  });
  it("rejects foreign, inactive and missing selected IDs without falling back to text", () => {
    const inactive = { ...skus[1], id: 4, isActive: false };
    for (const skuId of [3, 4, 999]) {
      const [row] = matchFocDrafts([{ ...blankFocDraft(), skuId, date: "2026-06", quantityMC: "10",
        flavor: "Mint", weight: "50g", packaging: "New" }], [...skus, inactive], periods, "Libya");
      expect(row.skuId).toBeNull();
      expect(row.errors).toContain(skuId === 4 ? "This SKU is inactive. Select an active SKU for this country." : "No matching SKU in this country.");
    }
  });
  it("flags inactive pasted matches explicitly while retaining original pasted identity", () => {
    const drafts = parseFocPaste(`${header}\nJun-26\tExport\tA\tTwo Apples\t1000gr\tOld Packaging\t10`);
    const [row] = matchFocDrafts(drafts, skus.map(s => ({ ...s, isActive: s.id !== 1 })), periods, "Libya");
    expect(row).toMatchObject({ skuId: null, flavor: "Two Apples", weight: "1000gr", packaging: "Old Packaging",
      errors: ["This SKU is inactive. Select an active SKU for this country."] });
  });
  it("reads the exact seven-column Excel layout without converting MC and preserves recorded details", () => {
    const drafts = parseFocPaste(`${header}\r\nJun-26\tExport\tManager A\tTwo Apples\t1000gr\tOld Packaging\t1,200.50\r\nJun-26\tDomestic\tManager B\tMint\t50gr\tNew Packaging\t12`);
    const rows = matchFocDrafts(drafts, skus, periods, "Libya");
    expect(rows[0]).toMatchObject({ skuId: 1, periodId: 6, quantity: 1200.5, received: false, accType: "Export", salesManager: "Manager A", errors: [] });
    expect(rows[1]).toMatchObject({ skuId: 2, quantity: 12, errors: [] });
  });
  it("maps Double Apples to Double Apple and keeps several identical SKU/month lines individually", () => {
    const rows = matchFocDrafts(parseFocPaste(`${header}\nJun-26\tA\tB\tDouble Apples\t1000gr\tOld Packaging\t10\nJun-26\tC\tD\tTwo Apples\t1kg\tOld\t20`), skus, periods, "Libya");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => [r.skuId, r.periodId, r.quantity])).toEqual([[1, 6, 10], [1, 6, 20]]);
  });
  it("keeps and flags an unknown flavour, a missing period, and ambiguous SKUs instead of guessing", () => {
    const [unknown] = matchFocDrafts(parseFocPaste(`${header}\nJun-26\tA\tB\tNot A Flavour\t50gr\tNew Packaging\t10`), skus, periods, "Libya");
    expect(unknown.skuId).toBeNull(); expect(unknown.errors).toContain("No matching SKU in this country.");
    const [missing] = matchFocDrafts([{ ...blankFocDraft(), date: "Jun-25", flavor: "Mint", weight: "50g", quantityMC: "10" }], skus, periods, "Libya");
    expect(missing.periodId).toBeNull();
    const [ambiguous] = matchFocDrafts([{ ...blankFocDraft(), date: "Jun-26", flavor: "Mint", weight: "50g", quantityMC: "10" }], [...skus, { ...skus[1], id: 4 }], periods, "Libya");
    expect(ambiguous.skuId).toBeNull();
  });
  it("supports header reordering and quoted CSV, while flagging malformed rows", () => {
    const parsed = parseFocPaste('Flavor,Date,Weight,Packaging,Quantity in MC,Sales Manager,Acc Type\nMint,Jun-26,50gr,New Packaging,"1,000","Manager, A",Export');
    expect(matchFocDrafts(parsed, skus, periods, "Libya")[0]).toMatchObject({ quantity: 1000, salesManager: "Manager, A", errors: [] });
    expect(parseFocPaste(`${header}\nJun-26\tA\tB\tMint\t50gr\tNew\t10\textra`)[0].error).toBeTruthy();
    expect(parseFocPaste('Date,Flavor\nJun-26,Mint')[0].error).toContain("Missing column");
  });
  it("accepts month and Excel serial dates, and rejects invalid dates and malformed quantities", () => {
    expect(focMonth("June 2026")).toEqual({ year: 2026, month: 6 });
    expect(focMonth("2026-06-01")).toEqual({ year: 2026, month: 6 });
    expect(focMonth("46174")).not.toBeNull();
    expect(focMonth("Juniper-26")).toBeNull();
    expect(focMonth("2026-13")).toBeNull();
    expect(focMonth("2026-06-99")).toBeNull();
    expect(parseFocPaste(`${header}\tNotes\nJun-26\tA\tB\tMint\t50gr\tNew\t10\tExtra note`)[0].error).toContain("Unexpected");
    for (const quantityMC of ["-10", "", "12.345", "abc", "1,5"]) {
      expect(matchFocDrafts([{ ...blankFocDraft(), date: "Jun-26", flavor: "Mint", weight: "50g", quantityMC }], skus, periods, "Libya")[0].errors.length).toBeGreaterThan(0);
    }
  });
});
const line = (id: string, quantityMC: number, received: boolean) => ({ id, quantityMC, received, source: "Recorded FOC" as const, accType: "Export", salesManager: "Manager", actor: "Admin", recordedAt: "2026-10-07T00:00:00Z" });
describe("multi-line FOC stock and traceability", () => {
  const data = { country: "Libya" as const, now: new Date("2026-10-07"), skus: [skus[1]], periods, ims: [], forecast: [], arrival: [], clearanceEvents: [],
    planningFg: [{ skuId: 2, periodId: 6, openingStock: "100" }] };
  it("sums planned lines but only received lines affect June and every following closing stock", () => {
    const cell = { skuId: 2, periodId: 6, value: "30", received: false, lines: [line("a", 10, true), line("b", 20, false)] };
    expect(receivedFocMC(cell)).toBe(10);
    const ledger = buildStockLedger({ ...data, foc: [cell] });
    expect(ledger.bySku.get(2)?.get(6)?.closing).toBe(110);
    expect(ledger.bySku.get(2)?.get(7)?.closing).toBe(110);
    expect(buildStockLedger({ ...data, foc: [cell], includeFoc: false }).bySku.get(2)?.get(7)?.closing).toBe(100);
  });
  it("checks individual duplicate receipts and keeps an unrelated received line in stock", () => {
    const cell = { skuId: 2, periodId: 6, value: "30", received: true, lines: [line("a", 10, true), line("b", 20, true)] };
    const entries = evaluateFocReceipts({ ...data, foc: [cell], clearanceEvents: [{ skuId: 2, country: "Libya", clearedDate: "2026-06-15", clearedQty: "10" }] });
    expect(entries.find(e => e.lineId === "a")).toMatchObject({ needsReview: true, added: 0 });
    expect(entries.find(e => e.lineId === "b")).toMatchObject({ needsReview: false, added: 20 });
  });
  it("detects a duplicate arrival equal to the combined receipt, not just individual lines", () => {
    const entries = evaluateFocReceipts({ ...data, foc: [{ skuId: 2, periodId: 6, value: "30", lines: [line("a", 10, true), line("b", 20, true)] }],
      clearanceEvents: [{ skuId: 2, country: "Libya", clearedDate: "2026-06-15", clearedQty: "30" }] });
    expect(entries.every(e => e.needsReview && e.added === 0)).toBe(true);
  });
  it("preserves original lines and quantities when correcting, clearing or changing one receipt", () => {
    const original = { skuId: 2, periodId: 6, value: "30", received: false, lines: [line("a", 10, true), line("b", 20, false)] };
    const changed = changeFocCell(original, { value: 15 }, "Admin", "", "new");
    expect(changed.lines).toHaveLength(2);
    expect(changed.lines?.[1]).toMatchObject({ quantityMC: 5, originalQuantityMC: 20 });
    expect(receivedFocMC(changed)).toBe(10);
    const cleared = changeFocCell(changed, { value: null }, "Admin", "", "clear");
    expect(cleared.value).toBeNull(); expect(cleared.lines).toHaveLength(0); expect(receivedFocMC(cleared)).toBe(0);
    expect(original.lines.map(l => l.quantityMC)).toEqual([10, 20]);
    expect(receivedFocMC(changeFocCell(original, { lineId: "b", received: true }, "Admin", "", "receipt"))).toBe(30);
  });
  it("changes only the selected recorded line and retains its original quantity and identity", () => {
    const original = { skuId: 2, periodId: 6, value: "30", lines: [line("a", 10, true), line("b", 20, false)] };
    const changed = changeFocCell(original, { lineId: "a", value: 15.25 }, "Admin", "", "edit");
    expect(changed.value).toBe("35.25");
    expect(changed.lines?.[0]).toMatchObject({ id: "a", quantityMC: 15.25, originalQuantityMC: 10, received: true });
    expect(changed.lines?.[1]).toEqual(original.lines[1]);
    expect(receivedFocMC(changed)).toBe(15.25);
    expect(original.lines[0].quantityMC).toBe(10);
  });
  it("deletes a single recorded line, recalculates receipts and deletes the final line completely", () => {
    const original = { skuId: 2, periodId: 6, value: "30", lines: [line("a", 10, true), line("b", 20, false)] };
    const changed = changeFocCell(original, { lineId: "b", remove: true }, "Admin", "", "delete");
    expect(changed).toMatchObject({ value: "10.00", received: true, lines: [original.lines[0]] });
    expect(receivedFocMC(changed)).toBe(10);
    expect(changeFocCell(changed, { lineId: "a", remove: true }, "Admin", "", "last")).toMatchObject({ value: null, received: false, lines: [] });
    expect(changeFocCell(original, { remove: true }, "Admin", "", "all")).toMatchObject({ value: null, received: false, lines: [] });
  });
  it("rejects stale line identities rather than correcting or deleting a different line", () => {
    const original = { skuId: 2, periodId: 6, value: "10", lines: [line("a", 10, true)] };
    expect(() => changeFocCell(original, { lineId: "missing", value: 15 }, "Admin", "", "edit")).toThrow("Recorded FOC line not found");
    expect(() => changeFocCell(original, { lineId: "missing", remove: true }, "Admin", "", "delete")).toThrow("Recorded FOC line not found");
  });
});
