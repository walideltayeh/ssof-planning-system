import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Search, AlertCircle, ShieldCheck, Package, Calendar, Anchor, Warehouse, ShoppingCart, ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react";

// ── Alert tier config ────────────────────────────────────────────────────────
const TIER_CONFIG = {
  Expired: {
    label: "Expired", shortLabel: "EXP",
    badgeCls: "bg-gray-900 text-white border-gray-900",
    cardBg: "bg-gradient-to-br from-gray-900 to-gray-800",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-gray-300",
    dotCls: "bg-gray-900", rowBg: "bg-gray-100", rowBorder: "border-l-4 border-l-gray-900",
    textCls: "text-gray-900", description: "Past 2-year shelf life",
  },
  "2M": {
    label: "2 Months", shortLabel: "2M",
    badgeCls: "bg-red-600 text-white border-red-600",
    cardBg: "bg-gradient-to-br from-red-600 to-red-500",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-red-100",
    dotCls: "bg-red-600", rowBg: "bg-red-50", rowBorder: "border-l-4 border-l-red-500",
    textCls: "text-red-700", description: "Expires within 2 months",
  },
  "4M": {
    label: "4 Months", shortLabel: "4M",
    badgeCls: "bg-amber-500 text-white border-amber-500",
    cardBg: "bg-gradient-to-br from-amber-500 to-amber-400",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-amber-100",
    dotCls: "bg-amber-500", rowBg: "bg-amber-50/60", rowBorder: "border-l-4 border-l-amber-400",
    textCls: "text-amber-700", description: "Expires within 4 months",
  },
  "6M": {
    label: "6 Months", shortLabel: "6M",
    badgeCls: "bg-yellow-500 text-white border-yellow-500",
    cardBg: "bg-gradient-to-br from-yellow-500 to-yellow-400",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-yellow-100",
    dotCls: "bg-yellow-500", rowBg: "bg-yellow-50/40", rowBorder: "border-l-4 border-l-yellow-400",
    textCls: "text-yellow-700", description: "Expires within 6 months",
  },
  "9M": {
    label: "9 Months", shortLabel: "9M",
    badgeCls: "bg-lime-500 text-white border-lime-500",
    cardBg: "bg-gradient-to-br from-lime-600 to-lime-500",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-lime-100",
    dotCls: "bg-lime-500", rowBg: "bg-lime-50/40", rowBorder: "border-l-4 border-l-lime-400",
    textCls: "text-lime-700", description: "Expires within 9 months",
  },
  "12M": {
    label: "12 Months", shortLabel: "12M",
    badgeCls: "bg-teal-500 text-white border-teal-500",
    cardBg: "bg-gradient-to-br from-teal-600 to-teal-500",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-teal-100",
    dotCls: "bg-teal-500", rowBg: "bg-teal-50/40", rowBorder: "border-l-4 border-l-teal-400",
    textCls: "text-teal-700", description: "Expires within 12 months",
  },
  "18M": {
    label: "18 Months", shortLabel: "18M",
    badgeCls: "bg-sky-500 text-white border-sky-500",
    cardBg: "bg-gradient-to-br from-sky-600 to-sky-500",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-sky-100",
    dotCls: "bg-sky-500", rowBg: "bg-sky-50/30", rowBorder: "border-l-4 border-l-sky-400",
    textCls: "text-sky-700", description: "Expires within 18 months",
  },
  "24M": {
    label: "24 Months", shortLabel: "24M",
    badgeCls: "bg-indigo-500 text-white border-indigo-500",
    cardBg: "bg-gradient-to-br from-indigo-600 to-indigo-500",
    cardText: "text-white", cardCountCls: "text-white", cardSubCls: "text-indigo-100",
    dotCls: "bg-indigo-500", rowBg: "bg-indigo-50/30", rowBorder: "border-l-4 border-l-indigo-400",
    textCls: "text-indigo-700", description: "Expires within 24 months",
  },
} as const;

