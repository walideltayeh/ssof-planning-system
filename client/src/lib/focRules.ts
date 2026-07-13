// ────────────────────────────────────────────────────────────────────────────
// FOC (free-of-charge) entitlement rules — "Buy X → get Y free" per channel.
// Units: mastercase (MC), outer (10 packs), pack. Packs per MC come from the
// SKU weight via packsPerMc (1 MC = 6 KG → 50g = 120 packs = 12 outers).
// ────────────────────────────────────────────────────────────────────────────
import { packsPerMc } from "./packUnits";

export const PACKS_PER_OUTER = 10;

export type FocUnit = "mc" | "outer" | "pack";
export const FOC_UNITS: FocUnit[] = ["mc", "outer", "pack"];

export const FOC_UNIT_LABEL: Record<FocUnit, { one: string; many: string }> = {
  mc:    { one: "MC",    many: "MC" },
  outer: { one: "outer", many: "outers" },
  pack:  { one: "pack",  many: "packs" },
};

export type FocRule = {
  entitled: boolean;
  buyQty: number | null;
  buyUnit: FocUnit | null;
  freeQty: number | null;
  freeUnit: FocUnit | null;
  notes: string | null;
};

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseUnit(v: unknown): FocUnit | null {
  return v === "mc" || v === "outer" || v === "pack" ? v : null;
}

// Reads a rule off a raw server row (numeric columns arrive as strings).
export function focRuleOf(row: {
  entitled?: unknown; buyQty?: unknown; buyUnit?: unknown;
  freeQty?: unknown; freeUnit?: unknown; notes?: unknown;
} | null | undefined): FocRule {
  if (!row) return { entitled: false, buyQty: null, buyUnit: null, freeQty: null, freeUnit: null, notes: null };
  return {
    entitled: row.entitled === true,
    buyQty: parseNum(row.buyQty),
    buyUnit: parseUnit(row.buyUnit),
    freeQty: parseNum(row.freeQty),
    freeUnit: parseUnit(row.freeUnit),
    notes: typeof row.notes === "string" && row.notes.trim() !== "" ? row.notes : null,
  };
}

export function isRuleComplete(rule: FocRule): boolean {
  return rule.entitled && rule.buyQty !== null && rule.buyUnit !== null && rule.freeQty !== null && rule.freeUnit !== null;
}

// How many packs one unit represents for a given SKU weight.
// MC depends on the weight; outer and pack are fixed.
export function unitInPacks(unit: FocUnit, weight: string): number | null {
  if (unit === "pack") return 1;
  if (unit === "outer") return PACKS_PER_OUTER;
  const p = packsPerMc(weight);
  return p ? p.count : null;
}

export type FocReward = {
  multiples: number;      // how many times the buy threshold fits in the purchase
  freeUnits: number;      // free quantity in the rule's own unit
  freePacks: number;      // the same, converted to packs
  freeMcEquivalent: number; // freePacks / packsPerMc — for $ valuation at a $/MC tier price
};

// What a purchase of `purchaseMc` mastercases earns under the rule.
// Returns null when the rule is off/incomplete or the weight can't be parsed;
// returns multiples=0 (no free goods yet) when the purchase is below the
// buy threshold.
export function computeFocReward(rule: FocRule, purchaseMc: number, weight: string): FocReward | null {
  if (!isRuleComplete(rule) || purchaseMc <= 0) return null;
  const mcPacks = packsPerMc(weight);
  if (!mcPacks) return null;
  const buyPacks = unitInPacks(rule.buyUnit!, weight);
  const freeUnitPacks = unitInPacks(rule.freeUnit!, weight);
  if (buyPacks === null || freeUnitPacks === null) return null;
  const purchasePacks = purchaseMc * mcPacks.count;
  const threshold = rule.buyQty! * buyPacks;
  if (threshold <= 0) return null;
  const multiples = Math.floor(purchasePacks / threshold);
  const freeUnits = multiples * rule.freeQty!;
  const freePacks = freeUnits * freeUnitPacks;
  return { multiples, freeUnits, freePacks, freeMcEquivalent: freePacks / mcPacks.count };
}

function qtyLabel(qty: number, unit: FocUnit): string {
  const label = qty === 1 ? FOC_UNIT_LABEL[unit].one : FOC_UNIT_LABEL[unit].many;
  return `${qty} ${label}`;
}

// "Buy 1 MC → get 1 outer (10 packs) free"
export function ruleSentence(rule: FocRule): string | null {
  if (!isRuleComplete(rule)) return null;
  const freePart = rule.freeUnit === "outer"
    ? `${qtyLabel(rule.freeQty!, "outer")} (${rule.freeQty! * PACKS_PER_OUTER} packs)`
    : qtyLabel(rule.freeQty!, rule.freeUnit!);
  return `Buy ${qtyLabel(rule.buyQty!, rule.buyUnit!)} → get ${freePart} free`;
}
