import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
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
  avg3m: number;
  trend: number;
  trendDirection: "growing" | "stable" | "declining";
  currentClosingStock: number;
};

type Knobs = {
  thresholdMonths: number;
  swapClause: SwapClause;
  size: RetailerSize;
  mixPct: number;        // % of slow value attached per $100 bestseller (was "free-goods cap")
  pricePerMc: number;
  unitsPerMc: number;
  pricingGuard: PricingGuard;
};

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
  templateId: "rideAlong" | "variety" | "subscription" | "cafe" | "territory";
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
};

function calcMixRatio(k: Knobs): number {
  return clamp(Math.ceil(100 / Math.max(1, k.mixPct)), 5, 15);
}

function buildRideAlong(slow: SkuIntel, anchor: SkuIntel, k: Knobs): Deck {
  const ratio = calcMixRatio(k);
  const slowMc = 1;
  const anchorMc = ratio;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const coop = k.pricePerMc * 0.06;

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k));
  const appeal = rateAppeal(appealScore(k, ratio <= 8 ? 5 : 0));

  const swapText = swapWordy(k.swapClause, slow.name, coop);
  const headline = `For every ${ratio} cases of ${anchor.name} you order, we add 1 case of ${slow.name} at the same per-case price.`;

  const phone = `Hi — quick one. You're already moving ${fmt(anchor.avg3m)} cases of ${anchor.name} a month. Easiest deal I have this quarter: order ${ratio} cases of ${anchor.name} like you usually do, and I add 1 case of ${slow.name} on the same invoice at the SAME ${fmt(k.pricePerMc, 0)} per case. Total comes to $${fmt(totalInvoice)}. ${swapText} Same per-case price you've been paying — just a different mix. Want me to write it up?`;
  const sms = clampSms(`Order ${ratio}× ${anchor.name}, get +1 ${slow.name} at same per-case price. ${k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause}d swap`}. Reply YES to lock.`);
  const whatsapp = `Hey 👋\n\nQuick offer for ${anchor.name}: order ${ratio} cases (your usual), and we add 1 case of ${slow.name} at the same per-case price.\n\nTotal: $${fmt(totalInvoice)}.\n${swapText}\n\nWant me to add it to your next order?`;

  return {
    templateId: "rideAlong",
    templateName: "The Ride-Along",
    templateTag: "Simplest piggyback",
    templateIcon: Bike,
    forLine: `for ${slow.name} (${slow.weight})`,
    headline,
    bundle: [
      { label: `Cases of bestseller (${anchor.name})`, value: String(anchorMc) },
      { label: `Cases of slow flavor (${slow.name})`,  value: String(slowMc) },
      { label: "Per-case price (unchanged)",            value: `$${fmt(k.pricePerMc)}` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      "Same per-case price on every line — nothing on the invoice looks like a discount.",
      `${anchor.name} is your fastest-mover; the slow case rides along with no extra effort.`,
      k.swapClause === "coop"
        ? "Co-op fund pays for an Instagram boost — pulls customers into the new flavor."
        : `Risk-free: ${k.swapClause}-day swap means no dead stock if it doesn't move.`,
    ],
    catches: [
      ratio >= 13 ? `Bestseller-to-slow ratio is ${ratio}:1 — sharp buyers may sniff a giveaway and push for more. Hold the line.` : `Bestseller-to-slow ratio is ${ratio}:1 — fair-looking on both sides.`,
      slow.avg3m <= 2 ? "Slow flavor's historical sell-through is very low — expect swap claims at day 90." : "Slow flavor still has some pulse — a single round usually clears.",
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildVarietyBuilder(slows: SkuIntel[], anchor: SkuIntel, k: Knobs): Deck {
  const slowList = slows.slice(0, 2);
  const anchorMc = clamp(Math.ceil(200 / Math.max(1, k.mixPct)), 6, 12); // two slows; double the bestseller
  const slowMc = slowList.length;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const coopBoost = 50 * slowMc;

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, 10));
  const appeal = rateAppeal(appealScore(k, 12));
  const slowNames = slowList.map(s => s.name).join(" and ");
  const swapText = swapWordy(k.swapClause, slowNames, coopBoost);

  const headline = `Bundle ${anchorMc} cases of ${anchor.name} + 1 case each of ${slowNames}. Same per-case price across all flavors. We add a $${coopBoost} Instagram launch fund.`;

  const phone = `Bigger play this quarter: I want to make you the only retailer in your zone carrying ${slowNames}. Bundle is ${anchorMc} cases of ${anchor.name} + 1 case of each new flavor. Same per-case price all the way through — total $${fmt(totalInvoice)}. We add $${coopBoost} for a one-week Instagram launch and I drop off the artwork. ${swapText} Three flavors, one invoice, one launch — your customers see a fresh menu without you changing prices.`;
  const sms = clampSms(`Launch: ${anchorMc}× ${anchor.name} + 1 ea ${slowNames}. $${fmt(totalInvoice)} + $${coopBoost} IG fund. Exclusive in zone. YES?`);
  const whatsapp = `Quarterly launch idea 🎁\n\n${anchorMc} cases ${anchor.name} + 1 case each of ${slowNames} — same per-case price.\n\nTotal: $${fmt(totalInvoice)} + we fund $${coopBoost} Instagram boost.\n\n${swapText}\n\nGives you 2 limited flavors no other shop in your zone gets. Worth a try?`;

  return {
    templateId: "variety",
    templateName: "The Variety Builder",
    templateTag: "Multi-flavor launch",
    templateIcon: Gift,
    forLine: `for ${slowNames}`,
    headline,
    bundle: [
      { label: `Cases of bestseller (${anchor.name})`, value: String(anchorMc) },
      { label: "Cases of slow flavors (1 each)",       value: `${slowMc} (${slowNames})` },
      { label: "Per-case price (unchanged)",            value: `$${fmt(k.pricePerMc)}` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "Marketing fund we add",                  value: `$${fmt(coopBoost)} (Instagram launch)` },
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `Bundled into the $${fmt(coopBoost, 0)} fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      `Two limited flavors no other retailer in your zone gets — your shelf looks fresher than the competition's.`,
      `Same per-case price on all 3 flavors — no awkward discount conversation with your accountant.`,
      `$${coopBoost} Instagram fund covers a full week of paid posts — pulls customers in instead of pushing product onto them.`,
    ],
    catches: [
      "Two slow flavors at once = double swap-back exposure if neither moves. Make sure the retailer can run the launch within 30 days.",
      `Bigger commitment than the simple Ride-Along — only pitch this to retailers who already trust you with ${anchor.name} volume.`,
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildSubscriptionLock(slow: SkuIntel, anchor: SkuIntel, k: Knobs): Deck {
  const weeks = 4;
  const weeklyAnchor = Math.max(2, Math.ceil(calcMixRatio(k) / 2));
  const weeklySlow = 1;
  const totalAnchor = weeklyAnchor * weeks;
  const totalSlow = weeklySlow * weeks;
  // Subscription's promise is "1 FREE case slow per week" — only the bestseller
  // cases hit the invoice. The slow cases are the program's loyalty incentive.
  const billedInvoice = totalAnchor * k.pricePerMc;
  const slowGiftValue = totalSlow * k.pricePerMc;
  const coop = k.pricePerMc * 0.06 * totalSlow;

  const ourRisk = rateRisk(riskScore(totalSlow, totalAnchor, k, -5));
  const appeal = rateAppeal(appealScore(k, k.size === "Small" ? -5 : 5));
  const swapText = swapWordy(k.swapClause, slow.name, coop);

  const headline = `Commit to ${weeklyAnchor} cases of ${anchor.name} every week for 4 weeks. Each shipment includes 1 case of ${slow.name} at no extra charge.`;

  const phone = `Different angle: instead of one big order, let's do a 4-week program. Every week I deliver ${weeklyAnchor} cases of ${anchor.name} and I throw in 1 case of ${slow.name} on the same shipment — no extra charge. After 4 weeks: $${fmt(billedInvoice)} total invoice (you only pay for the bestseller cases — the slow ones are on us, $${fmt(slowGiftValue)} retail value). Paid weekly so it's easy on cash flow. ${swapText} Two big wins for you: your shelf is locked for a month so my competitors can't get in, and you discover whether ${slow.name} works for your customer without a big upfront bet.`;
  const sms = clampSms(`4-wk program: ${weeklyAnchor}× ${anchor.name}/wk + 1 FREE ${slow.name}/wk. Pay only $${fmt(billedInvoice)} (bestseller). Weekly billing. Locks shelf. YES?`);
  const whatsapp = `4-week subscription plan 🔁\n\nWeekly: ${weeklyAnchor} cases ${anchor.name} + 1 FREE case ${slow.name}.\nYou pay: $${fmt(billedInvoice)} over 4 weeks (bestseller only — slow cases are on us, $${fmt(slowGiftValue)} retail value).\nBilled weekly — easier cash flow.\n\n${swapText}\n\nLocks your shelf for a month, blocks competing reps, and you find out if ${slow.name} clicks with your customers.`;

  return {
    templateId: "subscription",
    templateName: "The Subscription Lock",
    templateTag: "4-week recurring",
    templateIcon: Repeat,
    forLine: `for ${slow.name} (${slow.weight})`,
    headline,
    bundle: [
      { label: "Program length",                            value: "4 weeks" },
      { label: `Weekly: bestseller (${anchor.name})`,       value: `${weeklyAnchor} cases × 4 = ${totalAnchor} (billed)` },
      { label: `Weekly: slow flavor (${slow.name})`,        value: `1 case × 4 = ${totalSlow} (FREE — on us)` },
      { label: "Per-case price (unchanged)",                 value: `$${fmt(k.pricePerMc)}` },
      { label: "Total invoice (you pay)",                    value: `$${fmt(billedInvoice)}` },
      { label: "Slow-flavor gift value",                     value: `$${fmt(slowGiftValue)} (retail)` },
      { label: "Billing",                                    value: "Weekly invoices, easier cash flow" },
      { label: "Pricing approach",                           value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      "Smooths cash flow — no big single payment, billed weekly as you sell.",
      "Locks the shelf for a month — competing reps can't get an order in until day 28.",
      "You discover whether the new flavor works for your customer without a big upfront bet.",
    ],
    catches: [
      "Requires a 4-week commitment — if the retailer cancels mid-program, the deal becomes a regular Ride-Along (no penalty, but no free flavor either).",
      "Need a clean weekly logistics slot — confirm delivery day before you sign.",
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildCafeStarter(slow: SkuIntel, anchor: SkuIntel, k: Knobs): Deck {
  const anchorMc = 3;
  const slowMc = 1;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const demoValue = 150;
  const coop = k.pricePerMc * 0.06;

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, 10)); // demo costs us real money
  const appeal = rateAppeal(appealScore(k, 15));                // small cafés love this
  const swapText = swapWordy(k.swapClause, slow.name, coop);

  const headline = `Smallest bundle: 3 cases of ${anchor.name} + 1 case of ${slow.name}. Plus a free Friday-night hookah-master demo at your café (worth $${demoValue}).`;

  const phone = `For your café specifically — small bundle, big experience. 3 cases of ${anchor.name} + 1 case of ${slow.name}, total $${fmt(totalInvoice)}. Same per-case price. The kicker: I send our hookah-master to your café for one Friday-night demo session — that's a $${demoValue} package on us. He builds a crowd around the new flavor, you sell hookahs and food all night, and the slow case sells itself by Saturday. ${swapText} One of the easiest "yes" deals I have.`;
  const sms = clampSms(`Café deal: 3× ${anchor.name} + 1× ${slow.name} = $${fmt(totalInvoice)}. + FREE Friday hookah-master demo ($${demoValue}). Limited slots. YES?`);
  const whatsapp = `Café-sized bundle ☕\n\n3 cases ${anchor.name} + 1 case ${slow.name} = $${fmt(totalInvoice)}.\n\n+ FREE hookah-master Friday-night demo at your café (worth $${demoValue}).\n\n${swapText}\n\nDemo brings new customers in, slow flavor sells itself by Saturday. Want a slot this month?`;

  return {
    templateId: "cafe",
    templateName: "The Café Starter Pack",
    templateTag: "Small-account entry",
    templateIcon: Coffee,
    forLine: `for ${slow.name} (${slow.weight})`,
    headline,
    bundle: [
      { label: `Cases of bestseller (${anchor.name})`, value: String(anchorMc) },
      { label: `Cases of slow flavor (${slow.name})`,  value: String(slowMc) },
      { label: "Per-case price (unchanged)",            value: `$${fmt(k.pricePerMc)}` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "What we add",                            value: `Free Friday-night hookah-master demo (worth $${demoValue})` },
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      "Smallest bundle we offer — fits a single shelf and one weekend's traffic.",
      "Free hookah-master demo brings new customers in — the slow flavor sells itself by Saturday.",
      "No commitment beyond this one bundle — pitch it as a no-brainer.",
    ],
    catches: [
      "Demo costs us real money — only worth it for cafés that can host on a Friday night and have a real customer base.",
      "Single-bundle clears just 1 case from our warehouse — needs many small accounts to move a meaningful chunk.",
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

function buildTerritoryExclusive(slow: SkuIntel, anchor: SkuIntel, k: Knobs): Deck {
  const anchorMc = 20;
  const slowMc = 5;
  const totalInvoice = (anchorMc + slowMc) * k.pricePerMc;
  const coop = k.pricePerMc * 0.06 * slowMc;

  const ourRisk = rateRisk(riskScore(slowMc, anchorMc, k, 10));
  const appeal = rateAppeal(appealScore(k, 15));
  const swapText = swapWordy(k.swapClause, slow.name, coop);

  const headline = `Mega bundle: 20 cases of ${anchor.name} + 5 cases of ${slow.name}. Plus 90-day exclusive territory rights for ${slow.name} in your zone.`;

  const phone = `Reserved for our top distributors only. Bundle is 20 cases ${anchor.name} + 5 cases ${slow.name} — same per-case price all the way, total $${fmt(totalInvoice)}. The big lever: you get 90-day exclusive territory rights for ${slow.name} in your zone. No other distributor can carry that flavor in your area for three months. We also book a quarterly business review with our planning lead — early access to new flavors before they hit the country. ${swapText} You scale, we scale, and your competitors are locked out of a flavor for a quarter.`;
  const sms = clampSms(`Master deal: 20× ${anchor.name} + 5× ${slow.name} = $${fmt(totalInvoice)}. + 90d EXCLUSIVE zone for ${slow.name} + quarterly review. Reply CALL.`);
  const whatsapp = `Reserved for top distributors 👑\n\n20 cases ${anchor.name} + 5 cases ${slow.name} = $${fmt(totalInvoice)} (same per-case price).\n\n+ 90-day EXCLUSIVE territory rights for ${slow.name} in your zone (no other distributor can carry it).\n+ Quarterly business review with our planning lead.\n\n${swapText}\n\nLet's set up a call to walk through it.`;

  return {
    templateId: "territory",
    templateName: "The Territory Exclusive",
    templateTag: "Master distributor deal",
    templateIcon: Crown,
    forLine: `for ${slow.name} (${slow.weight})`,
    headline,
    bundle: [
      { label: `Cases of bestseller (${anchor.name})`, value: String(anchorMc) },
      { label: `Cases of slow flavor (${slow.name})`,  value: String(slowMc) },
      { label: "Per-case price (unchanged)",            value: `$${fmt(k.pricePerMc)}` },
      { label: "Total invoice",                          value: `$${fmt(totalInvoice)}` },
      { label: "Exclusive territory rights",            value: `90 days for ${slow.name}` },
      { label: "Bonus",                                  value: "Quarterly business review + early access to new flavors" },
      { label: "Swap promise",                           value: k.swapClause === "coop" ? `$${fmt(coop, 0)} co-op fund` : `${k.swapClause} days, 1-for-1` },
      { label: "Pricing approach",                       value: pricingGuardLabel(k.pricingGuard) },
    ],
    whyYes: [
      `Only distributor in your zone with ${slow.name} for 90 days — your competition can't list it at any price.`,
      "Quarterly business review = early access to new flavors before the rest of the country sees them.",
      "Largest bundle = best per-case logistics for your warehouse run.",
    ],
    catches: [
      "Big upfront commitment — your warehouse needs to absorb 25 cases. Make sure the retailer has the cash and the shelf.",
      "Exclusivity ends at day 90; renewal requires hitting 60% sell-through on the slow flavor.",
    ],
    ourRisk,
    retailerAppeal: appeal,
    scripts: { phone, sms, whatsapp },
  };
}

// Build up to 5 ready-to-apply decks given the slow-SKU list and an anchor.
function buildAllDecks(slowList: SkuIntel[], anchor: SkuIntel, k: Knobs): Deck[] {
  const decks: Deck[] = [];
  if (slowList[0]) decks.push(buildRideAlong(slowList[0], anchor, k));
  if (slowList.length >= 2) decks.push(buildVarietyBuilder(slowList, anchor, k));
  if (slowList[0]) decks.push(buildSubscriptionLock(slowList[0], anchor, k));
  const moderate = slowList.length >= 3 ? slowList[slowList.length - 1] : slowList[0];
  if (moderate) decks.push(buildCafeStarter(moderate, anchor, k));
  if (slowList[0]) decks.push(buildTerritoryExclusive(slowList[0], anchor, k));
  return decks;
}

// ────────────────────────────────────────────────────────────────────────────
// UI sub-components
// ────────────────────────────────────────────────────────────────────────────

const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Bestseller",     meaning: "The SKU your customer is already moving fast — the engine of every offer here." },
  { term: "Slow flavor",    meaning: "A SKU sitting in the warehouse longer than your stock-month threshold (the slider above)." },
  { term: "Mix ratio",      meaning: "How many cases of bestseller go with each case of slow. e.g. 10:1 means \"10 bestseller + 1 slow per bundle\"." },
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

  // Visible knobs — kept simple, plain language.
  const [thresholdMonths, setThresholdMonths] = useState(9);
  const [swapClause, setSwapClause] = useState<SwapClause>("90");
  const [size, setSize] = useState<RetailerSize>("Medium");

  // Advanced knobs — collapsed by default.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mixPct, setMixPct] = useState(10);
  const [pricePerMc, setPricePerMc] = useState(127);
  const [unitsPerMc, setUnitsPerMc] = useState(60);
  const [pricingGuard, setPricingGuard] = useState<PricingGuard>("STRICT");

  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const knobs: Knobs = { thresholdMonths, swapClause, size, mixPct, pricePerMc, unitsPerMc, pricingGuard };

  const { slowList, anchor, summary } = useMemo(() => {
    if (!data?.skuIntel) return { slowList: [] as (SkuIntel & { moc: number })[], anchor: null as SkuIntel | null, summary: null as null | { totalSlow: number; totalSlowStock: number } };
    const intel = data.skuIntel as SkuIntel[];
    const withMoc = intel.map(s => ({
      ...s,
      moc: s.avg3m > 0 ? s.currentClosingStock / s.avg3m : (s.currentClosingStock > 0 ? 999 : 0),
    }));
    const slow = withMoc
      .filter(s => s.currentClosingStock > 0 && s.moc > thresholdMonths)
      .sort((a, b) => b.moc - a.moc);
    const candidates = intel.filter(s => s.avg3m > 0).sort((a, b) => b.avg3m - a.avg3m);
    // Anchor must not itself be one of the slow SKUs. If every active SKU is
    // overstocked, return null and the page will show an explicit empty state
    // rather than fall back to a self-bundle.
    const slowIds = new Set(slow.map(s => s.id));
    const anchor = candidates.find(c => !slowIds.has(c.id)) ?? null;
    return {
      slowList: slow,
      anchor,
      summary: {
        totalSlow: slow.length,
        totalSlowStock: slow.reduce((sum, s) => sum + s.currentClosingStock, 0),
      },
    };
  }, [data, thresholdMonths]);

  const decks = useMemo(() => {
    if (!anchor || slowList.length === 0) return [] as Deck[];
    return buildAllDecks(slowList, anchor, knobs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slowList, anchor, knobs.thresholdMonths, knobs.swapClause, knobs.size, knobs.mixPct, knobs.pricePerMc, knobs.unitsPerMc, knobs.pricingGuard]);

  const slowMocBySku = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of slowList) m.set(s.id, s.moc);
    return m;
  }, [slowList]);

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
          Up to 5 ready-to-send offer decks for {country}. Every deck piggybacks the slow flavor onto your bestseller — your customer's existing volume drags it through.
          <span className="block mt-1 text-xs">As of <strong>{data?.targetMonth} {data?.targetYear}</strong> · proposals only — nothing is saved.</span>
        </p>
      </div>

      <GlossaryPanel open={glossaryOpen} onToggle={() => setGlossaryOpen(o => !o)} />

      {/* Status banner */}
      {anchor && summary && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardContent className="p-4 grid sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Bestseller (the engine)</div>
              <div className="font-semibold mt-1">{anchor.name} <span className="text-muted-foreground">({anchor.weight})</span></div>
              <div className="text-muted-foreground">{fmt(anchor.avg3m)} cases / month (last 3M avg)</div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Slow flavors detected</div>
              <div className="font-semibold mt-1">{summary.totalSlow} flavor{summary.totalSlow === 1 ? "" : "s"}</div>
              <div className="text-muted-foreground">above {thresholdMonths} months of stock</div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Total slow stock</div>
              <div className="font-semibold mt-1">{fmt(summary.totalSlowStock)} units</div>
              <div className="text-muted-foreground">({fmt(summary.totalSlowStock / unitsPerMc)} mastercases on hand)</div>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">$ / case</Label>
                    <Input type="number" inputMode="decimal" value={pricePerMc} onChange={e => setPricePerMc(Number(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Units / case</Label>
                    <Input type="number" inputMode="numeric" value={unitsPerMc} onChange={e => setUnitsPerMc(Math.max(1, Number(e.target.value) || 1))} />
                  </div>
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
      ) : !anchor ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground space-y-1">
            <p>No bestseller SKU available in {country} to anchor an offer against.</p>
            <p className="text-xs">
              Either no SKU has recent sales (add IMS data first), <em>or</em> every SKU with sales activity is itself above your <strong>{thresholdMonths}-month</strong> stock threshold —
              meaning the whole catalog is overstocked. Try lowering the threshold to free up an anchor, or run a country-wide clearance instead of bundle plays.
            </p>
          </CardContent>
        </Card>
      ) : decks.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground flex items-start gap-3">
            <TrendingDown className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              No flavors in {country} are above {thresholdMonths} months of stock right now — your inventory is healthy. Try lowering the threshold to find proactive plays.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span><strong>{decks.length}</strong> ready-to-apply offer{decks.length === 1 ? "" : "s"}, ranked from simplest to biggest commitment.</span>
          </div>
          {decks.map((d, i) => {
            const slowId = d.templateId === "variety" ? slowList[0]?.id : (d.templateId === "cafe" && slowList.length >= 3 ? slowList[slowList.length - 1].id : slowList[0]?.id);
            const moc = slowId !== undefined ? slowMocBySku.get(slowId) ?? null : null;
            return <DeckCard key={`${d.templateId}-${i}`} deck={d} slowMonthsOfStock={moc} />;
          })}
        </div>
      )}

      <Card className="bg-muted/30">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1.5">
          <p><strong>How this works.</strong> The page uses your live stock and trailing 3-month sales (Forecast Intelligence diagnostics). Months of stock = closing stock ÷ trailing 3-month sales. Slow flavors are anything above your threshold. The bestseller is the SKU with the highest recent sales (and never the slow flavor itself). Each deck is a different way to attach the slow flavor to a normal bestseller order so the retailer's existing demand drags it through.</p>
          <p><strong>Read these as proposals.</strong> Nothing on this page writes to your database. Sales reps copy the script that fits the channel they're using; planning lead reviews the Risk and Appeal pills before sending.</p>
        </CardContent>
      </Card>
    </div>
  );
}
