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

// ────────────────────────────────────────────────────────────────────────────
// App-suggested FOC deals — 3 ready-made options per channel.
// Deterministic search: for each generosity tier (a target giveaway %), find
// the "Buy X unit → get Y unit free" combo whose free-goods rate lands closest
// to the target, preferring small round quantities. Weight-aware: MC size in
// packs comes from the anchor SKU weight, so a 250g anchor gets different
// numbers than a 50g one.
// ────────────────────────────────────────────────────────────────────────────

export type FocSuggestTier = "light" | "standard" | "generous";

export type FocSuggestProfile = {
  buyUnit: FocUnit;          // the unit this channel naturally buys in
  freeUnits: FocUnit[];      // allowed free-goods units, in preference order
  targets: [number, number, number]; // light / standard / generous giveaway %
  maxBuyQty?: number;        // cap on the buy threshold (default 10)
};

export type FocSuggestion = {
  tier: FocSuggestTier;
  label: string;
  buyQty: number;
  buyUnit: FocUnit;
  freeQty: number;
  freeUnit: FocUnit;
  ratePct: number;           // free packs as a % of bought packs
  rationale: string;
};

const TIER_ORDER: FocSuggestTier[] = ["light", "standard", "generous"];
const TIER_LABEL: Record<FocSuggestTier, string> = {
  light: "Light", standard: "Standard", generous: "Generous",
};
function tierRationale(tier: FocSuggestTier, ratePct: number): string {
  const pct = `${ratePct.toFixed(1).replace(/\.0$/, "")}%`;
  if (tier === "light") return `Cautious deal — about ${pct} extra product free. Good default when stock is healthy.`;
  if (tier === "standard") return `The typical trade deal — about ${pct} free. Safe to run all quarter.`;
  return `Push deal — about ${pct} free. Use when you need this channel to move volume fast.`;
}

// Returns exactly 3 distinct suggestions (light → generous), or null when the
// weight can't be parsed (MC size unknown).
export function suggestFocOptions(profile: FocSuggestProfile, weight: string): FocSuggestion[] | null {
  const buyPacksPerUnit = unitInPacks(profile.buyUnit, weight);
  if (buyPacksPerUnit === null) return null;
  const maxBuy = profile.maxBuyQty ?? 10;

  // Keep free quantities in trade-friendly ranges: nobody writes a deal as
  // "19 packs free" — that's "an outer and change". Packs may go up to 10,
  // outers to 6, MC to 3.
  const FREE_QTY_MAX: Record<FocUnit, number> = { pack: 10, outer: 6, mc: 3 };

  type Candidate = { buyQty: number; freeQty: number; freeUnit: FocUnit; ratePct: number; unitPref: number };
  const candidates: Candidate[] = [];
  profile.freeUnits.forEach((freeUnit, unitPref) => {
    const freePacksPerUnit = unitInPacks(freeUnit, weight);
    if (freePacksPerUnit === null) return;
    for (let buyQty = 1; buyQty <= maxBuy; buyQty++) {
      for (let freeQty = 1; freeQty <= FREE_QTY_MAX[freeUnit]; freeQty++) {
        const ratePct = (freeQty * freePacksPerUnit) / (buyQty * buyPacksPerUnit) * 100;
        if (ratePct < 0.5 || ratePct > 30) continue; // never suggest absurd deals
        candidates.push({ buyQty, freeQty, freeUnit, ratePct, unitPref });
      }
    }
  });
  if (candidates.length === 0) return null;

  const used = new Set<string>();
  const out: FocSuggestion[] = [];
  TIER_ORDER.forEach((tier, i) => {
    const target = profile.targets[i];
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      if (used.has(`${c.buyQty}|${c.freeQty}|${c.freeUnit}`)) continue;
      // Closest rate wins; ties broken toward small, round, preferred-unit combos.
      const score = Math.abs(c.ratePct - target) * 1000 + c.buyQty * 10 + c.freeQty * 2 + c.unitPref * 5;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) return;
    used.add(`${best.buyQty}|${best.freeQty}|${best.freeUnit}`);
    out.push({
      tier,
      label: TIER_LABEL[tier],
      buyQty: best.buyQty,
      buyUnit: profile.buyUnit,
      freeQty: best.freeQty,
      freeUnit: best.freeUnit,
      ratePct: best.ratePct,
      rationale: tierRationale(tier, best.ratePct),
    });
  });
  return out.length === 3 ? out : null;
}
