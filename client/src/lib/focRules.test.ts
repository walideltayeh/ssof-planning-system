import { describe, it, expect } from "vitest";
import {
  focRuleOf, isRuleComplete, unitInPacks, computeFocReward, ruleSentence, suggestFocOptions,
  PACKS_PER_OUTER, type FocSuggestProfile,
} from "./focRules";

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

const wsProfile: FocSuggestProfile = { buyUnit: "mc", freeUnits: ["outer", "pack"], targets: [4, 8, 12], maxBuyQty: 5 };
const retailProfile: FocSuggestProfile = { buyUnit: "outer", freeUnits: ["pack"], targets: [3, 6, 9], maxBuyQty: 6 };

describe("suggestFocOptions", () => {
  it("returns 3 distinct light→generous options with increasing giveaway rates", () => {
    const opts = suggestFocOptions(wsProfile, "50g")!;
    expect(opts).toHaveLength(3);
    expect(opts.map(o => o.tier)).toEqual(["light", "standard", "generous"]);
    expect(opts[0].ratePct).toBeLessThan(opts[1].ratePct);
    expect(opts[1].ratePct).toBeLessThan(opts[2].ratePct);
    const keys = new Set(opts.map(o => `${o.buyQty}|${o.freeQty}|${o.freeUnit}`));
    expect(keys.size).toBe(3);
  });
  it("rates land near the profile targets", () => {
    const opts = suggestFocOptions(wsProfile, "50g")!;
    opts.forEach((o, i) => expect(Math.abs(o.ratePct - wsProfile.targets[i])).toBeLessThanOrEqual(1.5));
  });
  it("respects the channel's buy unit and allowed free units", () => {
    const opts = suggestFocOptions(retailProfile, "50g")!;
    for (const o of opts) {
      expect(o.buyUnit).toBe("outer");
      expect(o.freeUnit).toBe("pack");
      expect(o.buyQty).toBeLessThanOrEqual(6);
      expect(o.buyQty).toBeGreaterThan(0);
      expect(o.freeQty).toBeGreaterThan(0);
    }
  });
  it("is weight-aware: MC-based profiles adapt to heavy weights via pack fallback", () => {
    const opts = suggestFocOptions(wsProfile, "1kg"); // only 6 packs per MC
    expect(opts).not.toBeNull();
    for (const o of opts!) {
      expect(o.ratePct).toBeLessThanOrEqual(30);
      expect(o.ratePct).toBeGreaterThan(0);
    }
  });
  it("null when the weight can't be parsed for an MC buy unit", () => {
    expect(suggestFocOptions(wsProfile, "mystery")).toBeNull();
  });
  it("tiers stay monotonic across all page channel profiles and common weights", () => {
    const profiles: FocSuggestProfile[] = [
      { buyUnit: "mc",    freeUnits: ["outer", "pack"], targets: [4, 8, 12], maxBuyQty: 5 }, // wholesale
      { buyUnit: "mc",    freeUnits: ["outer", "pack"], targets: [4, 7, 10], maxBuyQty: 5 }, // semi-wholesale
      { buyUnit: "outer", freeUnits: ["pack"],          targets: [3, 6, 9],  maxBuyQty: 6 }, // retail
      { buyUnit: "outer", freeUnits: ["pack"],          targets: [3, 6, 9],  maxBuyQty: 4 }, // horeca
    ];
    for (const profile of profiles) {
      for (const weight of ["50g", "250g", "1kg"]) {
        const opts = suggestFocOptions(profile, weight);
        expect(opts, `${profile.buyUnit} profile @ ${weight}`).not.toBeNull();
        expect(opts!).toHaveLength(3);
        expect(opts![0].ratePct).toBeLessThan(opts![1].ratePct);
        expect(opts![1].ratePct).toBeLessThan(opts![2].ratePct);
      }
    }
  });
  it("every suggestion converts into a complete, usable rule", () => {
    const opts = suggestFocOptions(retailProfile, "250g")!;
    for (const o of opts) {
      const rule = focRuleOf({ entitled: true, buyQty: o.buyQty, buyUnit: o.buyUnit, freeQty: o.freeQty, freeUnit: o.freeUnit });
      expect(isRuleComplete(rule)).toBe(true);
      expect(ruleSentence(rule)).toBeTruthy();
      const reward = computeFocReward(rule, 10, "250g");
      expect(reward).not.toBeNull();
    }
  });
});
