import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
import { useAppAuth } from "@/contexts/AuthContext";
import { packsPerMc, tierPricesOf, hasAnyTierPrice, type TierPrices } from "@/lib/packUnits";
import {
  focRuleOf, isRuleComplete, computeFocReward, ruleSentence,
  FOC_UNITS, FOC_UNIT_LABEL, PACKS_PER_OUTER, type FocRule, type FocUnit,
} from "@/lib/focRules";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Copy,
  TrendingDown,
  Bike,
  Gift,
  Repeat,
  Coffee,
  Crown,
  Store,
  X,
  Phone,
  MessageSquare,
  Send,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type SwapClause = "60" | "90" | "120" | "coop";
type RetailerSize = "Small" | "Medium" | "Large";
type PricingGuard = "STRICT" | "SOFT" | "FLEX";
type Risk = "Low" | "Medium" | "High";

type SkuIntel = {
  id: number;
  name: string;
  weight: string;
  category: string;
  flavor: string;
  packagingType: "Old" | "New";
  avg3m: number;
  trend: number;
  trendDirection: "growing" | "stable" | "declining";
  currentClosingStock: number;
};

type PackagingLock = "any" | "New" | "Old";

// Per-country anchor lock defaults — the user said for Syria the offer base
// MUST be Double Apple (New packaging) across every weight, paired with the
// slow movers.  Other countries fall back to Auto (scarcity-weighted pick).
type AnchorLock = { flavor: string | "auto"; packaging: PackagingLock };
const DEFAULT_ANCHOR_LOCK: Record<string, AnchorLock> = {
  Syria: { flavor: "Double Apple", packaging: "New" },
};
function defaultAnchorLockFor(country: string | null | undefined): AnchorLock {
  if (!country) return { flavor: "auto", packaging: "any" };
  return DEFAULT_ANCHOR_LOCK[country] ?? { flavor: "auto", packaging: "any" };
}

// Anchor scarcity tier — drives whether the offer leads with a "lock-in supply"
// scarcity hook (SCARCE / TIGHT) or a standard ride-along pitch (HEALTHY).
type AnchorTier = "SCARCE" | "TIGHT" | "HEALTHY" | "OVERSTOCKED";

type Anchor = SkuIntel & { moc: number; tier: AnchorTier };

function anchorTierOf(moc: number): AnchorTier {
  if (moc < 1)  return "SCARCE";
  if (moc < 2)  return "TIGHT";
  if (moc < 6)  return "HEALTHY";
  return "OVERSTOCKED";
}

// Scarcity multiplier — boost fast-movers that are running out (real leverage),
// penalise fast-movers sitting on a mountain of stock (no urgency for retailer).
function scarcityMultiplier(moc: number): number {
  if (moc < 1)  return 2.0; // SCARCE  — running out, max leverage
  if (moc < 2)  return 1.5; // TIGHT   — running low, strong leverage
  if (moc < 6)  return 1.0; // HEALTHY — normal pitch
  return 0.4;               // OVERSTOCKED — also a problem, kill its anchor priority
}

const ANCHOR_TIER_TONE: Record<AnchorTier, string> = {
  SCARCE:      "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200",
  TIGHT:       "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200",
  HEALTHY:     "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200",
  OVERSTOCKED: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200",
};

const ANCHOR_TIER_LABEL: Record<AnchorTier, string> = {
  SCARCE:      "SCARCE — running out",
  TIGHT:       "TIGHT — running low",
  HEALTHY:     "HEALTHY supply",
  OVERSTOCKED: "OVERSTOCKED",
};

// Convert months-of-stock to a friendly weeks-or-months phrase for scripts.
function stockRunwayPhrase(moc: number): string {
  if (!Number.isFinite(moc) || moc <= 0) return "almost no buffer left";
  if (moc < 1) {
    const weeks = Math.max(1, Math.round(moc * 4));
    return `about ${weeks} week${weeks === 1 ? "" : "s"} of cover left`;
  }
  if (moc < 2) {
    const weeks = Math.round(moc * 4);
    return `roughly ${weeks} weeks of cover`;
  }
  return `${moc.toFixed(1)} months of cover`;
}

type Knobs = {
  thresholdMonths: number;
  swapClause: SwapClause;
  size: RetailerSize;
  mixPct: number;        // % of slow value attached per $100 bestseller (was "free-goods cap")
  pricePerMc: number;
  pricingGuard: PricingGuard;
};

type Channel = "all" | "retail" | "wholesale" | "semiWholesale" | "horeca";

const CHANNEL_LABEL: Record<Channel, string> = {
  all:           "All channels",
  retail:        "Retail (shops & kiosks)",
  wholesale:     "Wholesale (master distributors)",
  semiWholesale: "Semi-Wholesale / Tobacconists",
  horeca:        "HoReCa (cafés & lounges)",
};

// ────────────────────────────────────────────────────────────────────────────
// POSM — point-of-sale materials (hoses, playing cards, notebooks, display
// stands…) the rep hands out at an account in exchange for branded placement.
// The list lives in the DATABASE per country (tradeOffers.posmList) so every
// planner sees the same kit.  "Analyse POSM" asks the researcher (AI, with a
// trade-practice rules fallback) to assign each material to the channels it
// suits — hoses & playing cards → HoReCa top priority, notebooks → all
// channels — filling priority, suggested qty per deal and a rationale.
// ────────────────────────────────────────────────────────────────────────────
type PomChannel = Exclude<Channel, "all">;
const POM_CHANNELS: PomChannel[] = ["retail", "wholesale", "semiWholesale", "horeca"];
const POM_CHANNEL_SHORT: Record<PomChannel, string> = {
  retail:        "Retail",
  wholesale:     "WS",
  semiWholesale: "Semi-WS",
  horeca:        "HoReCa",
};

type PomItem = {
  id: number;
  name: string;
  unitValue: number;
  channelQty: Record<PomChannel, number>;
  priority: Record<PomChannel, number> | null;  // 0 none · 1 suitable · 2 top priority (from Analyse POSM)
  rationale: string | null;
  analysisSource: string | null;                // 'ai' | 'rules' | null (never analysed)
};

function emptyChannelQty(): Record<PomChannel, number> {
  return { retail: 0, wholesale: 0, semiWholesale: 0, horeca: 0 };
}

