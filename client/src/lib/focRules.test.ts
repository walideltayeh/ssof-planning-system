import { describe, it, expect } from "vitest";
import { focRuleOf, isRuleComplete, unitInPacks, computeFocReward, ruleSentence, PACKS_PER_OUTER } from "./focRules";

const wsRule = focRuleOf({ entitled: true, buyQty: "1", buyUnit: "mc", freeQty: "1", freeUnit: "outer" });
const retailRule = focRuleOf({ entitled: true, buyQty: "3", buyUnit: "outer", freeQty: "1", freeUnit: "pack" });

describe("focRuleOf", () => {
  it("parses numeric-column strings and units", () => {
    expect(wsRule).toEqual({ entitled: true, buyQty: 1, buyUnit: "mc", freeQty: 1, freeUnit: "outer", notes: null });
  });
  it("treats missing rows as not entitled", () => {
    const r = focRuleOf(null);
    expect(r.entitled).toBe(false);
    expect(isRuleComplete(r)).toBe(false);
  });
  it("rejects bad units and non-positive quantities", () => {
    const r = focRuleOf({ entitled: true, buyQty: "0", buyUnit: "carton", freeQty: "-1", freeUnit: "pack" });
    expect(r.buyQty).toBeNull();
    expect(r.buyUnit).toBeNull();
    expect(r.freeQty).toBeNull();
    expect(isRuleComplete(r)).toBe(false);
  });
});

describe("unitInPacks", () => {
  it("fixed units", () => {
    expect(unitInPacks("pack", "50g")).toBe(1);
    expect(unitInPacks("outer", "50g")).toBe(PACKS_PER_OUTER);
  });
  it("MC depends on weight (1 MC = 6 KG)", () => {
    expect(unitInPacks("mc", "50g")).toBe(120);
    expect(unitInPacks("mc", "250g")).toBe(24);
    expect(unitInPacks("mc", "banana")).toBeNull();
  });
});

describe("computeFocReward", () => {
  it("wholesale example: buy 1 MC get 1 outer — 20 MC of 50g earns 20 outers", () => {
    const r = computeFocReward(wsRule, 20, "50g")!;
    expect(r.multiples).toBe(20);
    expect(r.freeUnits).toBe(20);
    expect(r.freePacks).toBe(200);
    expect(r.freeMcEquivalent).toBeCloseTo(200 / 120, 5);
  });
  it("retail example: buy 3 outers get 1 pack — 6 MC of 50g (72 outers) earns 24 packs", () => {
    const r = computeFocReward(retailRule, 6, "50g")!;
    expect(r.multiples).toBe(24);
    expect(r.freePacks).toBe(24);
  });
  it("below the threshold → zero free goods, not null", () => {
    const bigBuy = focRuleOf({ entitled: true, buyQty: "50", buyUnit: "mc", freeQty: "1", freeUnit: "mc" });
    const r = computeFocReward(bigBuy, 20, "50g")!;
    expect(r.multiples).toBe(0);
    expect(r.freePacks).toBe(0);
  });
  it("null when not entitled/incomplete or weight unparseable", () => {
    expect(computeFocReward(focRuleOf(null), 20, "50g")).toBeNull();
    expect(computeFocReward(wsRule, 20, "mystery")).toBeNull();
    expect(computeFocReward(wsRule, 0, "50g")).toBeNull();
  });
});

describe("ruleSentence", () => {
  it("spells out outers in packs", () => {
    expect(ruleSentence(wsRule)).toBe("Buy 1 MC → get 1 outer (10 packs) free");
    expect(ruleSentence(retailRule)).toBe("Buy 3 outers → get 1 pack free");
  });
  it("null for incomplete rules", () => {
    expect(ruleSentence(focRuleOf(null))).toBeNull();
  });
});