type AlertTier = keyof typeof TIER_CONFIG;
const TIERS: AlertTier[] = ["Expired", "2M", "4M", "6M", "9M", "12M", "18M", "24M"];
const CRITICAL_TIERS: AlertTier[] = ["Expired", "2M", "4M", "6M"];
const WATCH_TIERS: AlertTier[] = ["9M", "12M", "18M", "24M"];

const TIER_ORDER: Record<string, number> = {
  Expired: 0, "2M": 1, "4M": 2, "6M": 3, "9M": 4, "12M": 5, "18M": 6, "24M": 7,
};

function TierBadge({ tier }: { tier: string }) {
  const cfg = TIER_CONFIG[tier as AlertTier];
  if (!cfg) return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">OK</Badge>;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badgeCls}`}>
      <span className={`w-2 h-2 rounded-full ${tier === "Expired" ? "bg-white" : "bg-white/80"}`} />
      {cfg.label}
    </span>
  );
}

function formatQty(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMonthYear(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function ExpiryProgressBar({ months, tier }: { months: number; tier: AlertTier }) {
  const pct = tier === "Expired" ? 100 : Math.max(0, Math.min(100, ((24 - months) / 24) * 100));
  const barColor = tier === "Expired" ? "bg-gray-900"
    : tier === "2M" ? "bg-red-500" : tier === "4M" ? "bg-amber-500"
    : tier === "6M" ? "bg-yellow-400" : tier === "9M" ? "bg-lime-500"
    : tier === "12M" ? "bg-teal-500" : tier === "18M" ? "bg-sky-500" : "bg-indigo-500";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums whitespace-nowrap ${tier === "Expired" ? "text-gray-900" : TIER_CONFIG[tier].textCls}`}>
        {tier === "Expired" ? "EXP" : `${months.toFixed(1)}m`}
      </span>
    </div>
  );
}

function BatchLifecycleBar({ produced, sold, atPort, inCountry, formatter }: {
  produced: number; sold: number; atPort: number; inCountry: number;
  formatter?: (n: number) => string;
}) {
  const f = formatter ?? formatQty;
  if (produced === 0) return <span className="text-xs text-gray-400">—</span>;
  const soldPct = (sold / produced) * 100;
  const inCountryPct = (inCountry / produced) * 100;
  const atPortPct = (atPort / produced) * 100;
  return (
    <div className="min-w-[120px]">
      <div className="h-3 rounded-full bg-gray-200 overflow-hidden flex">
        {soldPct > 0 && (
          <div className="h-full bg-emerald-500" style={{ width: `${soldPct}%` }} title={`Sold: ${f(sold)}`} />
        )}
        {inCountryPct > 0 && (
          <div className="h-full bg-amber-400" style={{ width: `${inCountryPct}%` }} title={`In-Country: ${f(inCountry)}`} />
        )}
        {atPortPct > 0 && (
          <div className="h-full bg-blue-400" style={{ width: `${atPortPct}%` }} title={`At Port: ${f(atPort)}`} />
        )}
      </div>
      <div className="flex justify-between mt-0.5 text-[10px] text-gray-400 tabular-nums">
        <span>0</span>
        <span>{f(produced)}</span>
      </div>
    </div>
  );
}

// ── Group type ────────────────────────────────────────────────────────────────
interface MonthGroup {
  key: string; // "2025-12"
  label: string; // "December 2025"
  expiryLabel: string; // "December 2027"
  rows: typeof _rowTypeHelper;
  totalProduced: number;
  totalCleared: number;
  totalAtPort: number;
  totalSold: number;
  totalInCountry: number;
  totalRemaining: number;
  worstTier: AlertTier;
}
 
const _rowTypeHelper = [] as any[];

export default function ExpiryDashboardPage() {
  const { country } = useCountry();
  const { formatVal } = useUnit();
  const formatQty = (n: number) => formatVal(n);
  const isIntl = country === "Syria" || country === "Libya";

  const { data, isLoading, refetch, isFetching } = trpc.country.expiryDashboard.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: isIntl, staleTime: 0, refetchOnWindowFocus: true }
  );

  const [searchText, setSearchText] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | AlertTier>("all");
  const [weightFilter, setWeightFilter] = useState<"all" | "50g" | "250g" | "1kg">("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "Core" | "NPI">("all");
  const [locationFilter, setLocationFilter] = useState<"all" | "at-port" | "in-country" | "fully-sold">("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? {
    expired: 0, twoMonth: 0, fourMonth: 0, sixMonth: 0,
    nineMonth: 0, twelveMonth: 0, eighteenMonth: 0, twentyFourMonth: 0,
  };

  // ── Filter rows ──────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (tierFilter !== "all" && r.alertTier !== tierFilter) return false;
      if (weightFilter !== "all" && r.weight !== weightFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (locationFilter === "at-port" && r.atPortQty <= 0) return false;
      if (locationFilter === "in-country" && r.inCountryQty <= 0) return false;
      if (locationFilter === "fully-sold" && r.totalRemaining > 0) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        if (!r.skuName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, tierFilter, weightFilter, categoryFilter, locationFilter, searchText]);

  // ── Sort by production date (oldest first) then group by month ──────────
  const groupedByMonth = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      // Primary: production date ascending (oldest first)
      const dateComp = a.productionDate.localeCompare(b.productionDate);
      if (dateComp !== 0) return dateComp;
      // Secondary: alert tier (most urgent first)
      return (TIER_ORDER[a.alertTier] ?? 99) - (TIER_ORDER[b.alertTier] ?? 99);
    });

    const groupMap = new Map<string, MonthGroup>();
    for (const row of sorted) {
      // Extract YYYY-MM from productionDate
      const monthKey = row.productionDate.substring(0, 7); // "2025-12"
      if (!groupMap.has(monthKey)) {
        const prodLabel = formatMonthYear(row.productionDate);
        // Compute expiry label (production + 2 years)
        const pd = new Date(row.productionDate + "T00:00:00");
        pd.setFullYear(pd.getFullYear() + 2);
        const expiryLabel = pd.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        groupMap.set(monthKey, {
          key: monthKey,
          label: prodLabel,
          expiryLabel,
          rows: [],
          totalProduced: 0, totalCleared: 0, totalAtPort: 0,
          totalSold: 0, totalInCountry: 0, totalRemaining: 0,
          worstTier: "24M",
        });
      }
      const g = groupMap.get(monthKey)!;
      g.rows.push(row);
      g.totalProduced += row.producedQty;
      g.totalCleared += row.clearedQty;
      g.totalAtPort += row.atPortQty;
      g.totalSold += row.soldQty;
      g.totalInCountry += row.inCountryQty;
      g.totalRemaining += row.totalRemaining;
      // Track worst (most urgent) tier
      const rowTierIdx = TIER_ORDER[row.alertTier] ?? 99;
      const curWorstIdx = TIER_ORDER[g.worstTier] ?? 99;
      if (rowTierIdx < curWorstIdx) {
        g.worstTier = row.alertTier as AlertTier;
      }
    }
    return Array.from(groupMap.values());
  }, [filteredRows]);

  const totalRemaining = filteredRows.reduce((s, r) => s + r.totalRemaining, 0);
  const totalAtPort = filteredRows.reduce((s, r) => s + r.atPortQty, 0);
  const totalInCountry = filteredRows.reduce((s, r) => s + r.inCountryQty, 0);
  const totalProduced = filteredRows.reduce((s, r) => s + r.producedQty, 0);
  const totalSold = filteredRows.reduce((s, r) => s + r.soldQty, 0);

  const summaryByTier: Record<AlertTier, number> = {
    Expired: summary.expired, "2M": summary.twoMonth, "4M": summary.fourMonth, "6M": summary.sixMonth,
    "9M": summary.nineMonth, "12M": summary.twelveMonth, "18M": summary.eighteenMonth, "24M": summary.twentyFourMonth,
  };

  const totalAlerts = TIERS.reduce((s, t) => s + summaryByTier[t], 0);
  const hasAlerts = totalAlerts > 0;
  const criticalCount = CRITICAL_TIERS.reduce((s, t) => s + summaryByTier[t], 0);

  // ── Collapse helpers ─────────────────────────────────────────────────────
  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allGroupKeys = useMemo(() => groupedByMonth.map(g => g.key), [groupedByMonth]);

  const expandAll = () => setCollapsedGroups(new Set());
  const collapseAll = () => setCollapsedGroups(new Set(allGroupKeys));
  const allCollapsed = collapsedGroups.size === allGroupKeys.length && allGroupKeys.length > 0;
  const allExpanded = collapsedGroups.size === 0;

  if (!isIntl) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-lg font-medium mb-2">Expiry Dashboard is only available for Syria and Libya</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 max-w-[1800px]">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Product Expiry Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                {country} — Batch lifecycle tracking with 2-year shelf life
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50 shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {/* ── Lifecycle Summary Cards ──────────────────────────────────── */}
      {hasAlerts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Anchor className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">At Port</span>
              </div>
              <div className="text-2xl font-extrabold text-blue-800 tabular-nums">{formatQty(totalAtPort)}</div>
              <div className="text-xs text-blue-600 mt-0.5">Produced but not cleared</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Warehouse className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">In-Country</span>
              </div>
              <div className="text-2xl font-extrabold text-amber-800 tabular-nums">{formatQty(totalInCountry)}</div>
              <div className="text-xs text-amber-600 mt-0.5">Cleared but not sold</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <ShoppingCart className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Sold (IMS)</span>
              </div>
              <div className="text-2xl font-extrabold text-emerald-800 tabular-nums">{formatQty(totalSold)}</div>
              <div className="text-xs text-emerald-600 mt-0.5">Consumed via FIFO</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <span className="text-xs font-bold text-red-600 uppercase tracking-wider">Total Remaining</span>
              </div>
              <div className="text-2xl font-extrabold text-red-800 tabular-nums">{formatQty(totalRemaining)}</div>
              <div className="text-xs text-red-600 mt-0.5">At port + in-country</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Critical Alerts ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Critical Alerts</h2>
          {criticalCount > 0 && (
            <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{criticalCount} batch{criticalCount !== 1 ? "es" : ""}</span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {CRITICAL_TIERS.map(tier => {
            const cfg = TIER_CONFIG[tier];
            const count = summaryByTier[tier];
            const isActive = tierFilter === tier;
            return (
              <button
                key={tier}
                onClick={() => setTierFilter(prev => prev === tier ? "all" : tier)}
                className={`relative rounded-2xl p-4 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${cfg.cardBg} ${isActive ? "ring-3 ring-offset-2 ring-gray-400 shadow-xl scale-[1.02]" : "shadow-md"}`}
              >
                <div className={`text-3xl font-extrabold tabular-nums mb-0.5 ${cfg.cardCountCls}`}>{count}</div>
                <div className={`text-sm font-semibold ${cfg.cardText}`}>{cfg.label}</div>
                <div className={`text-xs mt-0.5 ${cfg.cardSubCls}`}>{cfg.description}</div>
                {isActive && <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-white animate-pulse" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Watch List ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-sky-500" />
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Watch List</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {WATCH_TIERS.map(tier => {
            const cfg = TIER_CONFIG[tier];
            const count = summaryByTier[tier];
            const isActive = tierFilter === tier;
            return (
              <button
                key={tier}
                onClick={() => setTierFilter(prev => prev === tier ? "all" : tier)}
                className={`relative rounded-2xl p-4 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${cfg.cardBg} ${isActive ? "ring-3 ring-offset-2 ring-gray-400 shadow-xl scale-[1.02]" : "shadow-md"}`}
              >
                <div className={`text-3xl font-extrabold tabular-nums mb-0.5 ${cfg.cardCountCls}`}>{count}</div>
                <div className={`text-sm font-semibold ${cfg.cardText}`}>{cfg.label}</div>
                <div className={`text-xs mt-0.5 ${cfg.cardSubCls}`}>{cfg.description}</div>
                {isActive && <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-white animate-pulse" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── No alerts state ────────────────────────────────────────── */}
      {!isLoading && !hasAlerts && (
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
          <CardContent className="pt-10 pb-10 text-center">
            <ShieldCheck className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
            <p className="text-xl font-bold text-emerald-800">All Clear</p>
            <p className="text-sm text-emerald-600 mt-2 max-w-md mx-auto">
              All products in {country} have more than 24 months of remaining shelf life.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Filters ────────────────────────────────────────────────── */}
      {hasAlerts && (
        <Card className="shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search SKU..."
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="w-52 h-9 text-sm pl-8"
                />
              </div>
              <Select value={tierFilter} onValueChange={v => setTierFilter(v as typeof tierFilter)}>
                <SelectTrigger className="w-36 h-9 text-sm">
                  <SelectValue placeholder="Alert tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  {TIERS.map(t => <SelectItem key={t} value={t}>{TIER_CONFIG[t].label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={weightFilter} onValueChange={v => setWeightFilter(v as typeof weightFilter)}>
                <SelectTrigger className="w-28 h-9 text-sm">
                  <SelectValue placeholder="Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sizes</SelectItem>
                  <SelectItem value="1kg">1kg</SelectItem>
                  <SelectItem value="250g">250g</SelectItem>
                  <SelectItem value="50g">50g</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={v => setCategoryFilter(v as typeof categoryFilter)}>
                <SelectTrigger className="w-32 h-9 text-sm">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="Core">Core</SelectItem>
                  <SelectItem value="NPI">NPI</SelectItem>
                </SelectContent>
              </Select>
              <Select value={locationFilter} onValueChange={v => setLocationFilter(v as typeof locationFilter)}>
                <SelectTrigger className="w-40 h-9 text-sm">
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  <SelectItem value="at-port">Has Stock at Port</SelectItem>
                  <SelectItem value="in-country">Has In-Country Stock</SelectItem>
                  <SelectItem value="fully-sold">Fully Sold</SelectItem>
                </SelectContent>
              </Select>
              {(tierFilter !== "all" || weightFilter !== "all" || categoryFilter !== "all" || locationFilter !== "all" || searchText) && (
                <button
                  onClick={() => { setTierFilter("all"); setWeightFilter("all"); setCategoryFilter("all"); setLocationFilter("all"); setSearchText(""); }}
                  className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                >
                  Clear all
                </button>
              )}
              <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
                <span><strong className="text-foreground">{filteredRows.length}</strong> batch{filteredRows.length !== 1 ? "es" : ""}</span>
                <span className="text-gray-300">|</span>
                <span><strong className="text-foreground">{groupedByMonth.length}</strong> month{groupedByMonth.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Lifecycle Legend ────────────────────────────────────────── */}
      {hasAlerts && (
        <div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
          <span className="font-bold text-gray-500 uppercase tracking-wider mr-1">Bar Legend:</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" /> Sold (IMS)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" /> In-Country</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-400" /> At Port</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200" /> Capacity</span>
        </div>
      )}

      {/* ── Main table with collapsible month groups ───────────────── */}
      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40 animate-spin" />
            <p className="text-muted-foreground">Loading expiry data...</p>
          </CardContent>
        </Card>
      ) : hasAlerts && filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
            <p>No batches match the current filters.</p>
          </CardContent>
        </Card>
      ) : hasAlerts ? (
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="pb-0 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Batch Lifecycle Tracker
              </CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Sorted by production date — oldest first
                </span>
                <button
                  onClick={allCollapsed ? expandAll : collapseAll}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-600"
                >
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                  {allCollapsed ? "Expand All" : "Collapse All"}
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 mt-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-y border-gray-200">
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider w-8"></th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">SKU</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Size</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Pkg</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Expires</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider min-w-[120px]">Time Left</th>
                    <th className="text-right px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Produced</th>
                    <th className="text-right px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Cleared</th>
                    <th className="text-right px-3 py-3 font-semibold text-blue-600 text-xs uppercase tracking-wider">At Port</th>
                    <th className="text-right px-3 py-3 font-semibold text-emerald-600 text-xs uppercase tracking-wider">Sold</th>
                    <th className="text-right px-3 py-3 font-semibold text-amber-600 text-xs uppercase tracking-wider">In-Country</th>
                    <th className="text-right px-3 py-3 font-semibold text-red-600 text-xs uppercase tracking-wider">Remaining</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider min-w-[130px]">Lifecycle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {groupedByMonth.map((group) => {
                    const isCollapsed = collapsedGroups.has(group.key);
                    const worstCfg = TIER_CONFIG[group.worstTier];
                    return (
                      <GroupRows
                        key={group.key}
                        group={group}
                        isCollapsed={isCollapsed}
                        onToggle={() => toggleGroup(group.key)}
                        worstCfg={worstCfg}
                      />
                    );
                  })}
                </tbody>
                {filteredRows.length > 1 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold text-sm">
                      <td className="px-3 py-3"></td>
                      <td colSpan={6} className="px-3 py-3 text-right text-gray-600">Grand Total</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">{formatQty(totalProduced)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-600">{formatQty(filteredRows.reduce((s, r) => s + r.clearedQty, 0))}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-blue-700">{formatQty(totalAtPort)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{formatQty(totalSold)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-amber-700">{formatQty(totalInCountry)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-red-700 text-base">{formatQty(totalRemaining)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── How it works ───────────────────────────────────────────── */}
      <Card className="bg-gray-50/50 border-dashed shadow-none">
        <CardContent className="pt-5 pb-5">
          <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">How Batch Lifecycle Tracking Works</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
            <div className="flex items-start gap-2.5">
              <Package className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div><strong className="text-gray-700">Produced</strong> — Total qty from Production page (week1+week2+week3+week4)</div>
            </div>
            <div className="flex items-start gap-2.5">
              <Anchor className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div><strong className="text-blue-700">At Port</strong> — Produced minus Cleared. Goods still at port, not yet in-country.</div>
            </div>
            <div className="flex items-start gap-2.5">
              <Warehouse className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div><strong className="text-amber-700">In-Country</strong> — Cleared minus Sold. Goods in the warehouse, not yet consumed.</div>
            </div>
            <div className="flex items-start gap-2.5">
              <ShoppingCart className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div><strong className="text-emerald-700">Sold (IMS)</strong> — Sales attributed to oldest cleared batch first (FIFO method).</div>
            </div>
            <div className="flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div><strong className="text-gray-700">Expiry</strong> — Production date + 2 years (e.g., Dec '25 expires Dec '27)</div>
            </div>
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div><strong className="text-red-700">Remaining</strong> — At Port + In-Country = total stock that could expire</div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-200 flex-wrap">
            <span className="text-xs font-semibold text-gray-500">Alert Levels:</span>
            {TIERS.map(t => (
              <div key={t} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded-full ${TIER_CONFIG[t].dotCls}`} />
                <span className="text-xs text-gray-600 font-medium">{TIER_CONFIG[t].label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Collapsible group rows component ──────────────────────────────────────────
function GroupRows({ group, isCollapsed, onToggle, worstCfg }: {
  group: MonthGroup;
  isCollapsed: boolean;
  onToggle: () => void;
  worstCfg: typeof TIER_CONFIG[AlertTier];
}) {
  return (
    <>
      {/* ── Month group header row ─────────────────────────────────── */}
      <tr
        onClick={onToggle}
        className="cursor-pointer bg-gradient-to-r from-gray-100 to-gray-50 hover:from-gray-200 hover:to-gray-100 transition-colors border-t-2 border-gray-300"
      >
        <td className="px-3 py-3">
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </td>
        <td colSpan={2} className="px-3 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-800">
              {group.label}
            </span>
            <TierBadge tier={group.worstTier} />
            <span className="text-xs text-gray-500">
              {group.rows.length} SKU{group.rows.length !== 1 ? "s" : ""}
            </span>
          </div>
        </td>
        <td className="px-3 py-3">
          <span className="text-xs text-gray-500">Expires:</span>
          <span className={`text-xs font-bold ml-1 ${worstCfg.textCls}`}>{group.expiryLabel}</span>
        </td>
        <td className="px-3 py-3"></td>
        <td className="px-3 py-3"></td>
        <td className="px-3 py-3"></td>
        <td className="px-3 py-3 text-right">
          <span className="tabular-nums text-gray-700 font-bold text-xs">{formatQty(group.totalProduced)}</span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="tabular-nums text-gray-600 font-bold text-xs">{formatQty(group.totalCleared)}</span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="tabular-nums text-blue-700 font-bold text-xs">{formatQty(group.totalAtPort)}</span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="tabular-nums text-emerald-600 font-bold text-xs">{formatQty(group.totalSold)}</span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="tabular-nums text-amber-700 font-bold text-xs">{formatQty(group.totalInCountry)}</span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className={`tabular-nums font-extrabold text-sm ${group.totalRemaining > 0 ? worstCfg.textCls : "text-emerald-600"}`}>
            {group.totalRemaining > 0 ? formatQty(group.totalRemaining) : "Fully Sold"}
          </span>
        </td>
        <td className="px-3 py-3">
          <BatchLifecycleBar
            produced={group.totalProduced}
            sold={group.totalSold}
            atPort={group.totalAtPort}
            inCountry={group.totalInCountry}
            formatter={formatQty}
          />
        </td>
      </tr>
      {/* ── Individual batch rows (hidden when collapsed) ──────────── */}
      {!isCollapsed && group.rows.map((row: any) => {
        const tier = row.alertTier as AlertTier;
        const cfg = TIER_CONFIG[tier];
        if (!cfg) return null;
        const fullySold = row.totalRemaining <= 0;
        return (
          <tr
            key={`${row.skuId}-${row.productionPeriodId}`}
            className={`${fullySold ? "bg-emerald-50/30 opacity-70" : cfg.rowBg} ${cfg.rowBorder} hover:brightness-[0.97] transition-colors`}
          >
            <td className="px-3 py-2.5"></td>
            <td className="px-3 py-2.5">
              <TierBadge tier={row.alertTier} />
            </td>
            <td className="px-3 py-2.5">
              <span className={`font-semibold block max-w-[180px] truncate ${fullySold ? "text-gray-500" : "text-gray-900"}`} title={row.skuName}>
                {row.skuName}
              </span>
            </td>
            <td className="px-3 py-2.5">
              <span className="text-xs font-bold bg-gray-200 text-gray-700 px-2 py-0.5 rounded-md">{row.weight}</span>
            </td>
            <td className="px-3 py-2.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${row.packagingType === "Old" ? "bg-amber-100 text-amber-800 border border-amber-200" : "bg-blue-100 text-blue-800 border border-blue-200"}`}>
                {row.packagingType}
              </span>
            </td>
            <td className="px-3 py-2.5">
              <div className={`font-bold ${fullySold ? "text-gray-500" : cfg.textCls}`}>{formatDate(row.expiryDate)}</div>
            </td>
            <td className="px-3 py-2.5">
              <ExpiryProgressBar months={row.monthsUntilExpiry} tier={tier} />
            </td>
            <td className="px-3 py-2.5 text-right">
              <span className="tabular-nums text-gray-600 font-medium">{formatQty(row.producedQty)}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
              <span className="tabular-nums text-gray-600">{formatQty(row.clearedQty)}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
              {row.atPortQty > 0 ? (
                <span className="tabular-nums font-bold text-blue-700">{formatQty(row.atPortQty)}</span>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
            <td className="px-3 py-2.5 text-right">
              <span className="tabular-nums text-emerald-600">{formatQty(row.soldQty)}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
              {row.inCountryQty > 0 ? (
                <span className="tabular-nums font-bold text-amber-700">{formatQty(row.inCountryQty)}</span>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
            <td className="px-3 py-2.5 text-right">
              {fullySold ? (
                <span className="text-xs font-semibold text-emerald-600">Fully Sold</span>
              ) : (
                <span className={`tabular-nums font-extrabold text-base ${cfg.textCls}`}>
                  {formatQty(row.totalRemaining)}
                </span>
              )}
            </td>
            <td className="px-3 py-2.5">
              <BatchLifecycleBar
                produced={row.producedQty}
                sold={row.soldQty}
                atPort={row.atPortQty}
                inCountry={row.inCountryQty}
                formatter={formatQty}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}