function sanitizeQty(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// Maps a raw server row (numeric columns arrive as strings, json columns
// untyped) into the page's PomItem shape.
function pomFromRow(row: {
  id: number; name: string; unitValue: string | null;
  channelQty: unknown; priority: unknown; rationale: string | null; analysisSource: string | null;
}): PomItem {
  const cq = emptyChannelQty();
  if (row.channelQty && typeof row.channelQty === "object") {
    for (const ch of POM_CHANNELS) cq[ch] = sanitizeQty((row.channelQty as Record<string, unknown>)[ch]);
  }
  let priority: Record<PomChannel, number> | null = null;
  if (row.priority && typeof row.priority === "object") {
    priority = emptyChannelQty();
    for (const ch of POM_CHANNELS) priority[ch] = Math.max(0, Math.min(2, sanitizeQty((row.priority as Record<string, unknown>)[ch])));
  }
  return {
    id: row.id,
    name: row.name,
    unitValue: row.unitValue === null ? 0 : sanitizeQty(parseFloat(row.unitValue)),
    channelQty: cq,
    priority,
    rationale: row.rationale ?? null,
    analysisSource: row.analysisSource ?? null,
  };
}

const POSM_PRIORITY_BADGE: Record<number, { label: string; tone: string }> = {
  2: { label: "Top priority", tone: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200" },
  1: { label: "Suitable",     tone: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-200" },
};

// The kit a given channel receives — items with a non-zero qty for that channel.
type PomKit = { items: { name: string; qty: number; unitValue: number }[]; value: number };

function kitForChannel(poms: PomItem[], ch: PomChannel): PomKit {
  const items = poms
    .filter(p => p.name.trim() !== "" && p.channelQty[ch] > 0)
    .map(p => ({ name: p.name, qty: p.channelQty[ch], unitValue: p.unitValue }));
  return { items, value: items.reduce((s, i) => s + i.qty * i.unitValue, 0) };
}

function kitLine(kit: PomKit): string {
  return kit.items.map(i => `${i.qty}× ${i.name}`).join(" + ");
}

const SEVERITY = (months: number): { label: string; tone: string } => {
  if (months >= 100) return { label: "DEAD STOCK",  tone: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200" };
  if (months >= 24)  return { label: "CRITICAL",    tone: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200" };
  if (months >= 12)  return { label: "HEAVY OVER",  tone: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200" };
  return { label: "OVERSTOCK", tone: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200" };
};

function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

// Pack conversions (1 MC = 6 KG) live in the shared lib — also used by the
// SKU price list card on the SKU Management page.

// "(240 packs)" suffix for an MC quantity of a given weight; empty when the
// weight can't be parsed.
function packPhrase(mc: number, weight: string): string {
  const p = packsPerMc(weight);
  return p ? ` (${fmt(mc * p.count)} ${p.unit})` : "";
}
function ratingTone(r: Risk): string {
  return r === "Low"
    ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200"
    : r === "Medium"
    ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200"
    : "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200";
}

// ────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS — pricing, risk, swap copy.  Risk "for us" goes UP with
// generous gifts and long swaps; Appeal "to retailer" moves the same way —
// the natural tension every offer has to balance.
// ────────────────────────────────────────────────────────────────────────────

function swapWordy(swap: SwapClause, slowName: string, coopAmt: number): string {
  if (swap === "coop") return `In place of a swap, we deposit $${fmt(coopAmt, 0)} into your co-op marketing fund (Instagram boost, café night).`;
  return `If you can't sell the ${slowName} in ${swap} days, swap it 1-for-1 for any bestseller — no questions.`;
}

function pricingGuardLabel(guard: PricingGuard): string {
  if (guard === "STRICT") return "STRICT — list price untouchable on every invoice line";
  if (guard === "SOFT")   return "SOFT — up to 5% bundle promo allowed";
  return "FLEX — up to 10% invoice discount with full bundle";
}

// Tight SMS clamp — most carriers split at 160. We compose tight templates
// already, but this is a safety net for unusually long SKU names.
function clampSms(s: string): string {
  if (s.length <= 160) return s;
  return s.slice(0, 157).trimEnd() + "...";
}

function rateRisk(score: number): Risk { return score <= 33 ? "Low" : score <= 66 ? "Medium" : "High"; }
function rateAppeal(score: number): Risk { return score <= 33 ? "Low" : score <= 66 ? "Medium" : "High"; }

// Generic risk: anchor:slow ratio is the main control. Higher cap = more slow value gifted = more risk.
function riskScore(slowCases: number, anchorCases: number, k: Knobs, extra = 0): number {
  const ratio = anchorCases > 0 ? slowCases / anchorCases : 1;
  let s = 25 + ratio * 200; // 1:10 → +20, 1:5 → +40
  if (k.swapClause === "120") s += 20;
  else if (k.swapClause === "90") s += 10;
  else if (k.swapClause === "60") s += 4;
  if (k.pricingGuard === "FLEX") s += 20;
  else if (k.pricingGuard === "SOFT") s += 10;
  s += extra;
  return clamp(Math.round(s), 0, 100);
}

function appealScore(k: Knobs, extra = 0): number {
  let s = 35;
  s += Math.min(k.mixPct * 1.5, 25);
  if (k.swapClause === "120") s += 25;
  else if (k.swapClause === "90") s += 18;
  else if (k.swapClause === "60") s += 10;
  else s += 15; // co-op
  if (k.size === "Large") s += 8;
  else if (k.size === "Medium") s += 4;
  s += extra;
  return clamp(Math.round(s), 0, 100);
}

// ────────────────────────────────────────────────────────────────────────────
// OFFER DECK BUILDERS — one per template.  Each returns a fully-pre-built
// pitch with a headline, bundle table, plain-English yes/catch bullets, dual
// risk pills, and three ready-to-send scripts (phone / SMS / WhatsApp).
// ────────────────────────────────────────────────────────────────────────────

type BundleRow = { label: string; value: string };
type Deck = {
  templateId: "rideAlong" | "variety" | "subscription" | "cafe" | "retail" | "territory";
  templateName: string;
  templateTag: string;
  templateIcon: typeof Bike;
  forLine: string;
  headline: string;
  bundle: BundleRow[];
  whyYes: string[];
  catches: string[];
  ourRisk: Risk;
  retailerAppeal: Risk;
  scripts: { phone: string; sms: string; whatsapp: string };
  // Slow MC moved per deal — used by the recommended offer-mix planner.
  slowMcPerDeal: number;
  // The slow SKU whose months-of-stock should drive this deck's severity badge.
  // Each builder is responsible for picking it (Variety = first; Cafe = the
  // moderate pick; Ride-Along/Sub/Territory = the single slow they were given).
  primarySlowId: number;
};

function calcMixRatio(k: Knobs): number {
  return clamp(Math.ceil(100 / Math.max(1, k.mixPct)), 5, 15);
}

// ────────────────────────────────────────────────────────────────────────────
// Clearance basket — the multi-flavor slow side of every offer.
//
// The user's mandate: "I want the offer to deplete all the dead stock."  So
// every deck now carries a BASKET of slow flavors (not just 1 SKU), with MC
// per flavor allocated proportional to that SKU's overhang share.  The basket
// is also capped per-SKU by the actual closingStock available, so we never
// promise more dead stock than we have.
//
// `targetMc` is the total slow MC we want to fit into ONE offer; the deck
// builders compute it differently (Ride-Along ≈ anchor MC, Cafe = small,
// Territory = large, etc.).  `cyclesToClear` (computed via depletionInfo)
// then tells the rep how many times this offer needs to run to drain the
// full pile.
type BasketItem = { sku: SkuIntel; mc: number };
type Basket = { items: BasketItem[]; totalMc: number; totalDollar: number };

function clearanceBasket(slowList: SkuIntel[], targetMc: number, k: Knobs, maxFlavors = 6): Basket {
  if (slowList.length === 0 || targetMc <= 0) return { items: [], totalMc: 0, totalDollar: 0 };
  const top = slowList.slice(0, maxFlavors);
  const totalOverhang = top.reduce((s, x) => s + x.currentClosingStock, 0);
  if (totalOverhang <= 0) return { items: [], totalMc: 0, totalDollar: 0 };

  // First pass: proportional allocation, floor with a min of 1 MC per flavor,
  // capped by each SKU's closing stock.
  const items: BasketItem[] = top.map(sku => {
    const share = (sku.currentClosingStock / totalOverhang) * targetMc;
    const cap = Math.max(0, Math.floor(sku.currentClosingStock));
    return { sku, mc: Math.min(cap, Math.max(1, Math.floor(share))) };
  });

  // Distribute leftover MC to whoever still has room (favouring the
  // largest-overhang SKUs — already at the front of `top`).
  let leftover = targetMc - items.reduce((s, x) => s + x.mc, 0);
  let guard = 0;
  while (leftover > 0 && guard < items.length * 8) {
    const it = items[guard % items.length];
    if (it.mc < Math.floor(it.sku.currentClosingStock)) {
      it.mc += 1;
      leftover -= 1;
    }
    guard += 1;
  }

  const final = items.filter(it => it.mc > 0);
  const totalMc = final.reduce((s, x) => s + x.mc, 0);
  return { items: final, totalMc, totalDollar: totalMc * k.pricePerMc };
}

function basketBundleLine(basket: Basket): string {
  if (basket.items.length === 0) return "—";
  // Always include weight — when 50g/250g/1kg of the same flavor sit in the
  // basket the bare flavor name reads as a duplicate ("1 MC Grape + 1 MC
  // Grape + 1 MC Grape").  The rep needs the weight to actually pick stock
  // off the warehouse shelf.
  return basket.items.map(i => `${i.mc} MC ${i.sku.name} ${i.sku.weight}`).join(" + ");
}

function basketFlavorNames(basket: Basket): string {
  const names = basket.items.map(i => `${i.sku.name} ${i.sku.weight}`);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function depletionInfo(basket: Basket, slowList: SkuIntel[], k: Knobs) {
  const totalSlowMc = Math.floor(slowList.reduce((s, x) => s + x.currentClosingStock, 0));
  const totalSlowDollar = totalSlowMc * k.pricePerMc;
  const cycles = basket.totalMc > 0 ? Math.ceil(totalSlowMc / basket.totalMc) : 0;
  return { totalSlowMc, totalSlowDollar, cycles };
}

function depletionBundleRow(basket: Basket, slowList: SkuIntel[], k: Knobs) {
  const { totalSlowMc, totalSlowDollar, cycles } = depletionInfo(basket, slowList, k);
  return [
    { label: "Total dead stock targeted", value: `${fmt(totalSlowMc)} MC · $${fmt(totalSlowDollar)}` },
    { label: "Cycles to clear it all",    value: cycles > 0 ? `~${cycles} offer${cycles === 1 ? "" : "s"} like this` : "—" },
  ];
}

function buildRideAlong(slowList: SkuIntel[], anchor: Anchor, k: Knobs): Deck | null {
  const ratio = calcMixRatio(k);
  const anchorMc = ratio;
  // Ride-Along basket: target ≈ anchor MC (roughly 1:1) so the offer stays
  // digestible for one retailer but moves real volume of slow stock per shot.
  const basket = clearanceBasket(slowList, Math.max(2, anchorMc), k);
  if (basket.items.length === 0) return null;
  const slowMc = basket.totalMc;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const coop = k.pricePerMc * 0.06 * slowMc;
  const dep = depletionInfo(basket, slowList, k);

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k));
  const appeal = rateAppeal(appealScore(k, ratio <= 8 ? 5 : 0));

  const flavorNames = basketFlavorNames(basket);
  const swapText = swapWordy(k.swapClause, flavorNames, coop);
  const headline = `For every ${anchorMc} mastercases of ${anchor.name} you order, we add a ${slowMc}-MC clearance basket: ${basketBundleLine(basket)}. Same per-MC price across every line.`;

  const scarcityIntro =
    anchor.tier === "SCARCE"
      ? `Heads up — at your current run rate (${fmt(anchor.avg3m)} mastercases/month) you've got ${stockRunwayPhrase(anchor.moc)} on ${anchor.name}. This is your window to lock supply before the next batch.`
      : anchor.tier === "TIGHT"
      ? `Quick heads up — ${anchor.name} is running tight (${stockRunwayPhrase(anchor.moc)} at your ${fmt(anchor.avg3m)} MC/month pace). Worth locking your next order now.`
      : `You're already moving ${fmt(anchor.avg3m)} mastercases of ${anchor.name} a month.`;
  const isScarce = anchor.tier === "SCARCE" || anchor.tier === "TIGHT";
  const smsPrefix = isScarce ? `LOW STOCK ${anchor.name}: ` : "";
  const waPrefix = anchor.tier === "SCARCE"
    ? `⚠️ ${anchor.name} is running out (${stockRunwayPhrase(anchor.moc)}) — lock supply now.\n\n`
    : anchor.tier === "TIGHT"
    ? `⚠️ ${anchor.name} is running tight (${stockRunwayPhrase(anchor.moc)}).\n\n`
    : "";

  const phone = `Hi — quick one. ${scarcityIntro} Easiest deal I have this quarter: order ${anchorMc} MC of ${anchor.name} like you usually do, and I add a ${slowMc}-MC clearance basket — ${basketBundleLine(basket)} — on the same invoice at the SAME $${fmt(k.pricePerMc, 0)} per MC. Total comes to $${fmt(totalInvoice)}. ${swapText} Same per-MC price you've been paying — just a wider mix. We've got ${fmt(dep.totalSlowMc)} MC of slow stock to clear country-wide; this offer alone, run ~${dep.cycles}× across your peers, drains it. Want me to write it up?`;
  const sms = clampSms(`${smsPrefix}${anchorMc} MC ${anchor.name} + ${slowMc}-MC mix (${flavorNames}) at same $/MC. ${k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op` : `${k.swapClause}d swap`}. YES to lock.`);
  const whatsapp = `${waPrefix}Hey 👋\n\nQuick offer for ${anchor.name}: order ${anchorMc} mastercases (your usual), and we add a ${slowMc}-MC clearance basket at the same per-MC price.\n\nBasket: ${basketBundleLine(basket)}.\nTotal: $${fmt(totalInvoice)}.\n${swapText}\n\nWant me to add it to your next order?`;

  return {
    templateId: "rideAlong",
    templateName: "The Ride-Along",
    templateTag: "Simplest piggyback",
    templateIcon: Bike,
    slowMcPerDeal: slowMc,
    primarySlowId: basket.items[0].sku.id,
    forLine: `for ${flavorNames}`,
    headline,
    bundle: [
      { label: `Mastercases of bestseller (${anchor.name})`, value: `${anchorMc} MC` },
      { label: `Slow clearance basket (${basket.items.length} flavor${basket.items.length === 1 ? "" : "s"})`, value: `${slowMc} MC — ${basketBundleLine(basket)}` },
      { label: "Per-mastercase price (unchanged)",      value: `$${fmt(k.pricePerMc)} / MC` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      ...depletionBundleRow(basket, slowList, k),
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      anchor.tier === "SCARCE" || anchor.tier === "TIGHT"
        ? `${anchor.name} is running out (${stockRunwayPhrase(anchor.moc)}) — locking this order guarantees your supply doesn't break.`
        : "Same per-MC price on every line — nothing on the invoice looks like a discount.",
      `${anchor.name} is your fastest-mover; ${slowMc} MC of variety stock rides along with no extra effort.`,
      `Clears ~${Math.round((basket.totalMc / Math.max(1, dep.totalSlowMc)) * 100)}% of the country's dead stock per offer — repeat across peers and the warehouse drains in ~${dep.cycles} cycles.`,
    ],
    catches: [
      `Bundled slow MC is ${slowMc} (across ${basket.items.length} flavor${basket.items.length === 1 ? "" : "s"}) vs ${anchorMc} MC bestseller — ratio ${(anchorMc / slowMc).toFixed(1)}:1. Sharp buyers may push for more; hold the line.`,
      basket.items.some(i => i.sku.avg3m <= 2) ? "At least one basket flavor has near-zero historical sell-through — expect swap claims at day 90." : "All basket flavors still have some pulse — a single round usually clears.",
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildVarietyBuilder(slowList: SkuIntel[], anchor: Anchor, k: Knobs): Deck | null {
  const anchorMc = clamp(Math.ceil(200 / Math.max(1, k.mixPct)), 6, 12);
  // Variety is the "go wide" play — bigger basket (~anchorMc MC) across as
  // many flavors as we can fit (cap 6) so the retailer's shelf gets a full
  // refresh, not just a token bottle.
  const basket = clearanceBasket(slowList, anchorMc, k, 6);
  if (basket.items.length === 0) return null;
  const slowMc = basket.totalMc;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const coopBoost = 50 * basket.items.length;
  const dep = depletionInfo(basket, slowList, k);

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, 10));
  const appeal = rateAppeal(appealScore(k, 12));
  const flavorNames = basketFlavorNames(basket);
  const swapText = swapWordy(k.swapClause, flavorNames, coopBoost);

  const headline = `Bundle ${anchorMc} mastercases of ${anchor.name} + a ${slowMc}-MC variety basket: ${basketBundleLine(basket)}. Same per-MC price across all flavors. We add a $${coopBoost} Instagram launch fund.`;

  const phone = `Bigger play this quarter: I want to make you the only retailer in your zone carrying ${flavorNames}. Bundle is ${anchorMc} MC of ${anchor.name} + a ${slowMc}-MC variety basket (${basketBundleLine(basket)}). Same per-MC price all the way through — total $${fmt(totalInvoice)}. We add $${coopBoost} for a one-week Instagram launch and I drop off the artwork. ${swapText} ${basket.items.length + 1} flavors, one invoice, one launch — your customers see a fresh menu without you changing prices. This single bundle clears ~${Math.round((basket.totalMc / Math.max(1, dep.totalSlowMc)) * 100)}% of our country dead-stock pile.`;
  const sms = clampSms(`Launch: ${anchorMc} MC ${anchor.name} + ${slowMc} MC mix (${flavorNames}). $${fmt(totalInvoice)} + $${coopBoost} IG fund. Zone exclusive. YES?`);
  const whatsapp = `Quarterly launch idea 🎁\n\n${anchorMc} MC ${anchor.name} + ${slowMc}-MC variety basket — same per-MC price.\n\nBasket: ${basketBundleLine(basket)}.\nTotal: $${fmt(totalInvoice)} + we fund $${coopBoost} Instagram boost.\n\n${swapText}\n\nGives you ${basket.items.length} limited flavors no other shop in your zone gets. Worth a try?`;

  return {
    templateId: "variety",
    templateName: "The Variety Builder",
    templateTag: "Multi-flavor launch",
    templateIcon: Gift,
    slowMcPerDeal: slowMc,
    primarySlowId: basket.items[0].sku.id,
    forLine: `for ${flavorNames}`,
    headline,
    bundle: [
      { label: `Mastercases of bestseller (${anchor.name})`, value: `${anchorMc} MC` },
      { label: `Variety basket (${basket.items.length} flavors)`, value: `${slowMc} MC — ${basketBundleLine(basket)}` },
      { label: "Per-mastercase price (unchanged)",      value: `$${fmt(k.pricePerMc)} / MC` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      ...depletionBundleRow(basket, slowList, k),
      { label: "Marketing fund we add",                  value: `$${fmt(coopBoost)} (Instagram launch)` },
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `Bundled into the $${fmt(coopBoost, 0)} fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      `${basket.items.length} limited flavors no other retailer in your zone gets — your shelf looks fresher than the competition's.`,
      `Same per-MC price on all ${basket.items.length + 1} flavors — no awkward discount conversation with your accountant.`,
      `$${coopBoost} Instagram fund covers a week+ of paid posts — pulls customers in instead of pushing product onto them.`,
    ],
    catches: [
      `${basket.items.length} slow flavors at once = ${basket.items.length}× swap-back exposure if none move. Make sure the retailer can run the launch within 30 days.`,
      `Bigger commitment than the simple Ride-Along — only pitch this to retailers who already trust you with ${anchor.name} volume.`,
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildSubscriptionLock(slowList: SkuIntel[], anchor: Anchor, k: Knobs): Deck | null {
  const weeks = 4;
  const weeklyAnchor = Math.max(2, Math.ceil(calcMixRatio(k) / 2));
  // Subscription's basket is the FULL 4-week pile — distribute across up to
  // 4 flavors so each weekly drop carries some variety (totalMc/weeks per
  // shipment).  The user pays for bestseller MC only; slow MC are the loyalty
  // gift.
  const weeklySlowTarget = Math.max(2, Math.ceil(weeklyAnchor / 2));
  const totalSlowTarget = weeklySlowTarget * weeks;
  const basket = clearanceBasket(slowList, totalSlowTarget, k, 4);
  if (basket.items.length === 0) return null;
  const totalSlow = basket.totalMc;
  const totalAnchor = weeklyAnchor * weeks;
  const billedInvoice = totalAnchor * k.pricePerMc;
  const slowGiftValue = totalSlow * k.pricePerMc;
  const coop = k.pricePerMc * 0.06 * totalSlow;
  const dep = depletionInfo(basket, slowList, k);

  const ourRisk = rateRisk(riskScore(totalSlow, totalAnchor, k, -5));
  const appeal = rateAppeal(appealScore(k, k.size === "Small" ? -5 : 5));
  const flavorNames = basketFlavorNames(basket);
  const swapText = swapWordy(k.swapClause, flavorNames, coop);

  const headline = `Commit to ${weeklyAnchor} mastercases of ${anchor.name} every week for 4 weeks. Across the program we throw in a ${totalSlow}-MC slow basket at no extra charge: ${basketBundleLine(basket)}.`;

  const phone = `Different angle: instead of one big order, let's do a 4-week program. Every week I deliver ${weeklyAnchor} MC of ${anchor.name} and across the month I throw in a ${totalSlow}-MC variety basket — ${basketBundleLine(basket)} — at no extra charge. After 4 weeks: $${fmt(billedInvoice)} total invoice (you only pay for the bestseller MC — the slow basket is on us, $${fmt(slowGiftValue)} retail value). Paid weekly so it's easy on cash flow. ${swapText} Two big wins: your shelf is locked for a month so my competitors can't get in, and you discover which of these flavors clicks with your customers without a big upfront bet. This program alone, repeated ~${dep.cycles}× across our key accounts, drains the country dead pile.`;
  const sms = clampSms(`4-wk: ${weeklyAnchor} MC ${anchor.name}/wk + ${totalSlow} FREE MC mix (${flavorNames}) over the program. Pay $${fmt(billedInvoice)}. Weekly bill. YES?`);
  const whatsapp = `4-week subscription plan 🔁\n\nWeekly: ${weeklyAnchor} MC ${anchor.name}.\nAcross the month: ${totalSlow}-MC FREE variety basket — ${basketBundleLine(basket)}.\nYou pay: $${fmt(billedInvoice)} over 4 weeks (bestseller MC only — slow basket on us, $${fmt(slowGiftValue)} retail value).\nBilled weekly — easier cash flow.\n\n${swapText}\n\nLocks your shelf for a month, blocks competing reps, and you find out which new flavor clicks with your customers.`;

  return {
    templateId: "subscription",
    templateName: "The Subscription Lock",
    templateTag: "4-week recurring",
    templateIcon: Repeat,
    slowMcPerDeal: totalSlow,
    primarySlowId: basket.items[0].sku.id,
    forLine: `for ${flavorNames}`,
    headline,
    bundle: [
      { label: "Program length",                            value: "4 weeks" },
      { label: `Weekly: bestseller (${anchor.name})`,       value: `${weeklyAnchor} MC × 4 = ${totalAnchor} MC (billed)` },
      { label: `Slow basket across program (${basket.items.length} flavors)`, value: `${totalSlow} MC FREE — ${basketBundleLine(basket)}` },
      { label: "Per-mastercase price (unchanged)",           value: `$${fmt(k.pricePerMc)} / MC` },
      { label: "Total invoice (you pay)",                    value: `$${fmt(billedInvoice)}` },
      { label: "Slow-basket gift value",                     value: `$${fmt(slowGiftValue)} (retail)` },
      ...depletionBundleRow(basket, slowList, k),
      { label: "Billing",                                    value: "Weekly invoices, easier cash flow" },
      { label: "Pricing approach",                           value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      "Smooths cash flow — no big single payment, billed weekly as you sell.",
      "Locks the shelf for a month — competing reps can't get an order in until day 28.",
      `You discover which of ${basket.items.length} new flavors works for your customer without a big upfront bet.`,
    ],
    catches: [
      "Requires a 4-week commitment — if the retailer cancels mid-program, the deal becomes a regular Ride-Along (no penalty, but no free flavors either).",
      "Need a clean weekly logistics slot — confirm delivery day before you sign.",
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildCafeStarter(slowList: SkuIntel[], anchor: Anchor, k: Knobs): Deck | null {
  const anchorMc = 3;
  // Cafe is the smallest entry — 2-MC sample basket across up to 2 flavors so
  // a small café can taste-test without a real commitment.
  const basket = clearanceBasket(slowList, 2, k, 2);
  if (basket.items.length === 0) return null;
  const slowMc = basket.totalMc;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const demoValue = 150;
  const coop = k.pricePerMc * 0.06 * slowMc;
  const dep = depletionInfo(basket, slowList, k);

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, 10));
  const appeal = rateAppeal(appealScore(k, 15));
  const flavorNames = basketFlavorNames(basket);
  const swapText = swapWordy(k.swapClause, flavorNames, coop);

  const headline = `Smallest bundle: 3 mastercases of ${anchor.name} + a ${slowMc}-MC sample basket (${basketBundleLine(basket)}). Plus a free Friday-night hookah-master demo at your café (worth $${demoValue}).`;

  const phone = `For your café specifically — small bundle, big experience. 3 MC of ${anchor.name} + a ${slowMc}-MC sample basket (${basketBundleLine(basket)}), total $${fmt(totalInvoice)}. Same per-MC price. The kicker: I send our hookah-master to your café for one Friday-night demo session — that's a $${demoValue} package on us. He builds a crowd around the new flavors, you sell hookahs and food all night, and the slow basket sells itself by Saturday. ${swapText} One of the easiest "yes" deals I have.`;
  const sms = clampSms(`Café deal: 3 MC ${anchor.name} + ${slowMc} MC mix (${flavorNames}) = $${fmt(totalInvoice)}. + FREE Fri demo ($${demoValue}). YES?`);
  const whatsapp = `Café-sized bundle ☕\n\n3 MC ${anchor.name} + ${slowMc}-MC sample basket (${basketBundleLine(basket)}) = $${fmt(totalInvoice)}.\n\n+ FREE hookah-master Friday-night demo at your café (worth $${demoValue}).\n\n${swapText}\n\nDemo brings new customers in, basket sells itself by Saturday. Want a slot this month?`;

  return {
    templateId: "cafe",
    templateName: "The Café Starter Pack",
    templateTag: "Small-account entry",
    templateIcon: Coffee,
    slowMcPerDeal: slowMc,
    primarySlowId: basket.items[0].sku.id,
    forLine: `for ${flavorNames}`,
    headline,
    bundle: [
      { label: `Mastercases of bestseller (${anchor.name})`, value: `${anchorMc} MC` },
      { label: `Sample basket (${basket.items.length} flavor${basket.items.length === 1 ? "" : "s"})`, value: `${slowMc} MC — ${basketBundleLine(basket)}` },
      { label: "Per-mastercase price (unchanged)",      value: `$${fmt(k.pricePerMc)} / MC` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "What we add",                            value: `Free Friday-night hookah-master demo (worth $${demoValue})` },
      ...depletionBundleRow(basket, slowList, k),
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      "Smallest bundle we offer — fits a single shelf and one weekend's traffic.",
      "Free hookah-master demo brings new customers in — the sample basket sells itself by Saturday.",
      "No commitment beyond this one bundle — pitch it as a no-brainer.",
    ],
    catches: [
      "Demo costs us real money — only worth it for cafés that can host on a Friday night and have a real customer base.",
      `Cafe-sized basket clears ${slowMc} MC per offer — needs ~${dep.cycles} small-café accounts to drain the full pile.`,
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildTerritoryExclusive(slowList: SkuIntel[], anchor: Anchor, k: Knobs): Deck | null {
  const anchorMc = 20;
  // Territory is the "big distributor takes a real chunk" play — big basket
  // (~20 MC) across many flavors; one 90-day exclusivity covers the lead
  // flavor (largest piece of the basket).
  const basket = clearanceBasket(slowList, 20, k, 6);
  if (basket.items.length === 0) return null;
  const slowMc = basket.totalMc;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const coop = k.pricePerMc * 0.06 * slowMc;
  const dep = depletionInfo(basket, slowList, k);
  const leadFlavor = basket.items[0].sku;

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, 10));
  const appeal = rateAppeal(appealScore(k, 15));
  const flavorNames = basketFlavorNames(basket);
  const swapText = swapWordy(k.swapClause, flavorNames, coop);

  const headline = `Mega bundle: 20 mastercases of ${anchor.name} + a ${slowMc}-MC clearance basket (${basketBundleLine(basket)}). Plus 90-day exclusive territory rights for ${leadFlavor.name} in your zone.`;

  const phone = `Reserved for our top distributors only. Bundle is 20 MC ${anchor.name} + a ${slowMc}-MC clearance basket — ${basketBundleLine(basket)} — same per-MC price all the way, total $${fmt(totalInvoice)}. The big lever: you get 90-day exclusive territory rights for ${leadFlavor.name} in your zone. No other distributor can carry that flavor in your area for three months. We also book a quarterly business review with our planning lead — early access to new flavors before they hit the country. ${swapText} You scale, we scale, and your competitors are locked out. This single bundle clears ~${Math.round((basket.totalMc / Math.max(1, dep.totalSlowMc)) * 100)}% of our country dead pile in one shot.`;
  const sms = clampSms(`Master deal: 20 MC ${anchor.name} + ${slowMc} MC mix (${flavorNames}) = $${fmt(totalInvoice)}. + 90d EXCLUSIVE ${leadFlavor.name}. Reply CALL.`);
  const whatsapp = `Reserved for top distributors 👑\n\n20 MC ${anchor.name} + ${slowMc}-MC clearance basket = $${fmt(totalInvoice)} (same per-MC price).\n\nBasket: ${basketBundleLine(basket)}.\n+ 90-day EXCLUSIVE territory rights for ${leadFlavor.name} in your zone.\n+ Quarterly business review with our planning lead.\n\n${swapText}\n\nLet's set up a call to walk through it.`;

  return {
    templateId: "territory",
    templateName: "The Territory Exclusive",
    templateTag: "Master distributor deal",
    templateIcon: Crown,
    slowMcPerDeal: slowMc,
    primarySlowId: leadFlavor.id,
    forLine: `for ${flavorNames}`,
    headline,
    bundle: [
      { label: `Mastercases of bestseller (${anchor.name})`, value: `${anchorMc} MC` },
      { label: `Clearance basket (${basket.items.length} flavors)`, value: `${slowMc} MC — ${basketBundleLine(basket)}` },
      { label: "Per-mastercase price (unchanged)",      value: `$${fmt(k.pricePerMc)} / MC` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "Exclusive territory rights",            value: `90 days for ${leadFlavor.name}` },
      { label: "Bonus",                                  value: "Quarterly business review + early access to new flavors" },
      ...depletionBundleRow(basket, slowList, k),
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      `Only distributor in your zone with ${leadFlavor.name} for 90 days — your competition can't list it at any price.`,
      "Quarterly business review = early access to new flavors before the rest of the country sees them.",
      `Largest single-shot clearance — ${slowMc} MC of slow stock moved per bundle (~${Math.round((basket.totalMc / Math.max(1, dep.totalSlowMc)) * 100)}% of country dead pile).`,
    ],
    catches: [
      `Big upfront commitment — your warehouse needs to absorb ${anchorMc + slowMc} MC. Make sure the retailer has the cash and the shelf.`,
      `Exclusivity ends at day 90; renewal requires hitting 60% sell-through on ${leadFlavor.name}.`,
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildRetailShelf(slowList: SkuIntel[], anchor: Anchor, k: Knobs, poms: PomItem[]): Deck | null {
  // Shop-sized order — half the Ride-Along ratio so a single retailer's
  // shelf can absorb it, with a small clearance basket (max 3 flavors).
  // The hook is the POM kit: free point-of-sale materials in exchange for
  // 60 days of branded display with the slow flavors at eye level.
  const anchorMc = Math.max(4, Math.ceil(calcMixRatio(k) / 2));
  const basket = clearanceBasket(slowList, Math.max(2, Math.ceil(anchorMc / 2)), k, 3);
  if (basket.items.length === 0) return null;
  const slowMc = basket.totalMc;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const kit = kitForChannel(poms, "retail");
  const pomValue = kit.value;
  const pomList = kitLine(kit);
  const displayDays = 60;
  const coop = k.pricePerMc * 0.06 * slowMc;
  const dep = depletionInfo(basket, slowList, k);

  // Kit value adds a little risk for us (real money on the wall) and a lot
  // of appeal for the retailer (free branded shop makeover).
  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, Math.min(15, Math.round(pomValue / 20))));
  const appeal = rateAppeal(appealScore(k, 8 + Math.min(17, Math.round(pomValue / 12))));
  const flavorNames = basketFlavorNames(basket);
  const swapText = swapWordy(k.swapClause, flavorNames, coop);

  const kitPhrase = pomValue > 0 ? ` + a FREE point-of-sale kit worth $${fmt(pomValue)} (${pomList})` : "";
  const headline = `Shop shelf package: ${anchorMc} mastercases of ${anchor.name} + a ${slowMc}-MC clearance basket (${basketBundleLine(basket)})${kitPhrase} — in exchange for ${displayDays} days of branded display with the new flavors at eye level.`;

  const phone = `Built for shops like yours. You take ${anchorMc} MC of ${anchor.name} — your proven seller — plus a ${slowMc}-MC clearance basket (${basketBundleLine(basket)}), all at the same $${fmt(k.pricePerMc, 0)} per MC, total $${fmt(totalInvoice)}. ${pomValue > 0 ? `On top, I bring you a complete point-of-sale kit — ${pomList} — worth $${fmt(pomValue)}, completely free. Your shop looks like a flagship without you spending a dollar. ` : ""}One condition: the branded display stays up for ${displayDays} days with the new flavors at eye level — my rep photographs it on his normal visit. ${swapText} Shelf presence sells shisha — the display does the talking while you serve customers. Shall I book the install this week?`;
  const sms = clampSms(`Shop deal: ${anchorMc} MC ${anchor.name} + ${slowMc} MC mix${pomValue > 0 ? ` + FREE POS kit ($${fmt(pomValue)})` : ""}. ${displayDays}d display. Same $/MC. YES to book.`);
  const whatsapp = `Retail shelf package 🏪\n\n${anchorMc} MC ${anchor.name} + ${slowMc}-MC clearance basket = $${fmt(totalInvoice)} (same per-MC price).\nBasket: ${basketBundleLine(basket)}.\n${pomValue > 0 ? `\nFREE point-of-sale kit — worth $${fmt(pomValue)}:\n${kit.items.map(p => `• ${p.qty}× ${p.name}`).join("\n")}\n` : ""}\nDeal: branded display stays up ${displayDays} days, new flavors at eye level.\n${swapText}\n\nWant the kit installed this week?`;

  return {
    templateId: "retail",
    templateName: "The Retail Shelf Takeover",
    templateTag: "POS kit + display deal",
    templateIcon: Store,
    slowMcPerDeal: slowMc,
    primarySlowId: basket.items[0].sku.id,
    forLine: `for ${flavorNames}`,
    headline,
    bundle: [
      { label: `Mastercases of bestseller (${anchor.name})`, value: `${anchorMc} MC` },
      { label: `Clearance basket (${basket.items.length} flavor${basket.items.length === 1 ? "" : "s"})`, value: `${slowMc} MC — ${basketBundleLine(basket)}` },
      { label: "Per-mastercase price (unchanged)",      value: `$${fmt(k.pricePerMc)} / MC` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "FREE point-of-sale kit (POMs)",          value: pomValue > 0 ? `$${fmt(pomValue)} — ${pomList}` : "None assigned to Retail — set channel qtys in Offer settings" },
      { label: "Display commitment",                     value: `${displayDays} days branded display, new flavors at eye level` },
      ...depletionBundleRow(basket, slowList, k),
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      pomValue > 0
        ? `Free POS kit worth $${fmt(pomValue)} — ${pomList}. The shop looks like a flagship at zero cost to the owner.`
        : "Branded display support makes the shop look like a flagship at zero cost to the owner.",
      "Eye-level placement does the selling — impulse pick-up moves the clearance basket without the owner lifting a finger.",
      `Same per-MC price on every line, and the swap promise removes the risk — worst case, unsold basket flavors go back for more ${anchor.name}.`,
    ],
    catches: [
      `The kit is earned, not given — it stays only while the display stays up. Rep photographs the shelf on every visit; pull the kit if the display comes down before day ${displayDays}.`,
      "Only issue POS kits on verifiable routes — never ship a kit to an account the rep doesn't physically visit.",
      pomValue === 0
        ? "No POMs assigned to the Retail channel yet — set a Retail qty on your point-of-sale materials in Offer settings to give this offer its hook."
        : `Shop-sized basket clears ${slowMc} MC per deal — needs ~${dep.cycles} retail accounts to drain the full pile.`,
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

// Channel → which deck templates to surface, in order.  "all" surfaces every
// template; the channel-specific lists hide decks that don't fit and reorder
// the rest so the most-relevant pitch sits at the top.
const CHANNEL_DECK_PRIORITY: Record<Channel, Deck["templateId"][]> = {
  all:           ["rideAlong", "variety", "subscription", "cafe", "retail", "territory"],
  retail:        ["retail", "variety", "rideAlong"],
  wholesale:     ["territory", "variety", "rideAlong"],
  semiWholesale: ["rideAlong", "subscription", "retail"],
  horeca:        ["cafe", "rideAlong", "subscription"],
};

// Which channel each deck is naturally pitched to — decides which POS kit
// gets stacked onto it.
const DECK_HOME_CHANNEL: Record<Deck["templateId"], PomChannel> = {
  rideAlong:    "semiWholesale",
  variety:      "retail",
  subscription: "semiWholesale",
  cafe:         "horeca",
  retail:       "retail",
  territory:    "wholesale",
};

// Stack the channel-matched POS kit onto a deck.  The Retail Shelf Takeover
// already builds its kit into its own copy, so it is skipped here.  SMS is
// left alone (160-char budget).
function withChannelKit(deck: Deck, poms: PomItem[]): Deck {
  if (deck.templateId === "retail") return deck;
  const ch = DECK_HOME_CHANNEL[deck.templateId];
  const kit = kitForChannel(poms, ch);
  if (kit.value <= 0 || kit.items.length === 0) return deck;
  const line = kitLine(kit);
  const bundle = [...deck.bundle];
  const row = { label: `FREE POS kit (${POM_CHANNEL_SHORT[ch]} channel)`, value: `$${fmt(kit.value)} — ${line}` };
  const invoiceIdx = bundle.findIndex(r => r.label.startsWith("Total invoice"));
  if (invoiceIdx >= 0) bundle.splice(invoiceIdx + 1, 0, row); else bundle.push(row);
  return {
    ...deck,
    bundle,
    whyYes: [
      ...deck.whyYes,
      `Free point-of-sale kit worth $${fmt(kit.value)} (${line}) — our rep installs it; it stays as long as it stays on display.`,
    ],
    scripts: {
      ...deck.scripts,
      phone: `${deck.scripts.phone} One more thing — I include a free point-of-sale kit for you: ${line}, worth $${fmt(kit.value)}. It stays as long as it's on display.`,
      whatsapp: `${deck.scripts.whatsapp}\n\nFREE POS kit: ${line} (worth $${fmt(kit.value)}) — ours to install, yours to keep while it's displayed.`,
    },
  };
}

// Build up to 6 ready-to-apply decks given the slow-SKU list and an anchor.
// Each builder may return null when the basket comes up empty (e.g. all
// candidates have closingStock === 0 after capping); we silently drop those.
// Every deck then gets its channel's POS kit stacked on.
function buildAllDecks(slowList: SkuIntel[], anchor: Anchor, k: Knobs, poms: PomItem[]): Deck[] {
  const builders = [
    () => buildRideAlong(slowList, anchor, k),
    () => slowList.length >= 2 ? buildVarietyBuilder(slowList, anchor, k) : null,
    () => buildSubscriptionLock(slowList, anchor, k),
    () => buildCafeStarter(slowList, anchor, k),
    () => buildRetailShelf(slowList, anchor, k, poms),
    () => buildTerritoryExclusive(slowList, anchor, k),
  ];
  return builders
    .map(b => b())
    .filter((d): d is Deck => d !== null)
    .map(d => withChannelKit(d, poms));
}

// ────────────────────────────────────────────────────────────────────────────
// Marketeer's recommended offer mix — how a trade marketeer would split the
// dead-stock pile across channels.  Shares reflect standard tobacco-trade
// wisdom: wholesale moves the most MC per negotiation, retail buys shelf
// presence with POS kits, semi-wholesale/tobacconists piggyback existing
// weekly orders, HoReCa builds trial.
// ────────────────────────────────────────────────────────────────────────────
const MIX_STRATEGY: { channel: PomChannel; share: number; template: Deck["templateId"]; why: string }[] = [
  { channel: "wholesale",     share: 0.45, template: "territory", why: "Few negotiations, most MC — a handful of master-distributor deals drains the pile fastest." },
  { channel: "retail",        share: 0.25, template: "retail",    why: "POS kits buy 60 days of eye-level display — dead flavors sell on impulse when they're visible." },
  { channel: "semiWholesale", share: 0.18, template: "rideAlong", why: "Tobacconists buy weekly — small baskets piggyback on bestseller orders already going out." },
  { channel: "horeca",        share: 0.12, template: "cafe",      why: "Cafés create trial and word of mouth — a slow flavor that clicks in HoReCa pulls retail behind it." },
];

// ────────────────────────────────────────────────────────────────────────────
// APPLY OFFER — the presentable per-channel trade-offer sheet.  Every channel
// gets: a bestseller BUY line, a FOC (free-of-charge) basket of slow flavors,
// and the channel's POS kit.  Built to be read to an account or copied into
// WhatsApp as-is — usable any time, anywhere.
// ────────────────────────────────────────────────────────────────────────────
type ChannelOffer = {
  channel: PomChannel;
  title: string;
  anchor: Anchor;
  anchorMc: number;
  invoice: number;
  basket: Basket;        // the FOC products
  focValue: number;
  kit: PomKit;
  totalFreeValue: number;
  terms: string[];
  // FOC entitlement rule ("Buy X → get Y free") applied to the anchor buy:
  entitlement: {
    sentence: string;        // "Buy 1 MC → get 1 outer (10 packs) free"
    freeUnits: number;       // in the rule's own unit
    freeUnitLabel: string;   // "outers" / "packs" / "MC"
    freePacks: number;
    valueDollars: number;    // freeMcEquivalent × the channel's anchor buy price
  } | null;
  // Supply-chain price list integration (SKU Management → price list):
  buyPricePerMc: number;          // $/MC the buyer actually pays for the anchor
  usedTierPrice: boolean;         // true when buyPricePerMc came from the price list (not the WS list fallback)
  ladder: TierPrices | null;      // the anchor's four price tiers, when any are set
  margin: { resalePerMc: number; perMc: number; label: string } | null; // buyer's sell-on story
};

// Which price tier each channel buys at.  Wholesale buys from us; Semi-WS
// buys from WS; Retail and HoReCa buy at the Semi-WS → Retail price.
function channelBuyPrice(ch: PomChannel, tp: TierPrices | null): number | null {
  if (!tp) return null;
  if (ch === "wholesale") return tp.toWs;
  if (ch === "semiWholesale") return tp.wsToSemiWs;
  return tp.semiWsToRetail; // retail + horeca
}

// The buyer's next step in the chain — what they resell at, per MC.
function channelMargin(ch: PomChannel, tp: TierPrices | null, buy: number | null, anchorWeight: string): ChannelOffer["margin"] {
  if (!tp || buy === null) return null;
  if (ch === "wholesale" && tp.wsToSemiWs !== null) {
    return { resalePerMc: tp.wsToSemiWs, perMc: tp.wsToSemiWs - buy, label: "selling on to Semi-WS / Tobacconists" };
  }
  if (ch === "semiWholesale" && tp.semiWsToRetail !== null) {
    return { resalePerMc: tp.semiWsToRetail, perMc: tp.semiWsToRetail - buy, label: "selling on to Retail" };
  }
  if (ch === "retail" && tp.rspPerPack !== null) {
    const p = packsPerMc(anchorWeight);
    if (!p) return null;
    const resale = tp.rspPerPack * p.count;
    return { resalePerMc: resale, perMc: resale - buy, label: `selling at the $${fmt(tp.rspPerPack, 2)} RSP per ${p.unit === "packs" ? "pack" : "piece"}` };
  }
  return null; // horeca consumes the product — no resale story
}

const OFFER_CHANNEL_PARAMS: Record<PomChannel, { anchorMc: number; maxFlavors: number; title: string; commitment: string }> = {
  wholesale:     { anchorMc: 20, maxFlavors: 4, title: "Wholesale Partner Offer",             commitment: "Distribute the FOC flavors across your active routes within 30 days." },
  retail:        { anchorMc: 6,  maxFlavors: 3, title: "Retail Shelf Offer",                  commitment: "Branded display stays up 60 days with the FOC flavors at eye level." },
  semiWholesale: { anchorMc: 10, maxFlavors: 3, title: "Semi-Wholesale / Tobacconist Offer",  commitment: "Keep the FOC flavors visible at the counter for 60 days." },
  horeca:        { anchorMc: 3,  maxFlavors: 2, title: "HoReCa Starter Offer",                commitment: "Feature the FOC flavors on the menu for 45 days." },
};

function buildChannelOffer(
  ch: PomChannel,
  anchor: Anchor,
  slowList: SkuIntel[],
  k: Knobs,
  poms: PomItem[],
  priceOf: (skuId: number) => TierPrices | null,
  focRule: FocRule,
): ChannelOffer | null {
  const p = OFFER_CHANNEL_PARAMS[ch];
  // FOC size follows the Mix portion knob: FOC MC = mix% of the bestseller MC
  // bought, rounded UP (min 1 MC so every channel really does get FOC product).
  const focTarget = Math.max(1, Math.ceil(p.anchorMc * (k.mixPct / 100)));
  const basket = clearanceBasket(slowList, focTarget, k, p.maxFlavors);
  if (basket.items.length === 0) return null;
  // Supply-chain price list: each channel is invoiced at its own tier price
  // when one is set on the anchor SKU; otherwise fall back to the WS list
  // price knob.  FOC value follows the same rule per basket SKU.
  const anchorTiers = priceOf(anchor.id);
  const tierBuy = channelBuyPrice(ch, anchorTiers);
  const buyPricePerMc = tierBuy ?? k.pricePerMc;
  const invoice = p.anchorMc * buyPricePerMc;
  const focValue = basket.items.reduce((sum, i) => {
    const itemBuy = channelBuyPrice(ch, priceOf(i.sku.id)) ?? k.pricePerMc;
    return sum + i.mc * itemBuy;
  }, 0);
  const kit = kitForChannel(poms, ch);
  const ladder = anchorTiers && hasAnyTierPrice(anchorTiers) ? anchorTiers : null;
  // FOC entitlement — the channel's "Buy X → get Y free" rule applied to the
  // anchor purchase.  Free goods are MORE of the anchor SKU itself, valued at
  // the channel's buy price so the % is honest.
  const reward = isRuleComplete(focRule) ? computeFocReward(focRule, p.anchorMc, anchor.weight) : null;
  const sentence = ruleSentence(focRule);
  const entitlement = reward && sentence && reward.freePacks > 0
    ? {
        sentence,
        freeUnits: reward.freeUnits,
        freeUnitLabel: reward.freeUnits === 1 ? FOC_UNIT_LABEL[focRule.freeUnit!].one : FOC_UNIT_LABEL[focRule.freeUnit!].many,
        freePacks: reward.freePacks,
        valueDollars: reward.freeMcEquivalent * buyPricePerMc,
      }
    : null;
  return {
    channel: ch,
    title: p.title,
    anchor,
    anchorMc: p.anchorMc,
    invoice,
    basket,
    focValue,
    kit,
    entitlement,
    totalFreeValue: focValue + kit.value + (entitlement?.valueDollars ?? 0),
    buyPricePerMc,
    usedTierPrice: tierBuy !== null,
    ladder,
    // Margin story only when the buy price really came from the price list —
    // mixing the fallback list price with downstream tiers would mislead.
    margin: tierBuy !== null ? channelMargin(ch, anchorTiers, buyPricePerMc, anchor.weight) : null,
    terms: [
      p.commitment,
      entitlement ? `FOC entitlement for ${CHANNEL_LABEL[ch]}: ${sentence} — applied automatically on every qualifying order.` : "",
      kit.value > 0 ? "POS kit is installed by our rep and stays as long as it stays on display." : "",
      "FOC products are free of charge on the same delivery — no hidden conditions.",
      tierBuy !== null
        ? `Invoiced at your ${CHANNEL_LABEL[ch]} tier price — $${fmt(buyPricePerMc, 2)}/MC per the supply-chain price list, unchanged.`
        : `Prices per official list — $${fmt(k.pricePerMc, 0)}/MC, unchanged.`,
      "Offer valid 14 days from presentation.",
    ].filter(t => t !== ""),
  };
}

function offerCopyText(o: ChannelOffer, country: string): string {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const lines = [
    `AL FAKHER — ${o.title.toUpperCase()}`,
    `${CHANNEL_LABEL[o.channel]} · ${country} · ${date}`,
    "",
    `BUY: ${o.anchorMc} MC ${o.anchor.name} ${o.anchor.weight}${packPhrase(o.anchorMc, o.anchor.weight)} — $${fmt(o.invoice)} ($${fmt(o.buyPricePerMc, 2)}/MC)`,
    "",
    `FREE OF CHARGE (FOC) — worth $${fmt(o.focValue)}:`,
    ...o.basket.items.map(i => `• ${i.mc} MC ${i.sku.name} ${i.sku.weight}${packPhrase(i.mc, i.sku.weight)}`),
  ];
  if (o.entitlement) {
    lines.push(
      "",
      `YOUR FOC ENTITLEMENT (${o.entitlement.sentence}):`,
      `• ${fmt(o.entitlement.freeUnits)} ${o.entitlement.freeUnitLabel} of ${o.anchor.name} ${o.anchor.weight} free (${fmt(o.entitlement.freePacks)} packs) — worth $${fmt(o.entitlement.valueDollars)}`,
    );
  }
  if (o.kit.value > 0) {
    lines.push("", `FREE POS KIT — worth $${fmt(o.kit.value)}:`, ...o.kit.items.map(i => `• ${i.qty}× ${i.name}`));
  }
  lines.push(
    "",
    `TOTAL FREE VALUE: $${fmt(o.totalFreeValue)} on a $${fmt(o.invoice)} order`,
  );
  if (o.margin && o.margin.perMc > 0) {
    lines.push(
      "",
      `YOUR MARGIN: buy at $${fmt(o.buyPricePerMc, 2)}/MC, ${o.margin.label} at $${fmt(o.margin.resalePerMc, 2)}/MC — $${fmt(o.margin.perMc, 2)}/MC in your pocket ($${fmt(o.margin.perMc * o.anchorMc)} on this order, before the free product).`,
    );
  }
  if (o.ladder) {
    const l = o.ladder;
    const parts = [
      l.toWs !== null ? `To WS $${fmt(l.toWs, 2)}/MC` : "",
      l.wsToSemiWs !== null ? `WS→Semi-WS $${fmt(l.wsToSemiWs, 2)}/MC` : "",
      l.semiWsToRetail !== null ? `Semi-WS→Retail $${fmt(l.semiWsToRetail, 2)}/MC` : "",
      l.rspPerPack !== null ? `RSP $${fmt(l.rspPerPack, 2)}/pack` : "",
    ].filter(s => s !== "");
    if (parts.length > 0) lines.push("", `PRICE LADDER (${o.anchor.name} ${o.anchor.weight}): ${parts.join(" · ")}`);
  }
  lines.push(
    "",
    "TERMS:",
    ...o.terms.map(t => `• ${t}`),
  );
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// UI sub-components
// ────────────────────────────────────────────────────────────────────────────

const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Bestseller anchor", meaning: "The SKU your customer is already moving fast — the engine of every offer. Picked by velocity weighted by scarcity (a fast-mover that's running OUT beats one sitting on healthy stock — it gives you real leverage)." },
  { term: "Anchor scarcity tier", meaning: "SCARCE (<1 month cover), TIGHT (1–2 mo), HEALTHY (2–6 mo), OVERSTOCKED (≥6 mo). When SCARCE/TIGHT, the phone script leads with a 'lock supply now' hook." },
  { term: "Slow flavor",    meaning: "A SKU sitting in the warehouse longer than your stock-month threshold (the slider above). Ranked by $ overhang (closing stock × $/MC) so the biggest cash drag rises first." },
  { term: "Dollar overhang", meaning: "Closing stock × $/MC for a slow flavor — how much cash is tied up in that SKU. Drives the slow-list ranking." },
  { term: "Mastercase (MC)", meaning: "One full mastercase from the warehouse — the unit every order, invoice and bundle on this page is denominated in." },
  { term: "POSM (point-of-sale material)", meaning: "Hoses, playing cards, notebooks, display stands, posters — physical marketing items the rep hands out at an account in exchange for branded placement. The list is saved in the database per country; 'Analyse POSM' assigns each material to the channels it suits (hoses & playing cards → cafés first, notebooks → everywhere). Each channel's kit stacks onto the offer pitched to that channel." },
  { term: "FOC (free of charge)",         meaning: "Product we hand over free with the order — the slow-flavor basket in the Apply Offer sheet. The customer pays for the bestseller MC only; the FOC MC ride on the same delivery at no cost." },
  { term: "FOC entitlement rule",         meaning: "The 'Buy X → get Y free' deal each channel is entitled to, set in Offer settings — e.g. Wholesale: buy 1 MC → get 1 outer free; Retail: buy 3 outers → get 1 pack free. A channel switched OFF gets no offer sheet at all. The free goods are more of the bestseller the customer is already buying." },
  { term: "Outer",                        meaning: `A carton of ${PACKS_PER_OUTER} packs — the middle unit between a pack and a mastercase. FOC entitlement rules can be written in packs, outers or MC.` },
  { term: "Supply-chain price list",      meaning: "The four price tiers set per SKU on the SKU Management page: our selling price to WS, WS → Semi-WS / Tobacconists, Semi-WS → Retail (all $/MC), and the Final RSP ($/pack). When a tier price is set, the Apply Offer sheet invoices each channel at its own tier and shows the buyer's margin; when not set, it falls back to the WS list price knob." },
  { term: "Packs / pieces per MC",        meaning: "1 MC = 6 KG, so a 50g SKU is 120 packs per MC, a 250g SKU is 24 pieces, a 1kg SKU is 6 pieces. The offer sheet shows both MC and pack counts so the buyer sees shelf units." },
  { term: "Mix ratio",      meaning: "How many mastercases of bestseller go with each MC of slow. e.g. 10:1 means \"10 bestseller MC + 1 slow MC per bundle\"." },
  { term: "Mix portion",    meaning: "The slow flavor's $ value as a % of the bestseller's $ value. The slider drives the mix ratio." },
  { term: "Swap promise",   meaning: "How many days the retailer has to return unsold slow stock for any bestseller, no questions asked." },
  { term: "Co-op fund",     meaning: "Money we deposit with the retailer for marketing (Instagram boost, café night) instead of a swap." },
  { term: "Months of stock", meaning: "Closing stock divided by trailing 3-month average sales. Tells you how long current stock will last at the current rate." },
];

function GlossaryPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Card className="border-dashed">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left"
      >
        <span className="text-sm font-medium flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          What do these words mean?
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <CardContent className="pt-0 pb-3">
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            {GLOSSARY.map(g => (
              <div key={g.term}>
                <dt className="font-semibold">{g.term}</dt>
                <dd className="text-muted-foreground">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      )}
    </Card>
  );
}

function CopyButton({ label, text, icon: Icon }: { label: string; text: string; icon: typeof Phone }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success(`${label} script copied`);
        } catch (err) {
          toast.error(`Copy failed — ${err instanceof Error ? err.message : "browser blocked clipboard"}`);
        }
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      Copy {label}
      <Copy className="h-3 w-3 opacity-50" />
    </Button>
  );
}

function DeckCard({ deck, slowMonthsOfStock }: { deck: Deck; slowMonthsOfStock: number | null }) {
  const TplIcon = deck.templateIcon;
  const sev = slowMonthsOfStock !== null ? SEVERITY(slowMonthsOfStock) : null;
  const [scriptsOpen, setScriptsOpen] = useState(false);

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary"><TplIcon className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                {deck.templateName}
                <Badge variant="secondary" className="text-[10px]">{deck.templateTag}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{deck.forLine}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {sev && <Badge className={`border ${sev.tone}`}>{sev.label}</Badge>}
            <Badge className={`border ${ratingTone(deck.ourRisk)}`} title="Risk for us — margin & inventory exposure">Risk for us: {deck.ourRisk}</Badge>
            <Badge className={`border ${ratingTone(deck.retailerAppeal)}`} title="How appealing this looks to the retailer">Appeal: {deck.retailerAppeal}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pitch headline */}
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3">
          <p className="text-sm font-medium leading-relaxed">{deck.headline}</p>
        </div>

        {/* Bundle table */}
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {deck.bundle.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                  <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-right">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Why yes + catch */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
            <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-1.5">Why retailer says yes</h5>
            <ul className="space-y-1 text-xs text-emerald-900/80 dark:text-emerald-200/80 list-disc pl-4">
              {deck.whyYes.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
          <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-3">
            <h5 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1.5">What to watch</h5>
            <ul className="space-y-1 text-xs text-amber-900/80 dark:text-amber-200/80 list-disc pl-4">
              {deck.catches.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        </div>

        {/* Ready-to-send scripts */}
        <div className="rounded-md border bg-background">
          <button
            type="button"
            onClick={() => setScriptsOpen(o => !o)}
            aria-expanded={scriptsOpen}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors text-left"
          >
            <span className="text-sm font-semibold flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Ready-to-send messages
            </span>
            {scriptsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {scriptsOpen && (
            <div className="px-3 pb-3 pt-1 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-muted-foreground">Phone pitch (60-90 sec)</span>
                  <CopyButton label="phone" text={deck.scripts.phone} icon={Phone} />
                </div>
                <p className="text-xs italic text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">{deck.scripts.phone}</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-muted-foreground">
                    SMS <span className={`font-mono ${deck.scripts.sms.length > 160 ? "text-destructive" : ""}`}>({deck.scripts.sms.length}/160)</span>
                  </span>
                  <CopyButton label="SMS" text={deck.scripts.sms} icon={MessageSquare} />
                </div>
                <p className="text-xs italic text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">{deck.scripts.sms}</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-muted-foreground">WhatsApp (friendly)</span>
                  <CopyButton label="WhatsApp" text={deck.scripts.whatsapp} icon={Send} />
                </div>
                <p className="text-xs italic text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed whitespace-pre-line">{deck.scripts.whatsapp}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────

export default function TradeOffersPage() {
  const { country } = useCountry();
  const validCountry = country as "Lebanon" | "Syria" | "Libya" | "KSA";
  const { data, isLoading, isError, error } = trpc.country.forecastIntelligence.useQuery(
    { country: validCountry },
    { enabled: !!country },
  );
  // Supply-chain price list — tier prices per SKU (set on the SKU Management
  // page).  Used to invoice each Apply Offer channel at its own tier price.
  const { data: skuRows } = trpc.country.skus.useQuery(
    { country: validCountry, includeInactive: true },
    { enabled: !!country },
  );
  const priceOf = useMemo(() => {
    const map = new Map<number, TierPrices>();
    for (const s of (skuRows as { id: number }[] | undefined) ?? []) {
      const tp = tierPricesOf(s as Parameters<typeof tierPricesOf>[0]);
      if (hasAnyTierPrice(tp)) map.set(s.id, tp);
    }
    return (skuId: number): TierPrices | null => map.get(skuId) ?? null;
  }, [skuRows]);

  // Visible knobs — kept simple, plain language.
  const [thresholdMonths, setThresholdMonths] = useState(9);
  const [swapClause, setSwapClause] = useState<SwapClause>("90");
  const [size, setSize] = useState<RetailerSize>("Medium");

  // Trade channel — controls which deck templates to surface.
  const [channel, setChannel] = useState<Channel>("all");

  // Advanced knobs — collapsed by default.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mixPct, setMixPct] = useState(10);
  const [pricePerMc, setPricePerMc] = useState(127);
  const [pricingGuard, setPricingGuard] = useState<PricingGuard>("STRICT");

  const [glossaryOpen, setGlossaryOpen] = useState(false);

  // Anchor lock — country-defaulted (Syria = Double Apple New) but the planner
  // can override.  When flavor === "auto" we fall back to scarcity-weighted
  // pick across every active SKU.
  const initialLock = defaultAnchorLockFor(country);
  const [anchorFlavor, setAnchorFlavor] = useState<string>(initialLock.flavor);
  const [anchorPackaging, setAnchorPackaging] = useState<PackagingLock>(initialLock.packaging);
  // POSM list — DB-backed per country (shared across every planner).
  const { isAdmin } = useAppAuth();
  const utils = trpc.useUtils();
  const { data: posmRows } = trpc.tradeOffers.posmList.useQuery(
    { country: validCountry },
    { enabled: !!country },
  );
  // Local mirror so typing stays instant; saves flow back on blur.
  const [poms, setPoms] = useState<PomItem[]>([]);
  useEffect(() => {
    if (posmRows) setPoms(posmRows.map(pomFromRow));
  }, [posmRows]);
  const invalidatePosm = () => utils.tradeOffers.posmList.invalidate({ country: validCountry });
  const posmAdd = trpc.tradeOffers.posmAdd.useMutation({
    onSuccess: invalidatePosm,
    onError: e => toast.error(`Couldn't add the material — ${e.message}`),
  });
  const posmUpdate = trpc.tradeOffers.posmUpdate.useMutation({
    onError: e => { toast.error(`Couldn't save the material — ${e.message}`); invalidatePosm(); },
  });
  const posmDelete = trpc.tradeOffers.posmDelete.useMutation({
    onSuccess: invalidatePosm,
    onError: e => toast.error(`Couldn't remove the material — ${e.message}`),
  });
  const posmAnalyze = trpc.tradeOffers.posmAnalyze.useMutation({
    onSuccess: res => {
      setPoms(res.items.map(pomFromRow));
      invalidatePosm();
      toast.success(res.usedLLM
        ? "POSM analysed — the AI researcher assigned each material to its best channels"
        : "POSM analysed with trade-practice rules — each material assigned to its best channels");
    },
    onError: e => toast.error(`Analysis failed — ${e.message}`),
  });
  const addPom = () => posmAdd.mutate({ country: validCountry, name: "New material", unitValue: 0 });
  const updatePomLocal = (id: number, patch: Partial<Omit<PomItem, "id">>) =>
    setPoms(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const updatePomChannelQtyLocal = (id: number, ch: PomChannel, qty: number) =>
    setPoms(prev => prev.map(p => (p.id === id ? { ...p, channelQty: { ...p.channelQty, [ch]: qty } } : p)));
  const savePom = (id: number) => {
    const p = poms.find(x => x.id === id);
    if (!p || p.name.trim() === "") return;
    posmUpdate.mutate({ country: validCountry, id, name: p.name, unitValue: p.unitValue, channelQty: p.channelQty });
  };
  const removePom = (id: number) => posmDelete.mutate({ country: validCountry, id });
  const kitByChannel = useMemo(
    () => POM_CHANNELS.map(ch => ({ ch, kit: kitForChannel(poms, ch) })),
    [poms],
  );

  // FOC entitlement rules — one "Buy X → get Y free" rule per channel, DB-backed.
  const { data: focRows } = trpc.tradeOffers.focRules.useQuery(
    { country: validCountry },
    { enabled: !!country },
  );
  const focRuleFor = useMemo(() => {
    const map = new Map<string, FocRule>();
    for (const r of focRows ?? []) map.set(r.channel, focRuleOf(r));
    return (ch: PomChannel): FocRule => map.get(ch) ?? focRuleOf(null);
  }, [focRows]);
  // Draft editor state (strings so partially-typed numbers don't fight the user).
  type FocDraft = { entitled: boolean; buyQty: string; buyUnit: FocUnit; freeQty: string; freeUnit: FocUnit };
  const defaultFocDrafts = (): Record<PomChannel, FocDraft> => ({
    retail:        { entitled: false, buyQty: "", buyUnit: "outer", freeQty: "", freeUnit: "pack" },
    wholesale:     { entitled: false, buyQty: "", buyUnit: "mc",    freeQty: "", freeUnit: "outer" },
    semiWholesale: { entitled: false, buyQty: "", buyUnit: "mc",    freeQty: "", freeUnit: "outer" },
    horeca:        { entitled: false, buyQty: "", buyUnit: "outer", freeQty: "", freeUnit: "pack" },
  });
  const [focDrafts, setFocDrafts] = useState<Record<PomChannel, FocDraft>>(defaultFocDrafts);
  useEffect(() => {
    if (!focRows) return;
    // Always rebuild from a FRESH default set, then overlay whatever rows the
    // country actually has — carrying over previous state would leak one
    // country's drafts into another country with no rules saved yet.
    const next = defaultFocDrafts();
    for (const ch of POM_CHANNELS) {
      const r = focRows.find(x => x.channel === ch);
      if (!r) continue;
      const rule = focRuleOf(r);
      next[ch] = {
        entitled: rule.entitled,
        buyQty: rule.buyQty !== null ? String(rule.buyQty) : "",
        buyUnit: rule.buyUnit ?? next[ch].buyUnit,
        freeQty: rule.freeQty !== null ? String(rule.freeQty) : "",
        freeUnit: rule.freeUnit ?? next[ch].freeUnit,
      };
    }
    setFocDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focRows]);
  const focUpsert = trpc.tradeOffers.focRuleUpsert.useMutation({
    onSuccess: () => utils.tradeOffers.focRules.invalidate({ country: validCountry }),
    onError: e => { toast.error(`Couldn't save the FOC rule — ${e.message}`); utils.tradeOffers.focRules.invalidate({ country: validCountry }); },
  });
  const saveFocDraft = (ch: PomChannel, draft: FocDraft) => {
    const buyQty = parseFloat(draft.buyQty);
    const freeQty = parseFloat(draft.freeQty);
    focUpsert.mutate({
      country: validCountry,
      channel: ch,
      entitled: draft.entitled,
      buyQty: Number.isFinite(buyQty) && buyQty > 0 ? buyQty : null,
      buyUnit: draft.buyUnit,
      freeQty: Number.isFinite(freeQty) && freeQty > 0 ? freeQty : null,
      freeUnit: draft.freeUnit,
    });
  };
  const setFocDraft = (ch: PomChannel, patch: Partial<FocDraft>, saveNow = false) => {
    setFocDrafts(prev => {
      const draft = { ...prev[ch], ...patch };
      if (saveNow) saveFocDraft(ch, draft);
      return { ...prev, [ch]: draft };
    });
  };
  // Apply Offer — per-channel offer sheet dialog.
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerChannel, setOfferChannel] = useState<PomChannel>("retail");

  // Re-apply country defaults whenever the country changes (planner can still
  // override after).  Tracked via a ref-like effect-less guard: when country
  // shifts, swap the anchor lock to the new country's values.  POSM and FOC
  // rules re-hydrate from their per-country queries automatically.
  const [lockCountryKey, setLockCountryKey] = useState<string | null>(country ?? null);
  if (country && country !== lockCountryKey) {
    const next = defaultAnchorLockFor(country);
    setAnchorFlavor(next.flavor);
    setAnchorPackaging(next.packaging);
    setPoms([]);
    setFocDrafts(defaultFocDrafts());
    setLockCountryKey(country);
  }

  const knobs: Knobs = { thresholdMonths, swapClause, size, mixPct, pricePerMc, pricingGuard };

  // All SKUs with their MOC + tier + overhang, computed once and reused for
  // both the anchor pool and the slow list (and the available-flavors menu).
  const enriched = useMemo(() => {
    if (!data?.skuIntel) return [] as (SkuIntel & { moc: number; overhang: number; tier: AnchorTier })[];
    const intel = data.skuIntel as SkuIntel[];
    return intel.map(s => {
      const avg3m = Number(s.avg3m) || 0;
      const closing = Number(s.currentClosingStock) || 0;
      const moc = avg3m > 0 ? closing / avg3m : (closing > 0 ? 999 : 0);
      return {
        ...s,
        avg3m,
        currentClosingStock: closing,
        moc,
        tier: anchorTierOf(moc),
        overhang: closing * pricePerMc,
      };
    });
  }, [data, pricePerMc]);

  // Distinct flavors for the anchor-flavor dropdown — sorted by total avg3m
  // so the busiest flavors float to the top.
  const flavorOptions = useMemo(() => {
    const acc = new Map<string, number>();
    for (const s of enriched) acc.set(s.flavor, (acc.get(s.flavor) ?? 0) + s.avg3m);
    return [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [enriched]);

  const { slowList, anchorList, summary } = useMemo(() => {
    type Empty = {
      slowList: (SkuIntel & { moc: number; overhang: number })[];
      anchorList: Anchor[];
      summary: null | { totalSlow: number; totalSlowStock: number; totalSlowDollars: number };
    };
    const empty: Empty = { slowList: [], anchorList: [], summary: null };
    if (enriched.length === 0) return empty;

    // SLOW = anything above the user's threshold.  Rank by DOLLAR OVERHANG
    // (closing stock × $/MC) DESC then MOC DESC, so the biggest cash drag
    // rises first instead of just the slowest %.
    const slow = enriched
      .filter(s => s.currentClosingStock > 0 && s.moc > thresholdMonths)
      .sort((a, b) => b.overhang - a.overhang || b.moc - a.moc);

    // ANCHOR POOL = SKUs that aren't themselves slow.  When the planner has
    // locked a flavor (default for Syria = "Double Apple" + "New"), we filter
    // to ONLY matching SKUs and surface every weight as its own anchor — the
    // user explicitly wanted "ALL the Double Apple New Packaging regardless
    // of weight" as the base.  When unlocked, we fall back to the highest
    // scarcity-weighted SKU and its top alternates.
    const slowIds = new Set(slow.map(s => s.id));
    const candidates: Anchor[] = enriched
      .filter(s => s.avg3m > 0 && !slowIds.has(s.id))
      .map(s => ({ ...s }) as Anchor);

    let anchorList: Anchor[];
    if (anchorFlavor !== "auto") {
      anchorList = candidates
        .filter(c => c.flavor === anchorFlavor)
        .filter(c => anchorPackaging === "any" || c.packagingType === anchorPackaging)
        // Within the locked flavor: pitch the most-scarce/highest-velocity
        // weight first so the rep leads with the strongest lever.
        .sort((a, b) => (b.avg3m * scarcityMultiplier(b.moc)) - (a.avg3m * scarcityMultiplier(a.moc)));
    } else {
      anchorList = candidates
        .sort((a, b) => (b.avg3m * scarcityMultiplier(b.moc)) - (a.avg3m * scarcityMultiplier(a.moc)))
        .slice(0, 4);
    }

    return {
      slowList: slow,
      anchorList,
      summary: {
        totalSlow: slow.length,
        totalSlowStock: slow.reduce((sum, s) => sum + s.currentClosingStock, 0),
        totalSlowDollars: slow.reduce((sum, s) => sum + s.overhang, 0),
      },
    };
  }, [enriched, thresholdMonths, anchorFlavor, anchorPackaging]);

  // Build deck sets — one per anchor in anchorList.  Slow SKUs of the SAME
  // flavor as the anchor are excluded per anchor (e.g. when the anchor is
  // Double Apple, pairing it with Double Apple Frosty or another Double
  // Apple weight adds zero variety to the retailer's invoice — the rep
  // needs a *different* flavor to drag through).
  const deckSets = useMemo(() => {
    if (anchorList.length === 0 || slowList.length === 0) return [] as { anchor: Anchor; decks: Deck[]; eligibleSlow: number }[];
    return anchorList.map(a => {
      const eligibleSlow = slowList.filter(s => s.flavor !== a.flavor);
      return { anchor: a, decks: buildAllDecks(eligibleSlow, a, knobs, poms), eligibleSlow: eligibleSlow.length };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorList, slowList, poms, knobs.thresholdMonths, knobs.swapClause, knobs.size, knobs.mixPct, knobs.pricePerMc, knobs.pricingGuard]);

  // Channel filter is applied PER deck-set so each anchor's decks are
  // reordered consistently and incompatible templates are hidden.
  const visibleDeckSets = useMemo(() => {
    return deckSets.map(({ anchor, decks, eligibleSlow }) => {
      if (channel === "all") return { anchor, decks, hidden: 0, eligibleSlow };
      const order = CHANNEL_DECK_PRIORITY[channel];
      const allowed = new Set(order);
      const filtered = decks
        .filter(d => allowed.has(d.templateId))
        .sort((a, b) => order.indexOf(a.templateId) - order.indexOf(b.templateId));
      return { anchor, decks: filtered, hidden: decks.length - filtered.length, eligibleSlow };
    });
  }, [deckSets, channel]);

  const slowMocBySku = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of slowList) m.set(s.id, s.moc);
    return m;
  }, [slowList]);

  // Marketeer's recommended offer mix — split the whole dead pile across
  // channels using the lead anchor's decks as the per-deal clearing rates.
  const mixPlan = useMemo(() => {
    if (deckSets.length === 0 || !summary || summary.totalSlowStock <= 0) return null;
    const decksById = new Map(deckSets[0].decks.map(d => [d.templateId, d]));
    const totalSlowMc = summary.totalSlowStock;
    const rows = MIX_STRATEGY.flatMap(m => {
      const deck = decksById.get(m.template);
      if (!deck || deck.slowMcPerDeal <= 0) return [];
      const targetMc = Math.round(totalSlowMc * m.share);
      if (targetMc <= 0) return [];
      const deals = Math.max(1, Math.ceil(targetMc / deck.slowMcPerDeal));
      const kit = kitForChannel(poms, m.channel);
      return [{ ...m, deck, targetMc, deals, kitPerDeal: kit.value, kitBudget: kit.value * deals }];
    });
    if (rows.length === 0) return null;
    const coveredMc = rows.reduce((s, r) => s + r.targetMc, 0);
    const totalDeals = rows.reduce((s, r) => s + r.deals, 0);
    const totalKitBudget = rows.reduce((s, r) => s + r.kitBudget, 0);
    return { rows, totalSlowMc, coveredMc, totalDeals, totalKitBudget, anchor: deckSets[0].anchor };
  }, [deckSets, summary, poms]);

  // Apply Offer — build the presentable offer sheet for every channel from
  // the lead anchor + eligible slow list.  When nothing can be built, carry a
  // plain-language reason so the dialog can tell the user what to change
  // (the button itself is never dimmed).
  const channelOffers = useMemo((): { offers: Record<PomChannel, ChannelOffer | null> | null; reason: string } => {
    if (isLoading) return { offers: null, reason: "Still loading your stock and sales data — try again in a moment." };
    if (enriched.length === 0) return { offers: null, reason: "No stock or sales data found for this country yet — upload IMS and stock data first." };
    if (slowList.length === 0) return { offers: null, reason: `No slow flavors above the ${thresholdMonths}-month threshold, so there is nothing to give FOC. Lower the "Show flavors with more than…" setting to widen the slow list.` };
    if (anchorList.length === 0) return { offers: null, reason: "No bestseller anchor available. If you locked an anchor flavor in Offer settings, that flavor may have no selling SKU right now — set it back to Auto or pick another flavor." };
    const a = anchorList[0];
    const eligible = slowList.filter(s => s.flavor !== a.flavor);
    if (eligible.length === 0) return { offers: null, reason: `Every slow flavor is a ${a.flavor} variant — the same flavor as the bestseller anchor, so there is no different-flavor product to give FOC. Change the anchor lock in Offer settings.` };
    const offers = {} as Record<PomChannel, ChannelOffer | null>;
    for (const ch of POM_CHANNELS) {
      const rule = focRuleFor(ch);
      // A channel switched OFF in the FOC rules gets no offer sheet at all —
      // the dialog explains it instead of silently showing a generic offer.
      offers[ch] = rule.entitled ? buildChannelOffer(ch, a, eligible, knobs, poms, priceOf, rule) : null;
    }
    if (POM_CHANNELS.every(ch => offers[ch] === null)) {
      const anyEntitled = POM_CHANNELS.some(ch => focRuleFor(ch).entitled);
      return {
        offers: null,
        reason: anyEntitled
          ? "The slow flavors have no warehouse stock left to build a FOC basket from."
          : "No channel is entitled to an offer — switch a channel ON in the FOC entitlement rules (Offer settings) first.",
      };
    }
    return { offers, reason: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, enriched, anchorList, slowList, poms, priceOf, focRuleFor, thresholdMonths, knobs.swapClause, knobs.size, knobs.mixPct, knobs.pricePerMc, knobs.pricingGuard]);

  const activeOffer = channelOffers.offers?.[offerChannel] ?? null;
  const offerDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const copyOffer = () => {
    if (!activeOffer || !country) return;
    navigator.clipboard.writeText(offerCopyText(activeOffer, country))
      .then(() => toast.success("Offer copied — paste it into WhatsApp, email or a print doc"))
      .catch(() => toast.error("Couldn't copy — select and copy the sheet manually"));
  };

  const totalVisibleDecks = visibleDeckSets.reduce((sum, s) => sum + s.decks.length, 0);
  const lockActive = anchorFlavor !== "auto";

  if (!country) {
    return <div className="p-6 text-sm text-muted-foreground">Select a country to view trade-offer recommendations.</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-amber-500" />
          Recommended AI Trade Offers
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Up to 6 ready-to-send offer decks for {country}. Every deck piggybacks the slow flavor onto your bestseller — your customer's existing volume drags it through.
          <span className="block mt-1 text-xs">As of <strong>{data?.targetMonth} {data?.targetYear}</strong> · proposals only — nothing is saved.</span>
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Badge
            className={`border ${
              channel === "all"
                ? "bg-muted text-muted-foreground border-muted-foreground/20"
                : "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700"
            }`}
          >
            Pitching to: <strong className="ml-1">{CHANNEL_LABEL[channel]}</strong>
          </Badge>
          {channel !== "all" && (
            <button
              type="button"
              onClick={() => setChannel("all")}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              show all channels
            </button>
          )}
        </div>
      </div>

      <GlossaryPanel open={glossaryOpen} onToggle={() => setGlossaryOpen(o => !o)} />

      {/* Status banner */}
      {anchorList.length > 0 && summary && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardContent className="p-4 grid sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">
                {lockActive ? `Anchor lock: ${anchorFlavor}${anchorPackaging !== "any" ? ` (${anchorPackaging} packaging)` : ""}` : "Bestseller anchor (the leverage)"}
              </div>
              <div className="font-semibold mt-1 flex items-center gap-2 flex-wrap">
                {anchorList[0].name} <span className="text-muted-foreground">({anchorList[0].weight})</span>
                <Badge className={`border text-[10px] ${ANCHOR_TIER_TONE[anchorList[0].tier]}`}>{ANCHOR_TIER_LABEL[anchorList[0].tier]}</Badge>
                {anchorList.length > 1 && (
                  <span className="text-[10px] text-muted-foreground">+ {anchorList.length - 1} more weight{anchorList.length - 1 === 1 ? "" : "s"}</span>
                )}
              </div>
              <div className="text-muted-foreground">
                {fmt(anchorList[0].avg3m)} MC/month · {stockRunwayPhrase(anchorList[0].moc)}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Slow flavors detected</div>
              <div className="font-semibold mt-1">{summary.totalSlow} flavor{summary.totalSlow === 1 ? "" : "s"}</div>
              <div className="text-muted-foreground">above {thresholdMonths} months of stock</div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Total slow stock at risk</div>
              <div className="font-semibold mt-1">${fmt(summary.totalSlowDollars)}</div>
              <div className="text-muted-foreground">{fmt(summary.totalSlowStock)} mastercases on hand</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock Snapshot — shows the data behind the anchor + slow picks. */}
      {(anchorList.length > 0 || slowList.length > 0) && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-primary" />
              Stock snapshot — why these SKUs were picked
            </CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold mb-2 text-muted-foreground uppercase tracking-wider text-[10px]">
                {lockActive
                  ? `Locked anchor weights — ${anchorFlavor}${anchorPackaging !== "any" ? ` (${anchorPackaging} packaging)` : ""}`
                  : "Fast-movers (anchor candidates, scarcity-weighted)"}
              </div>
              <div className="space-y-1.5">
                {anchorList.map((a, i) => (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 ${i === 0 ? "bg-primary/5" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`truncate ${i === 0 ? "font-semibold" : ""}`}>
                        {i === 0 && "★ "}{a.name} <span className="text-muted-foreground font-normal">({a.weight})</span>
                      </div>
                      <div className="text-muted-foreground">{fmt(a.avg3m)} MC/mo · {stockRunwayPhrase(a.moc)}</div>
                    </div>
                    <Badge variant={i === 0 ? "default" : "outline"} className={`border text-[10px] shrink-0 ${ANCHOR_TIER_TONE[a.tier]}`}>{a.tier}</Badge>
                  </div>
                ))}
                {anchorList.length === 0 && (
                  <div className="text-muted-foreground italic">
                    {lockActive
                      ? `No active ${anchorFlavor}${anchorPackaging !== "any" ? ` (${anchorPackaging})` : ""} SKUs in ${country}. Switch to Auto or pick another flavor.`
                      : "No fast-mover available outside the slow list."}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2 text-muted-foreground uppercase tracking-wider text-[10px]">
                Slow stockpiles (ranked by $ overhang)
              </div>
              <div className="space-y-1.5">
                {slowList.slice(0, 5).map(s => {
                  const sev = SEVERITY(s.moc);
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{s.name} <span className="text-muted-foreground">({s.weight})</span></div>
                        <div className="text-muted-foreground">
                          {fmt(s.currentClosingStock)} MC · ${fmt(s.overhang)} tied up · {s.moc >= 100 ? "100+" : s.moc.toFixed(1)} mo
                        </div>
                      </div>
                      <Badge className={`border text-[10px] shrink-0 ${sev.tone}`}>{sev.label}</Badge>
                    </div>
                  );
                })}
                {slowList.length === 0 && (
                  <div className="text-muted-foreground italic">No flavors above {thresholdMonths} months of stock.</div>
                )}
                {slowList.length > 5 && (
                  <div className="text-[10px] text-muted-foreground italic">+{slowList.length - 5} more below the top 5</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings — simple, 3 visible knobs + Advanced expander */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Offer settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Anchor lock — pin the offer base to a specific flavor + packaging
              (e.g. Syria defaults to Double Apple New across every weight). */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-md border border-primary/20 bg-primary/5">
            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs font-semibold flex items-center gap-2">
                Anchor flavor (the offer base)
                {lockActive && (
                  <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">LOCKED</Badge>
                )}
              </Label>
              <Select value={anchorFlavor} onValueChange={v => setAnchorFlavor(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto — scarcity-weighted top pick</SelectItem>
                  {flavorOptions.map(f => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                {lockActive
                  ? `Every deck below is built on ${anchorFlavor} (one section per weight) paired with the worst slow movers.`
                  : "Auto picks the highest scarcity-weighted SKU — fast-movers running out of stock win."}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Packaging</Label>
              <Select value={anchorPackaging} onValueChange={v => setAnchorPackaging(v as PackagingLock)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any packaging</SelectItem>
                  <SelectItem value="New">New packaging only</SelectItem>
                  <SelectItem value="Old">Old packaging only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Filters which SKUs of the chosen flavor qualify as the base.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Trade channel</Label>
              <Select value={channel} onValueChange={v => setChannel(v as Channel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels (every deck)</SelectItem>
                  <SelectItem value="retail">Retail (shops &amp; kiosks)</SelectItem>
                  <SelectItem value="wholesale">Wholesale (master distributors)</SelectItem>
                  <SelectItem value="semiWholesale">Semi-Wholesale / Tobacconists</SelectItem>
                  <SelectItem value="horeca">HoReCa (cafés &amp; lounges)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Show flavors with more than…</Label>
              <Select value={String(thresholdMonths)} onValueChange={v => setThresholdMonths(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 months of stock (aggressive)</SelectItem>
                  <SelectItem value="9">9 months of stock (recommended)</SelectItem>
                  <SelectItem value="12">12 months of stock (conservative)</SelectItem>
                  <SelectItem value="18">18 months of stock (worst only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Swap promise</Label>
              <Select value={swapClause} onValueChange={v => setSwapClause(v as SwapClause)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">60 days (low risk for us)</SelectItem>
                  <SelectItem value="90">90 days (recommended)</SelectItem>
                  <SelectItem value="120">120 days (max appeal)</SelectItem>
                  <SelectItem value="coop">No swap → co-op marketing fund instead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold" id="size-label">Retailer size</Label>
              <div role="group" aria-labelledby="size-label" className="flex gap-1">
                {(["Small", "Medium", "Large"] as RetailerSize[]).map(s => {
                  const selected = size === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSize(s)}
                      className={`flex-1 px-2 py-2 rounded-md border text-xs font-medium transition-colors ${
                        selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* POSM — DB-backed per-country material list with AI channel
              analysis.  Each channel's kit is stacked onto the deck pitched
              to that channel. */}
          <div className="p-3 rounded-md border border-primary/20 bg-primary/5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label className="text-xs font-semibold flex items-center gap-2">
                <Store className="h-3.5 w-3.5 text-primary" />
                POSM — materials to distribute per channel
              </Label>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addPom} disabled={posmAdd.isPending}>
                      + Add material
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => posmAnalyze.mutate({ country: validCountry })}
                      disabled={posmAnalyze.isPending || poms.length === 0}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      {posmAnalyze.isPending ? "Analysing…" : "Analyse POSM"}
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setOfferOpen(true)}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Apply Offer
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Point-of-sale materials (hoses, playing cards, notebooks, display stands…) handed out FREE per deal. The list is saved in the database per country, so every planner sees the same kit. Hit <strong>Analyse POSM</strong> to have each material assigned to the channels it suits — hoses and playing cards go to cafés &amp; lounges first, notebooks work everywhere — then fine-tune the quantity under each channel (0 means that channel doesn't get the item). When you're done, hit <strong>Apply Offer</strong> for the presentable per-channel offer sheet.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {kitByChannel.map(({ ch, kit }) => (
                <Badge
                  key={ch}
                  variant="outline"
                  className={`text-[10px] ${kit.value > 0 ? "border-primary/40 text-primary" : "border-muted-foreground/30 text-muted-foreground"}`}
                >
                  {POM_CHANNEL_SHORT[ch]} kit {kit.value > 0 ? `$${fmt(kit.value)}` : "—"}
                </Badge>
              ))}
            </div>
            {poms.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No materials yet — add the POSM your reps can hand out.</p>
            ) : (
              <div className="space-y-2">
                {poms.map(p => (
                  <div key={p.id} className="rounded-md border bg-background/60 p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-8 text-xs flex-1"
                        placeholder="e.g. Branded hoses"
                        value={p.name}
                        disabled={!isAdmin}
                        onChange={e => updatePomLocal(p.id, { name: e.target.value })}
                        onBlur={() => savePom(p.id)}
                      />
                      <div className="flex items-center gap-1 w-24">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          min={0}
                          aria-label={`Value per unit in dollars for ${p.name || "material"}`}
                          value={p.unitValue}
                          disabled={!isAdmin}
                          onChange={e => { const n = Number(e.target.value); updatePomLocal(p.id, { unitValue: Number.isFinite(n) ? Math.max(0, n) : 0 }); }}
                          onBlur={() => savePom(p.id)}
                        />
                      </div>
                      {isAdmin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => removePom(p.id)}
                          aria-label={`Remove ${p.name || "material"}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap pl-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Qty/deal:</span>
                      {POM_CHANNELS.map(ch => {
                        const prio = p.priority?.[ch] ?? 0;
                        const badge = POSM_PRIORITY_BADGE[prio];
                        return (
                          <label key={ch} className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground w-10 text-right">{POM_CHANNEL_SHORT[ch]}</span>
                            <Input
                              className="h-7 text-xs w-14 text-center"
                              type="number"
                              min={0}
                              aria-label={`${POM_CHANNEL_SHORT[ch]} quantity per deal for ${p.name || "material"}`}
                              value={p.channelQty[ch]}
                              disabled={!isAdmin}
                              onChange={e => { const n = Number(e.target.value); updatePomChannelQtyLocal(p.id, ch, Number.isFinite(n) ? Math.max(0, n) : 0); }}
                              onBlur={() => savePom(p.id)}
                            />
                            {badge && <Badge className={`border text-[9px] px-1 py-0 ${badge.tone}`}>{badge.label}</Badge>}
                          </label>
                        );
                      })}
                    </div>
                    {p.rationale && (
                      <p className="text-[10px] text-muted-foreground pl-1 italic">
                        {p.rationale}
                        {p.analysisSource && <span className="not-italic"> · {p.analysisSource === "ai" ? "AI analysis" : "trade-practice rules"}</span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FOC entitlement rules — "Buy X → get Y free" per channel.  These
              drive the Apply Offer sheets: a channel switched OFF gets no
              offer; a complete rule adds the free-goods line. */}
          <div className="p-3 rounded-md border border-emerald-300/40 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
            <Label className="text-xs font-semibold flex items-center gap-2">
              <Gift className="h-3.5 w-3.5 text-emerald-600" />
              FOC entitlement rules — who gets what free
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Set the free-goods deal each channel is entitled to — for example Wholesale: buy 1 MC → get 1 outer free; Retail: buy 3 outers → get 1 pack free. 1 outer = {PACKS_PER_OUTER} packs. Switch a channel OFF and Apply Offer will skip it entirely. The free goods are more of the bestseller the customer is already buying, on the same delivery.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {POM_CHANNELS.map(ch => {
                const d = focDrafts[ch];
                const preview = ruleSentence(focRuleFor(ch));
                return (
                  <div key={ch} className={`rounded-md border p-2 space-y-2 ${d.entitled ? "bg-background/60" : "bg-muted/30 opacity-80"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{CHANNEL_LABEL[ch]}</span>
                      <Switch
                        checked={d.entitled}
                        disabled={!isAdmin}
                        onCheckedChange={v => setFocDraft(ch, { entitled: v }, true)}
                        aria-label={`FOC entitlement on/off for ${CHANNEL_LABEL[ch]}`}
                      />
                    </div>
                    {d.entitled && (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                          <span className="text-muted-foreground">Buy</span>
                          <Input
                            className="h-7 text-xs w-14 text-center"
                            type="number"
                            min={0}
                            value={d.buyQty}
                            disabled={!isAdmin}
                            aria-label={`Buy quantity for ${CHANNEL_LABEL[ch]}`}
                            onChange={e => setFocDraft(ch, { buyQty: e.target.value })}
                            onBlur={() => saveFocDraft(ch, focDrafts[ch])}
                          />
                          <Select value={d.buyUnit} onValueChange={v => setFocDraft(ch, { buyUnit: v as FocUnit }, true)} disabled={!isAdmin}>
                            <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FOC_UNITS.map(u => <SelectItem key={u} value={u}>{FOC_UNIT_LABEL[u].many}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <span className="text-muted-foreground">→ get</span>
                          <Input
                            className="h-7 text-xs w-14 text-center"
                            type="number"
                            min={0}
                            value={d.freeQty}
                            disabled={!isAdmin}
                            aria-label={`Free quantity for ${CHANNEL_LABEL[ch]}`}
                            onChange={e => setFocDraft(ch, { freeQty: e.target.value })}
                            onBlur={() => saveFocDraft(ch, focDrafts[ch])}
                          />
                          <Select value={d.freeUnit} onValueChange={v => setFocDraft(ch, { freeUnit: v as FocUnit }, true)} disabled={!isAdmin}>
                            <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FOC_UNITS.map(u => <SelectItem key={u} value={u}>{FOC_UNIT_LABEL[u].many}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <span className="text-muted-foreground">free</span>
                        </div>
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium">
                          {preview ?? "Enter both quantities to complete the rule."}
                        </p>
                      </>
                    )}
                    {!d.entitled && (
                      <p className="text-[10px] text-muted-foreground italic">Not entitled — Apply Offer skips this channel.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Advanced */}
          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen(o => !o)}
              aria-expanded={advancedOpen}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Advanced settings
            </button>
            {advancedOpen && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
                <div className="space-y-2 lg:col-span-2">
                  <Label className="text-xs font-semibold">Mix portion: <span className="font-mono">{mixPct}%</span> of bestseller invoice</Label>
                  <Slider min={1} max={25} step={1} value={[mixPct]} onValueChange={v => setMixPct(v[0])} />
                  <p className="text-[10px] text-muted-foreground">Drives the bestseller-to-slow ratio (clamped between 5:1 and 15:1).</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Pricing guard</Label>
                  <Select value={pricingGuard} onValueChange={v => setPricingGuard(v as PricingGuard)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STRICT">STRICT — list price untouchable</SelectItem>
                      <SelectItem value="SOFT">SOFT — up to 5% bundle promo</SelectItem>
                      <SelectItem value="FLEX">FLEX — up to 10% with full bundle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">$ / mastercase (WS list price)</Label>
                  <Input type="number" inputMode="decimal" value={pricePerMc} onChange={e => setPricePerMc(Number(e.target.value) || 0)} />
                  <p className="text-[10px] text-muted-foreground">Drives every $ figure on this page (invoices, swap claims, co-op funds, gift values).</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Decks */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading diagnostics…
        </div>
      ) : isError ? (
        <Card><CardContent className="p-6 text-sm text-destructive">Failed to load: {String(error?.message ?? "unknown")}</CardContent></Card>
      ) : anchorList.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground space-y-1">
            <p>
              {lockActive
                ? <>No active <strong>{anchorFlavor}</strong>{anchorPackaging !== "any" && <> ({anchorPackaging} packaging)</>} SKU available in {country} to anchor an offer against.</>
                : <>No bestseller SKU available in {country} to anchor an offer against.</>}
            </p>
            <p className="text-xs">
              {lockActive
                ? <>Either the locked flavor has no recent sales, or every matching SKU is itself above your <strong>{thresholdMonths}-month</strong> stock threshold. Switch the anchor flavor back to <em>Auto</em>, change the packaging filter, or pick a different flavor.</>
                : <>Either no SKU has recent sales (add IMS data first), <em>or</em> every SKU with sales activity is itself above your <strong>{thresholdMonths}-month</strong> stock threshold — meaning the whole catalog is overstocked. Try lowering the threshold to free up an anchor, or run a country-wide clearance instead of bundle plays.</>}
            </p>
          </CardContent>
        </Card>
      ) : slowList.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground flex items-start gap-3">
            <TrendingDown className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              No flavors in {country} are above {thresholdMonths} months of stock right now — your inventory is healthy. Try lowering the threshold to find proactive plays.
            </div>
          </CardContent>
        </Card>
      ) : totalVisibleDecks === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground space-y-2">
            <p>None of the ready decks fit the <strong>{CHANNEL_LABEL[channel]}</strong> channel.</p>
            <p className="text-xs">Switch the channel filter to <em>All channels</em> to see every option, or pick a different channel that matches the account you're pitching.</p>
            <button
              type="button"
              onClick={() => setChannel("all")}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Show all channels
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span>
              <strong>{totalVisibleDecks}</strong> ready-to-apply offer{totalVisibleDecks === 1 ? "" : "s"}
              {visibleDeckSets.length > 1 && <> across <strong>{visibleDeckSets.length}</strong> anchor weight{visibleDeckSets.length === 1 ? "" : "s"}</>}
              {channel === "all"
                ? <>, ranked from simplest to biggest commitment.</>
                : <> for <strong>{CHANNEL_LABEL[channel]}</strong> — most-relevant deck first.</>}
            </span>
          </div>

          {/* Marketeer's recommended offer mix — how to split the dead pile
              across channels, computed from the lead anchor's decks. */}
          {mixPlan && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold text-sm">Marketeer's recommended offer mix</span>
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                    {fmt(mixPlan.totalSlowMc)} MC dead pile · ${fmt(summary!.totalSlowDollars)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  How I'd split the {fmt(mixPlan.totalSlowMc)} MC of slow stock across channels, anchored on <strong>{mixPlan.anchor.name} ({mixPlan.anchor.weight})</strong>: lead with wholesale (few negotiations, most MC), buy retail shelves with POS kits, use ride-alongs as steady filler, and let HoReCa build trial. Deal counts use each offer's clearance basket size from your live SSOF numbers.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-muted-foreground uppercase tracking-wider text-left">
                        <th className="py-1 pr-3 font-medium">Channel</th>
                        <th className="py-1 pr-3 font-medium">Offer to run</th>
                        <th className="py-1 pr-3 font-medium text-right">Share</th>
                        <th className="py-1 pr-3 font-medium text-right">Slow MC target</th>
                        <th className="py-1 pr-3 font-medium text-right">Deals needed</th>
                        <th className="py-1 pr-3 font-medium text-right">POS kit budget</th>
                        <th className="py-1 font-medium">Why this channel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mixPlan.rows.map(r => (
                        <tr key={r.channel} className="border-t border-amber-500/10 align-top">
                          <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{POM_CHANNEL_SHORT[r.channel]}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{r.deck.templateName}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{Math.round(r.share * 100)}%</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmt(r.targetMc)} MC</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{fmt(r.deals)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{r.kitBudget > 0 ? `$${fmt(r.kitBudget)}` : "—"}</td>
                          <td className="py-1.5 text-muted-foreground">{r.why}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-amber-500/20 font-semibold">
                        <td className="py-1.5 pr-3" colSpan={3}>Total</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{fmt(mixPlan.coveredMc)} MC</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{fmt(mixPlan.totalDeals)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{mixPlan.totalKitBudget > 0 ? `$${fmt(mixPlan.totalKitBudget)}` : "—"}</td>
                        <td className="py-1.5" />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Proposal only — nothing is written to the database. Deal counts are rounded up; a channel missing from the table means its offer couldn't be built from the current slow list.
                </p>
              </CardContent>
            </Card>
          )}

          {visibleDeckSets.map(({ anchor: a, decks: ds, hidden, eligibleSlow }, sectionIdx) => (
            <div key={a.id} className="space-y-3">
              {/* Per-anchor section header — only render when there's more than
                  one anchor weight (otherwise the status banner already says it). */}
              {visibleDeckSets.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-dashed">
                  <Badge className="bg-primary text-primary-foreground text-[10px]">ANCHOR {sectionIdx + 1}</Badge>
                  <span className="font-semibold text-sm">{a.name} <span className="text-muted-foreground font-normal">({a.weight})</span></span>
                  <Badge className={`border text-[10px] ${ANCHOR_TIER_TONE[a.tier]}`}>{ANCHOR_TIER_LABEL[a.tier]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {fmt(a.avg3m)} MC/mo · {stockRunwayPhrase(a.moc)}
                  </span>
                </div>
              )}
              {ds.length === 0 ? (
                <Card>
                  <CardContent className="p-4 text-xs text-muted-foreground">
                    {eligibleSlow === 0
                      ? <>No different-flavor slow SKU available to pair with <strong>{a.flavor}</strong> in {country}. Every slow flavor on the list is itself a {a.flavor} variant — pairing the same flavor adds no variety to the retailer's invoice.</>
                      : <>No deck for {a.name} ({a.weight}) fits the {CHANNEL_LABEL[channel]} channel{hidden > 0 && <> ({hidden} other deck{hidden === 1 ? "" : "s"} hidden)</>}.</>}
                  </CardContent>
                </Card>
              ) : (
                ds.map((d, i) => {
                  const moc = slowMocBySku.get(d.primarySlowId) ?? null;
                  return <DeckCard key={`${a.id}-${d.templateId}-${i}`} deck={d} slowMonthsOfStock={moc} />;
                })
              )}
              {channel !== "all" && hidden > 0 && ds.length > 0 && (
                <p className="text-[10px] text-muted-foreground italic">
                  {hidden} other deck{hidden === 1 ? "" : "s"} hidden as a poor fit for {CHANNEL_LABEL[channel]}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Card className="bg-muted/30">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1.5">
          <p><strong>How this works.</strong> The page uses your live stock and trailing 3-month sales (Forecast Intelligence diagnostics). Months of stock = closing stock ÷ trailing 3-month sales. <strong>Slow flavors</strong> are anything above your threshold, ranked by <em>dollar overhang</em> (stock × $/MC) so the biggest cash drag rises first. The <strong>bestseller anchor</strong> is the SKU with the highest scarcity-weighted velocity (avg3m × scarcity multiplier — SCARCE 2.0×, TIGHT 1.5×, HEALTHY 1.0×, OVERSTOCKED 0.4×) that isn't itself in the slow list — a fast-mover that's running out gives the rep real leverage. Each deck is a different way to attach the slow flavor to a normal bestseller order so the retailer's existing demand drags it through; when the anchor is SCARCE or TIGHT, the phone script leads with a "lock supply now" hook.</p>
          <p><strong>Read these as proposals.</strong> Nothing on this page writes to your database. Sales reps copy the script that fits the channel they're using; planning lead reviews the Risk and Appeal pills before sending.</p>
        </CardContent>
      </Card>

      {/* ── Apply Offer — the per-channel presentable offer sheet ─────────── */}
      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Trade offer — ready to present
            </DialogTitle>
            <DialogDescription>
              Pick a channel. Every offer includes FOC (free of charge) products and the channel's POS kit — copy it and use it any time, anywhere.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {POM_CHANNELS.map(ch => (
              <Button
                key={ch}
                type="button"
                size="sm"
                variant={offerChannel === ch ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setOfferChannel(ch)}
              >
                {POM_CHANNEL_SHORT[ch]}
              </Button>
            ))}
          </div>

          {!activeOffer ? (
            <p className="text-sm text-muted-foreground py-4">
              {!focRuleFor(offerChannel).entitled
                ? `${CHANNEL_LABEL[offerChannel]} is switched OFF in the FOC entitlement rules — no offer is generated for this channel. Switch it ON in Offer settings to include it.`
                : channelOffers.reason || `No offer could be built for ${CHANNEL_LABEL[offerChannel]} from the current slow list.`}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border-2 border-primary/25 overflow-hidden shadow-sm">
                {/* Sheet header */}
                <div className="bg-primary text-primary-foreground px-5 py-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] opacity-80">Al Fakher · {country} · {offerDate}</div>
                  <div className="text-lg font-bold leading-tight mt-0.5">{activeOffer.title}</div>
                  <div className="text-xs opacity-90">{CHANNEL_LABEL[activeOffer.channel]}</div>
                </div>

                <div className="p-4 sm:p-5 space-y-4 text-sm">
                  {/* BUY */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">You buy</div>
                    <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                      <div>
                        <div className="font-semibold">
                          {activeOffer.anchorMc} MC {activeOffer.anchor.name} {activeOffer.anchor.weight}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {packPhrase(activeOffer.anchorMc, activeOffer.anchor.weight).replace(/^\s*\(|\)$/g, "") || "bestseller anchor"} · {ANCHOR_TIER_LABEL[activeOffer.anchor.tier]}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <div className="font-bold">${fmt(activeOffer.invoice)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          ${fmt(activeOffer.buyPricePerMc, 2)}/MC{activeOffer.usedTierPrice ? ` · ${CHANNEL_LABEL[activeOffer.channel]} tier` : " · list price"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Buyer margin — the sell-on story from the price list */}
                  {activeOffer.margin && activeOffer.margin.perMc > 0 && (
                    <div className="rounded-lg border border-sky-300/60 bg-sky-50/60 dark:bg-sky-900/15 px-3 py-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 mb-0.5">Your margin</div>
                      <div className="text-xs text-muted-foreground">
                        Buy at <strong className="text-foreground">${fmt(activeOffer.buyPricePerMc, 2)}/MC</strong>, {activeOffer.margin.label} at{" "}
                        <strong className="text-foreground">${fmt(activeOffer.margin.resalePerMc, 2)}/MC</strong> —{" "}
                        <strong className="text-sky-700 dark:text-sky-300">${fmt(activeOffer.margin.perMc, 2)}/MC in your pocket</strong>
                        {" "}(${fmt(activeOffer.margin.perMc * activeOffer.anchorMc)} on this order, before the free product).
                      </div>
                    </div>
                  )}

                  {/* Price ladder — the anchor's supply-chain price list */}
                  {activeOffer.ladder && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Price ladder — {activeOffer.anchor.name} {activeOffer.anchor.weight}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {([
                          { label: "To WS", value: activeOffer.ladder.toWs, unit: "/MC" },
                          { label: "WS → Semi-WS", value: activeOffer.ladder.wsToSemiWs, unit: "/MC" },
                          { label: "Semi-WS → Retail", value: activeOffer.ladder.semiWsToRetail, unit: "/MC" },
                          { label: "Final RSP", value: activeOffer.ladder.rspPerPack, unit: "/pack" },
                        ] as const).map(step => (
                          <div key={step.label} className="rounded-lg border bg-muted/30 px-2.5 py-2">
                            <div className="text-[10px] text-muted-foreground">{step.label}</div>
                            <div className="font-semibold tabular-nums">
                              {step.value === null ? "—" : `$${fmt(step.value, 2)}`}
                              {step.value !== null && <span className="text-[10px] font-normal text-muted-foreground">{step.unit}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* FOC */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                        <Gift className="h-3 w-3" /> Free of charge (FOC)
                      </div>
                      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 text-[10px]">
                        worth ${fmt(activeOffer.focValue)}
                      </Badge>
                    </div>
                    <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-900/15 divide-y divide-emerald-200/50 dark:divide-emerald-800/40">
                      {activeOffer.basket.items.map(i => (
                        <div key={i.sku.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div>
                            <span className="font-medium">{i.mc} MC {i.sku.name} {i.sku.weight}</span>
                            <span className="text-xs text-muted-foreground">{packPhrase(i.mc, i.sku.weight)}</span>
                          </div>
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">FREE</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* FOC entitlement — "Buy X → get Y free" on the anchor buy */}
                  {activeOffer.entitlement && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                          <Gift className="h-3 w-3" /> Your FOC entitlement
                        </div>
                        <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 text-[10px]">
                          worth ${fmt(activeOffer.entitlement.valueDollars)}
                        </Badge>
                      </div>
                      <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-900/15 px-3 py-2.5 space-y-1">
                        <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">{activeOffer.entitlement.sentence}</div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span>
                            <span className="font-medium">{fmt(activeOffer.entitlement.freeUnits)} {activeOffer.entitlement.freeUnitLabel} of {activeOffer.anchor.name} {activeOffer.anchor.weight}</span>
                            <span className="text-muted-foreground"> ({fmt(activeOffer.entitlement.freePacks)} packs)</span>
                          </span>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">FREE</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Applied automatically on every qualifying order — the free goods are more of the bestseller you're already buying, on the same delivery.</p>
                      </div>
                    </div>
                  )}

                  {/* POS kit */}
                  {activeOffer.kit.value > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1">
                          <Store className="h-3 w-3" /> Free POS kit — installed by our rep
                        </div>
                        <Badge className="bg-violet-100 text-violet-800 border border-violet-300 dark:bg-violet-900/40 dark:text-violet-200 text-[10px]">
                          worth ${fmt(activeOffer.kit.value)}
                        </Badge>
                      </div>
                      <div className="rounded-lg border border-violet-300/60 bg-violet-50/60 dark:bg-violet-900/15 px-3 py-2 text-xs space-y-0.5">
                        {activeOffer.kit.items.map(i => (
                          <div key={i.name}>{i.qty}× {i.name}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Total free value banner */}
                  <div className="rounded-lg bg-primary/10 border border-primary/30 px-3 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold">Total free value on this order</span>
                    <span className="font-bold">
                      ${fmt(activeOffer.totalFreeValue)}
                      <span className="text-xs font-normal text-muted-foreground"> ({fmt((activeOffer.totalFreeValue / activeOffer.invoice) * 100)}% of invoice)</span>
                    </span>
                  </div>

                  {/* Terms */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Terms</div>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
                      {activeOffer.terms.map(t => <li key={t}>{t}</li>)}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={copyOffer} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                  Copy offer text
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
