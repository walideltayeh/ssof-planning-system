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
  ShieldAlert,
  ShieldCheck,
  Target,
  Package,
  TrendingDown,
  Crown,
  Award,
  Store,
} from "lucide-react";

type PricingGuard = "STRICT" | "SOFT" | "FLEX";
type SwapClause = "60" | "90" | "120" | "coop";
type Tier = "A" | "B" | "C";

const TIER_META: Record<Tier, { label: string; icon: typeof Crown; mult: number; coverage: string }> = {
  A: { label: "Tier A — Master distributor", icon: Crown,  mult: 1.0,  coverage: "Largest commitment, richest bundle" },
  B: { label: "Tier B — Sub-distributor",     icon: Award,  mult: 0.5,  coverage: "Mid commitment, halved block" },
  C: { label: "Tier C — Café / re-seller",    icon: Store,  mult: 0.25, coverage: "Smallest entry block, priority allocation" },
};

const SEVERITY = (moc: number): { label: string; tone: string } => {
  if (moc >= 100) return { label: "DEAD STOCK",  tone: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200" };
  if (moc >= 24)  return { label: "CRITICAL",    tone: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200" };
  if (moc >= 12)  return { label: "HEAVY OVER",  tone: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200" };
  return { label: "OVERSTOCK", tone: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200" };
};

function fmt(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

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

type OfferKnobs = {
  thresholdMoC: number;
  pricingGuard: PricingGuard;
  swapClause: SwapClause;
  freeGoodsCapPct: number;
  tier: Tier;
  pricePerMc: number;
  unitsPerMc: number;
};

function buildOffer(slow: SkuIntel, anchor: SkuIntel | null, k: OfferKnobs) {
  const monthsOfCover = slow.avg3m > 0 ? slow.currentClosingStock / slow.avg3m : 999;
  const targetOffloadUnits = Math.max(0, slow.currentClosingStock - 3 * slow.avg3m);
  const targetOffloadMc = Math.ceil(targetOffloadUnits / k.unitsPerMc);
  const slowMcOnHand = Math.round(slow.currentClosingStock / k.unitsPerMc);

  const cap = Math.max(1, k.freeGoodsCapPct);
  const anchorPullRatio = clamp(Math.ceil(100 / cap), 5, 15);

  const tierMeta = TIER_META[k.tier];
  const tierBlocks = k.tier === "A" ? 5 : k.tier === "B" ? 2 : 1;
  const bundleSlowMc = tierBlocks;
  const bundleAnchorMc = tierBlocks * anchorPullRatio;
  const bundleAnchorRevenue = bundleAnchorMc * k.pricePerMc;
  const bundleSlowRevenue = bundleSlowMc * k.pricePerMc;
  const totalInvoice = bundleAnchorRevenue + bundleSlowRevenue;
  const slowAsPctOfAnchor = bundleAnchorRevenue > 0 ? (bundleSlowRevenue / bundleAnchorRevenue) * 100 : 0;
  const retailersToFull = bundleSlowMc > 0 ? Math.ceil(targetOffloadMc / bundleSlowMc) : 0;
  const coopFundPerSlowMc = k.pricePerMc * 0.06;
  const coopFundTotal = bundleSlowMc * coopFundPerSlowMc;

  const guardCopy: Record<PricingGuard, string> = {
    STRICT: "List price unchanged on every invoice line. Value lives entirely in the bundle, the swap, and the co-op fund.",
    SOFT:   "Up to 5% promo allowed on the whole bundle if anchor MOQ is met. Per-unit invoice price still printed at list.",
    FLEX:   "Up to 10% invoice discount allowed when bundle + anchor pull + swap clause are all engaged.",
  };

  const swapCopy: Record<SwapClause, string> = {
    "60":   `60-day swap-back: any unsold ${slow.name} cases swap 1:1 for any anchor SKU on next order.`,
    "90":   `90-day swap-back (Hormozi default): any unsold ${slow.name} cases swap 1:1 for any anchor SKU on next order.`,
    "120":  `120-day swap-back: any unsold ${slow.name} cases swap 1:1 for any anchor SKU on next order.`,
    "coop": `In lieu of a swap, deposit $${fmt(coopFundPerSlowMc, 0)} per slow case into the retailer's co-op marketing fund (Instagram, café night, hookah-master event).`,
  };

  let ourScore = 100
    - (anchorPullRatio - 5) * 4
    - Math.max(0, k.freeGoodsCapPct - 5) * 2
    - (k.pricingGuard === "FLEX" ? 20 : k.pricingGuard === "SOFT" ? 10 : 0)
    - (k.swapClause === "120" ? 15 : k.swapClause === "90" ? 8 : k.swapClause === "60" ? 3 : -5);
  ourScore = clamp(Math.round(ourScore), 0, 100);

  const swapAppeal = k.swapClause === "120" ? 30 : k.swapClause === "90" ? 22 : k.swapClause === "60" ? 12 : 18;
  let retailerScore = 40
    + Math.min(k.freeGoodsCapPct * 1.5, 25)
    + swapAppeal
    + (k.tier === "A" ? 12 : k.tier === "B" ? 7 : 3)
    + (k.pricingGuard === "FLEX" ? 10 : k.pricingGuard === "SOFT" ? 5 : 0)
    + (slow.avg3m > 0 ? 5 : -10);
  retailerScore = clamp(Math.round(retailerScore), 0, 100);

  const devil: string[] = [];
  if (anchorPullRatio >= 13) devil.push(`Pull ratio ${anchorPullRatio}:1 looks generous to a sharp buyer — they may sniff desperation and ask for more.`);
  if (slow.avg3m <= 2) devil.push(`Trailing rate is only ${fmt(slow.avg3m, 1)} units/mo — even with the bundle, sell-through is uncertain. Expect swap-back claims.`);
  if (slowMcOnHand > retailersToFull * 3 && retailersToFull > 0) devil.push(`Single round won't clear ${slowMcOnHand} MC — needs ${Math.ceil(slowMcOnHand / Math.max(bundleSlowMc, 1))} retailers across multiple rounds.`);
  if (k.tier === "C" && bundleSlowMc >= 1 && slow.avg3m < 5) devil.push("Tier C cafés rarely turn 1 case of a slow flavor in 90 days — expect a high swap rate from this tier.");
  if (k.swapClause === "coop" && slow.avg3m === 0) devil.push("Co-op fund without swap on a zero-rate SKU = retailers absorb 100% of the dead-stock risk. Likely to be rejected.");
  if (k.pricingGuard === "FLEX" && k.freeGoodsCapPct >= 15) devil.push("FLEX pricing combined with 15%+ free-goods cap stacks two margin hits — anchor your floor before sending this.");

  const steel: string[] = [];
  if (anchor) steel.push(`Anchor ${anchor.name} runs at ${fmt(anchor.avg3m)} units/mo — retailer wins on shelf turn even if the slow case never moves.`);
  steel.push(`List price stays at $${fmt(k.pricePerMc)}/MC on every invoice line — no anchor erosion in retailer's mind.`);
  if (k.swapClause !== "coop") steel.push(`The ${k.swapClause}-day swap removes the retailer's downside — Hormozi's #1 close lever applied verbatim.`);
  if (k.swapClause === "coop") steel.push(`Co-op fund creates pull demand at the point of sale — funds Instagram boost, café night, hookah-master event without touching headline price.`);
  if (k.tier !== "A") steel.push(`Smaller tier-${k.tier} block (${bundleSlowMc} slow + ${bundleAnchorMc} anchor MC) lowers entry friction — more retailers will say yes.`);
  steel.push(`Retailer's effective free-goods value: ${fmt(slowAsPctOfAnchor, 1)}% of anchor invoice — within Hormozi's "feels generous, costs little" sweet spot.`);

  const script = `You're already moving ${fmt(anchor?.avg3m ?? 0)} units/mo of ${anchor?.name ?? "[anchor SKU]"}. Let's protect that volume and unlock a Q3 territory bonus: every ${anchorPullRatio} cases of ${anchor?.name ?? "[anchor]"} comes with ${1} case of ${slow.name} at the SAME per-case price. ${swapCopy[k.swapClause]} Same headline price on every line, more in your warehouse, zero downside for you. ${k.tier === "A" ? "First 20 distributors in the program get exclusive Q3 territory" : k.tier === "B" ? "Limited to 50 sub-distributors this quarter" : "Limited to first 100 cafés"}. Are you in?`;

  return {
    monthsOfCover,
    targetOffloadUnits,
    targetOffloadMc,
    slowMcOnHand,
    anchorPullRatio,
    bundleSlowMc,
    bundleAnchorMc,
    bundleAnchorRevenue,
    bundleSlowRevenue,
    totalInvoice,
    slowAsPctOfAnchor,
    retailersToFull,
    coopFundPerSlowMc,
    coopFundTotal,
    guardCopy: guardCopy[k.pricingGuard],
    swapCopy: swapCopy[k.swapClause],
    ourScore,
    retailerScore,
    devil,
    steel,
    script,
    tierMeta,
  };
}

function ScoreBar({ label, value, side }: { label: string; value: number; side: "us" | "them" }) {
  const tone = value >= 75 ? "bg-emerald-500" : value >= 55 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono">{value}/100</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full transition-all ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        {side === "us"
          ? value >= 75 ? "Margin & inventory risk well controlled." : value >= 55 ? "Acceptable risk — monitor swap-back rate." : "High exposure — tighten cap or shorten swap."
          : value >= 75 ? "Strong perceived value — high acceptance likely." : value >= 55 ? "Decent appeal — works for most retailers." : "Weak offer for retailer — expect pushback or rejection."}
      </p>
    </div>
  );
}

function OfferCard({ slow, anchor, knobs }: { slow: SkuIntel; anchor: SkuIntel | null; knobs: OfferKnobs }) {
  const o = useMemo(() => buildOffer(slow, anchor, knobs), [slow, anchor, knobs]);
  const sev = SEVERITY(o.monthsOfCover);
  const TierIcon = o.tierMeta.icon;

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-lg">{slow.name}</CardTitle>
              <Badge variant="outline" className="font-mono">{slow.weight}</Badge>
              <Badge variant="outline">{slow.category}</Badge>
              <Badge className={`border ${sev.tone}`}>{sev.label}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 mt-3 text-xs">
              <div><span className="text-muted-foreground">Stock on hand:</span> <span className="font-mono font-semibold">{fmt(slow.currentClosingStock)} u</span> ({fmt(o.slowMcOnHand)} MC)</div>
              <div><span className="text-muted-foreground">Run rate:</span> <span className="font-mono font-semibold">{fmt(slow.avg3m, 1)} u/mo</span></div>
              <div><span className="text-muted-foreground">Months of cover:</span> <span className="font-mono font-semibold">{o.monthsOfCover >= 999 ? "∞" : fmt(o.monthsOfCover, 1)}</span></div>
              <div><span className="text-muted-foreground">Target offload:</span> <span className="font-mono font-semibold">{fmt(o.targetOffloadMc)} MC</span></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TierIcon className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">{o.tierMeta.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hormozi value stack */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-semibold">Hormozi Value Stack</h4>
          </div>
          <ol className="space-y-1.5 text-xs">
            <li><span className="font-semibold">1. Anchor bundle:</span> Buy <span className="font-mono">{o.bundleAnchorMc}</span> MC of {anchor?.name ?? "[anchor]"} → unlocks <span className="font-mono">{o.bundleSlowMc}</span> MC of {slow.name} at the SAME ${fmt(knobs.pricePerMc)}/MC list price. Total invoice: <span className="font-mono font-semibold">${fmt(o.totalInvoice)}</span>.</li>
            <li><span className="font-semibold">2. Free goods on volume:</span> POSM kit (branded tray, tongs, table tents, neon sign) on the first complete bundle hit.</li>
            <li><span className="font-semibold">3. Co-op marketing fund:</span> ${fmt(o.coopFundPerSlowMc)} per slow MC = <span className="font-mono font-semibold">${fmt(o.coopFundTotal)}</span> for this bundle. Spent on Instagram boost / café event / hookah-master night — funds demand creation, not discount.</li>
            <li><span className="font-semibold">4. Exclusivity & scarcity:</span> {knobs.tier === "A" ? "First 20 master distributors" : knobs.tier === "B" ? "First 50 sub-distributors" : "First 100 cafés"} only. Slow SKU positioned as a <em>limited-edition micro-batch this quarter</em>, not as clearance.</li>
            <li><span className="font-semibold">5. Risk reversal:</span> {o.swapCopy}</li>
            <li><span className="font-semibold">6. Pricing guard:</span> {o.guardCopy}</li>
          </ol>
        </div>

        {/* Bundle math */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="rounded-md border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Anchor pull</div>
            <div className="text-lg font-mono font-bold">{o.anchorPullRatio}:1</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Slow / Anchor $</div>
            <div className="text-lg font-mono font-bold">{fmt(o.slowAsPctOfAnchor, 1)}%</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Retailers needed</div>
            <div className="text-lg font-mono font-bold">{fmt(o.retailersToFull)}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Bundle invoice</div>
            <div className="text-lg font-mono font-bold">${fmt(o.totalInvoice)}</div>
          </div>
        </div>

        {/* Devil + Steelman */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              <h5 className="text-sm font-semibold text-red-800 dark:text-red-300">Devil's Advocate</h5>
            </div>
            <ul className="space-y-1 text-xs text-red-900/80 dark:text-red-200/80 list-disc pl-4">
              {o.devil.length === 0
                ? <li className="list-none italic text-red-700/60 dark:text-red-300/60">No structural objections detected at these settings.</li>
                : o.devil.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Steelman</h5>
            </div>
            <ul className="space-y-1 text-xs text-emerald-900/80 dark:text-emerald-200/80 list-disc pl-4">
              {o.steel.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        </div>

        {/* Reliability scores */}
        <div className="grid sm:grid-cols-2 gap-4 rounded-lg border p-3 bg-muted/20">
          <ScoreBar label="Reliability for US (manufacturer)" value={o.ourScore} side="us" />
          <ScoreBar label="Reliability for RETAILER" value={o.retailerScore} side="them" />
        </div>

        {/* Sales rep script */}
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h5 className="text-sm font-semibold">Sales rep script</h5>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(o.script);
                  toast.success("Script copied to clipboard");
                } catch (err) {
                  toast.error(`Copy failed — ${err instanceof Error ? err.message : "browser blocked clipboard"}`);
                }
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground italic leading-relaxed">"{o.script}"</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TradeOffersPage() {
  const { country } = useCountry();
  const validCountry = country as "Lebanon" | "Syria" | "Libya" | "KSA";
  const { data, isLoading, isError, error } = trpc.country.forecastIntelligence.useQuery(
    { country: validCountry },
    { enabled: !!country },
  );

  const [thresholdMoC, setThresholdMoC] = useState(9);
  const [pricingGuard, setPricingGuard] = useState<PricingGuard>("STRICT");
  const [swapClause, setSwapClause] = useState<SwapClause>("90");
  const [freeGoodsCapPct, setFreeGoodsCapPct] = useState(10);
  const [tier, setTier] = useState<Tier>("A");
  const [pricePerMc, setPricePerMc] = useState(127);
  const [unitsPerMc, setUnitsPerMc] = useState(60);

  const knobs: OfferKnobs = { thresholdMoC, pricingGuard, swapClause, freeGoodsCapPct, tier, pricePerMc, unitsPerMc };

  const { overstock, anchorCandidates } = useMemo(() => {
    if (!data?.skuIntel) return { overstock: [] as SkuIntel[], anchorCandidates: [] as SkuIntel[] };
    const intel = data.skuIntel as SkuIntel[];
    const withMoc = intel.map(s => ({
      ...s,
      moc: s.avg3m > 0 ? s.currentClosingStock / s.avg3m : (s.currentClosingStock > 0 ? 999 : 0),
    }));
    // Use STRICT > threshold to match the UI labels ("> 9 months").
    const overstock = withMoc
      .filter(s => s.currentClosingStock > 0 && s.moc > thresholdMoC)
      .sort((a, b) => b.moc - a.moc);
    // Sorted candidate list — each offer card picks the top candidate that
    // isn't the slow SKU itself, so we never recommend self-bundles.
    const anchorCandidates = intel
      .filter(s => s.avg3m > 0)
      .sort((a, b) => b.avg3m - a.avg3m);
    return { overstock, anchorCandidates };
  }, [data, thresholdMoC]);
  const headlineAnchor = anchorCandidates[0] ?? null;
  const pickAnchorFor = (slowId: number): SkuIntel | null =>
    anchorCandidates.find(c => c.id !== slowId) ?? null;

  if (!country) {
    return <div className="p-6 text-sm text-muted-foreground">Select a country to view trade-offer recommendations.</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />
            Recommended AI Trade Offers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hormozi-style $100M Offer engine for {country}. Move slow stock without touching list price.
            <span className="block mt-1 text-xs">As of <strong>{data?.targetMonth} {data?.targetYear}</strong> · proposals only — nothing is saved.</span>
          </p>
        </div>
      </div>

      {/* Knob bar */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> Offer engine controls
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Pricing guard */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Pricing guard rail</Label>
            <Select value={pricingGuard} onValueChange={v => setPricingGuard(v as PricingGuard)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STRICT">STRICT — list price untouchable</SelectItem>
                <SelectItem value="SOFT">SOFT — up to 5% promo on bundle</SelectItem>
                <SelectItem value="FLEX">FLEX — up to 10% with anchor + swap</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Threshold */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Overstock trigger (months of cover)</Label>
            <Select value={String(thresholdMoC)} onValueChange={v => setThresholdMoC(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">Aggressive — &gt; 6 months</SelectItem>
                <SelectItem value="9">Balanced — &gt; 9 months (recommended)</SelectItem>
                <SelectItem value="12">Conservative — &gt; 12 months</SelectItem>
                <SelectItem value="18">Worst only — &gt; 18 months</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Swap */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Swap-back guarantee</Label>
            <Select value={swapClause} onValueChange={v => setSwapClause(v as SwapClause)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="60">60 days (low risk to us)</SelectItem>
                <SelectItem value="90">90 days (Hormozi default)</SelectItem>
                <SelectItem value="120">120 days (max appeal)</SelectItem>
                <SelectItem value="coop">No swap → co-op marketing fund instead</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tier */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold" id="tier-label">Retailer tier (changes bundle size)</Label>
            <div role="group" aria-labelledby="tier-label" className="flex gap-1">
              {(["A", "B", "C"] as Tier[]).map(t => {
                const Icon = TIER_META[t].icon;
                const selected = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Retailer tier ${t} — ${TIER_META[t].coverage}`}
                    onClick={() => setTier(t)}
                    className={`flex-1 px-2 py-2 rounded-md border text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                      selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> Tier {t}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">{TIER_META[tier].coverage}</p>
          </div>

          {/* Cap */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Free-goods cap: <span className="font-mono">{freeGoodsCapPct}%</span> of anchor invoice</Label>
            <Slider
              min={1}
              max={25}
              step={1}
              value={[freeGoodsCapPct]}
              onValueChange={v => setFreeGoodsCapPct(v[0])}
            />
            <p className="text-[10px] text-muted-foreground">
              Drives the anchor:slow pull ratio (clamped 5:1 to 15:1). Hormozi sweet spot ≈ 10%.
            </p>
          </div>

          {/* Price + units per MC */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">$ / MC (WS list)</Label>
              <Input type="number" inputMode="decimal" value={pricePerMc} onChange={e => setPricePerMc(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Units / MC</Label>
              <Input type="number" inputMode="numeric" value={unitsPerMc} onChange={e => setUnitsPerMc(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Body */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading diagnostics…
        </div>
      ) : isError ? (
        <Card><CardContent className="p-6 text-sm text-destructive">Failed to load: {String(error?.message ?? "unknown")}</CardContent></Card>
      ) : !headlineAnchor ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No fast-mover anchor SKU found in {country}. Add at least one SKU with positive recent IMS to enable offer recommendations.</CardContent></Card>
      ) : overstock.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground flex items-start gap-3">
            <TrendingDown className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              No SKUs in {country} cross the {thresholdMoC}-month-of-cover threshold right now. Either inventory is healthy or the threshold is too strict — try lowering it above.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Found <strong>{overstock.length}</strong> SKU{overstock.length === 1 ? "" : "s"} above {thresholdMoC} months of cover. Headline anchor: <strong>{headlineAnchor.name} ({headlineAnchor.weight})</strong> at {fmt(headlineAnchor.avg3m)} units/mo.
            <span className="block mt-0.5 text-[11px] italic">Each card picks its own anchor — the slow SKU is never anchored against itself.</span>
          </div>
          {overstock.map(s => {
            const cardAnchor = pickAnchorFor(s.id);
            return <OfferCard key={s.id} slow={s} anchor={cardAnchor} knobs={knobs} />;
          })}
        </div>
      )}

      {/* Method note */}
      <Card className="bg-muted/30">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1.5">
          <p><strong>Method.</strong> Stock and trailing 3-month run rate come from your live Forecast Intelligence diagnostics. Months of cover = closing stock ÷ run rate. Target offload brings cover to 3 months. Anchor pull ratio = ⌈100 ÷ free-goods cap%⌉, clamped to 5–15. Tier A commits 5 bundle blocks, B commits 2, C commits 1. Co-op fund = 6% of slow MC list price. Reliability scores penalize aggressive caps, FLEX pricing, and missing swap; reward longer swaps, fast-mover anchors, and tier-A scale.</p>
          <p><strong>Read this page as proposals.</strong> Nothing here writes to your database. Sales reps use the script + bundle math; planning lead reviews the reliability scores before sending.</p>
        </CardContent>
      </Card>
    </div>
  );
}
