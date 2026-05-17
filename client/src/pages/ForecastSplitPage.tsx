import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Sparkles, TrendingUp, TrendingDown, Minus, AlertTriangle, Download, RefreshCw, CheckCircle2, Undo2, Layers, Globe, Moon, Sun, Thermometer, BarChart2, Package, Brain, Database, Activity, Search, Cpu, FileSpreadsheet, ChevronDown, ChevronRight, Calendar, Clock, Upload, FileUp, X, ArrowRight } from "lucide-react";
import { useEffect, useState as useStateLocal } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

import { MONTHS, SHORT_MONTHS, getConsecutiveMonths, distributeTonsBySeasonality, computeQuickRange, QUICK_RANGE_LABELS, type QuickRangePreset } from "./forecastSplit.helpers";

type Recommendation = {
  skuName: string;
  weight: string;
  category: string;
  packagingType?: string;
  recommendedMastercases: number;
  sharePercent: number;
  reasoning: string;
  trend: "growing" | "stable" | "declining" | "new";
  seasonalityNote: string;
  stockAlert?: string;
  confidenceScore?: number;
  primaryDriver?: string;
  marketIntelligenceNote?: string;
};

type RecommendResult = {
  totalTons: number;
  totalMastercases: number;
  mastercaseKg: number;
  targetMonth: number;
  targetYear: number;
  country: string;
  recommendations: Recommendation[];
  overallInsight: string;
  warnings: string[];
  marketSummary?: string;
  isRamadanMonth?: boolean;
  ramadanBoostPct?: number;
  marketSeasonalityIndex?: number;
};

/** Multi-month result: one RecommendResult per month */
type MultiMonthResult = {
  duration: number;
  startMonth: number;
  startYear: number;
  totalTons: number;
  mastercaseKg: number;
  country: string;
  monthResults: RecommendResult[];
};

type SnapshotEntry = {
  skuName: string;
  weight: string;
  packagingType?: string;
  previousValue: string | null;
  previousImsValue?: string | null;
};

function TrendBadge({ trend }: { trend: string }) {
  if (trend === "growing") return (
    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
      <TrendingUp className="w-3 h-3" /> Growing
    </Badge>
  );
  if (trend === "declining") return (
    <Badge className="bg-red-100 text-red-800 border-red-200 gap-1">
      <TrendingDown className="w-3 h-3" /> Declining
    </Badge>
  );
  if (trend === "new") return (
    <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1">
      <Sparkles className="w-3 h-3" /> New
    </Badge>
  );
  return (
    <Badge className="bg-gray-100 text-gray-700 border-gray-200 gap-1">
      <Minus className="w-3 h-3" /> Stable
    </Badge>
  );
}

function PrimaryDriverBadge({ driver }: { driver?: string }) {
  if (!driver) return <span className="text-gray-400 text-xs">—</span>;
  const config: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    stock_critical:   { label: 'Stock Critical',   icon: <AlertTriangle className="w-3 h-3" />, cls: 'bg-red-100 text-red-700 border-red-200' },
    stock_overstock:  { label: 'Overstock',        icon: <Package className="w-3 h-3" />,       cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    ramadan_uplift:   { label: 'Ramadan Uplift',   icon: <Moon className="w-3 h-3" />,          cls: 'bg-purple-100 text-purple-700 border-purple-200' },
    summer_peak:      { label: 'Summer Peak',      icon: <Sun className="w-3 h-3" />,           cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    winter_dip:       { label: 'Winter Dip',       icon: <Thermometer className="w-3 h-3" />,   cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    trend_growth:     { label: 'Trend Growth',     icon: <TrendingUp className="w-3 h-3" />,    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    trend_decline:    { label: 'Trend Decline',    icon: <TrendingDown className="w-3 h-3" />,  cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    historical_share: { label: 'Historical Share', icon: <BarChart2 className="w-3 h-3" />,    cls: 'bg-gray-100 text-gray-700 border-gray-200' },
    market_intel:     { label: 'Market Intel',     icon: <Globe className="w-3 h-3" />,         cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    low_data:         { label: 'Low Data',         icon: <Brain className="w-3 h-3" />,         cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  };
  const c = config[driver];
  if (!c) return <span className="text-xs text-gray-500">{driver}</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      {c.icon} {c.label}
    </span>
  );
}

function StockAlertBadge({ alert }: { alert?: string }) {
  if (!alert || alert === 'unknown') return <span className="text-gray-400 text-xs">—</span>;
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 border border-red-200',
    healthy: 'bg-green-100 text-green-700 border border-green-200',
    overstock: 'bg-amber-100 text-amber-700 border border-amber-200',
  };
  const labels: Record<string, string> = {
    critical: '⚠️ Critical',
    healthy: '✓ Healthy',
    overstock: '↑ Overstock',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[alert] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[alert] ?? alert}
    </span>
  );
}

function ConfidenceBadge({ score }: { score?: number }) {
  if (score === undefined || score === null) return <span className="text-gray-400 text-xs">—</span>;
  let colorClass: string;
  let label: string;
  if (score >= 80) {
    colorClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    label = `${score}% High`;
  } else if (score >= 55) {
    colorClass = 'bg-blue-100 text-blue-700 border border-blue-200';
    label = `${score}% Med`;
  } else {
    colorClass = 'bg-orange-100 text-orange-700 border border-orange-200';
    label = `${score}% Low`;
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`} title={`Confidence score: ${score}% — based on historical share consistency for this SKU in the same month across prior years`}>
      {label}
    </span>
  );
}

function ShareBar({ percent }: { percent: number }) {
  const color = percent >= 15 ? "bg-blue-500" : percent >= 8 ? "bg-blue-400" : percent >= 3 ? "bg-blue-300" : "bg-blue-200";
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div
        className={`${color} h-2 rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

async function exportToExcel(result: RecommendResult) {
  try {
    const response = await fetch("/api/export-forecast-split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const monthName = MONTHS.find(m => m.value === result.targetMonth)?.label ?? "Month";
    a.download = `Forecast_Split_${result.country}_${monthName}_${result.targetYear}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Fallback to CSV if Excel export fails
    const monthName = MONTHS.find(m => m.value === result.targetMonth)?.label ?? "";
    const rows = [
      ["SKU", "Weight", "Category", "Packaging", "Mastercases", "Share %", "Confidence", "Trend", "Stock", "Primary Driver", "Reasoning", "Seasonality Note", "Market Intelligence"],
      ...result.recommendations.map(r => [
        r.skuName, r.weight, r.category, r.packagingType ?? 'New',
        r.recommendedMastercases, r.sharePercent.toFixed(1),
        r.confidenceScore !== undefined ? `${r.confidenceScore}%` : 'N/A',
        r.trend, r.stockAlert ?? 'unknown',
        r.primaryDriver ?? 'N/A',
        `"${r.reasoning}"`, `"${r.seasonalityNote}"`,
        `"${r.marketIntelligenceNote ?? ''}"`,
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecast-split-${result.country}-${monthName}-${result.targetYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

async function exportMultiMonthToExcel(multiResult: MultiMonthResult) {
  try {
    const response = await fetch("/api/export-forecast-split-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(multiResult),
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const startLabel = SHORT_MONTHS[multiResult.startMonth - 1];
    a.download = `Forecast_Split_${multiResult.country}_${multiResult.duration}M_from_${startLabel}_${multiResult.startYear}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Multi-month Excel export failed");
  }
}

export default function ForecastSplitPage() {
  const { country } = useCountry();
  const { user: appUser } = useAppAuth();

  const now = new Date();
  const [inputValue, setInputValue] = useState("");
  const [inputUnit, setInputUnit] = useState<"tons" | "mc">("tons");
  const MC_WEIGHT_KG = 6; // Hardcoded mastercase weight
  const [targetMonth, setTargetMonth] = useState(String(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2));
  const [targetYear, setTargetYear] = useState(String(now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear()));
  const [duration, setDuration] = useState<number>(1);
  const [activePreset, setActivePreset] = useState<QuickRangePreset | null>(null);
  const [splitMode, setSplitMode] = useState<"perMonth" | "totalSplit">("perMonth");
  const [includeNpi, setIncludeNpi] = useState(true);
  const [plannerInstructions, setPlannerInstructions] = useState("");

  // Per-SKU adjustment directives — explicit, structured overrides from the UI panel.
  // Keyed by skuId. Empty action means "no change".
  // monthScope: array of month indices (0..N-1) that this adjustment applies to.
  // undefined or empty array means "all months". Single-month forecast always uses "all".
  type SkuAction = "none" | "zero" | "reduce" | "increase" | "cap";
  type SkuAdjustment = { action: SkuAction; valuePct?: string; valueMC?: string; monthScope?: number[] };
  const [skuAdjustments, setSkuAdjustments] = useState<Record<number, SkuAdjustment>>({});
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [adjustSearch, setAdjustSearch] = useState("");
  
  // Single-month result (backward compat)
  const [result, setResult] = useState<RecommendResult | null>(null);
  // Multi-month result
  const [multiResult, setMultiResult] = useState<MultiMonthResult | null>(null);
  
  const [sortBy, setSortBy] = useState<"share" | "name" | "category">("share");
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [showUndoDialog, setShowUndoDialog] = useState(false);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [applied, setApplied] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotEntry[] | null>(null);
  
  // Multi-month generation state
  const [isGeneratingMulti, setIsGeneratingMulti] = useState(false);
  const [multiProgress, setMultiProgress] = useState({ current: 0, total: 0, currentMonthLabel: "" });
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  
  // Multi-month apply state
  const [showMultiApplyDialog, setShowMultiApplyDialog] = useState(false);
  const [multiApplied, setMultiApplied] = useState(false);

  // Upload modified Excel state
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedParsed, setUploadedParsed] = useState<null | {
    type: 'single' | 'multi';
    months: Array<{
      targetMonth: number;
      targetYear: number;
      country: string;
      totalMastercases: number;
      rows: Array<{ skuName: string; weight: string; category: string; recommendedMastercases: number }>;
    }>;
  }>(null);
  const [showUploadApplyDialog, setShowUploadApplyDialog] = useState(false);
  const [isApplyingUpload, setIsApplyingUpload] = useState(false);

  // Bulk apply: which consecutive months are selected (for single-month result)
  const consecutiveOptions = result
    ? getConsecutiveMonths(result.targetMonth, result.targetYear, 6)
    : [];
  const [bulkSelectedMonths, setBulkSelectedMonths] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  // Active SKUs for the per-SKU adjustment panel.
  const { data: activeSkusData } = trpc.country.skus.useQuery(
    { country: (country as "Lebanon" | "Syria" | "Libya" | "KSA"), includeInactive: false },
    { enabled: !!country },
  );
  const activeSkus = (activeSkusData ?? []).filter((s: any) => s.isActive !== false);

  // Build the structured directives array sent to the backend.
  // monthIdx: when defined (multi-month), only include directives whose monthScope is
  // "all" or matches monthIdx. When undefined (single-month), include everything.
  const buildSkuDirectives = useCallback((monthIdx?: number) => {
    const out: Array<{ skuId: number; action: "zero" | "reduce" | "increase" | "cap"; valuePct?: number; valueMC?: number }> = [];
    for (const [idStr, adj] of Object.entries(skuAdjustments)) {
      const id = parseInt(idStr);
      if (!adj || adj.action === "none") continue;
      // Month scope filter (multi-month only). Empty/undefined = all months.
      if (monthIdx !== undefined) {
        const scope = adj.monthScope;
        if (scope && scope.length > 0 && !scope.includes(monthIdx)) continue;
      }
      if (adj.action === "zero") {
        out.push({ skuId: id, action: "zero" });
      } else if (adj.action === "reduce" || adj.action === "increase") {
        const pct = parseFloat(adj.valuePct ?? "");
        if (isFinite(pct) && pct > 0) out.push({ skuId: id, action: adj.action, valuePct: pct });
      } else if (adj.action === "cap") {
        const mc = parseFloat(adj.valueMC ?? "");
        if (isFinite(mc) && mc >= 0) out.push({ skuId: id, action: "cap", valueMC: mc });
      }
    }
    return out;
  }, [skuAdjustments]);

  const applyMutation = trpc.forecastSplit.applyToForecast.useMutation({
    onSuccess: (data) => {
      setShowApplyDialog(false);
      setApplied(true);
      setSnapshot((data.snapshot as SnapshotEntry[]) ?? null);
      toast.success(`Applied to Forecast & IMS — ${data.applied} SKUs updated for ${MONTHS.find(m => m.value === parseInt(targetMonth))?.label} ${targetYear}`);
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err) => {
      toast.error("Failed to apply: " + err.message);
    },
  });

  const undoMutation = trpc.forecastSplit.undoApply.useMutation({
    onSuccess: (data) => {
      setShowUndoDialog(false);
      setApplied(false);
      setSnapshot(null);
      toast.success(`Forecast & IMS reverted — ${data.restored} SKUs restored to previous values`);
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err) => {
      toast.error("Failed to undo: " + err.message);
    },
  });

  const bulkApplyMutation = trpc.forecastSplit.bulkApplyToForecast.useMutation({
    onSuccess: (data) => {
      setShowBulkDialog(false);
      setBulkSelectedMonths(new Set());
      const monthLabels = data.monthResults.map(r => `${MONTHS[r.month - 1].label} ${r.year} (${r.applied} SKUs)`).join(', ');
      toast.success(`Bulk applied to ${data.monthResults.length} months — ${data.totalApplied} total SKU updates (Forecast + IMS): ${monthLabels}`);
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err) => {
      toast.error("Bulk apply failed: " + err.message);
    },
  });

  // Multi-month apply: uses bulkApplyToForecast for each month's unique recommendations
  const multiApplyMutation = trpc.forecastSplit.bulkApplyToForecast.useMutation({
    onSuccess: (data) => {
      setShowMultiApplyDialog(false);
      setMultiApplied(true);
      const monthLabels = data.monthResults.map(r => `${SHORT_MONTHS[r.month - 1]} ${r.year} (${r.applied} SKUs)`).join(', ');
      toast.success(`Applied ${data.monthResults.length} months — ${data.totalApplied} total updates: ${monthLabels}`);
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err) => {
      toast.error("Multi-month apply failed: " + err.message);
    },
  });

  const handleApply = useCallback(() => {
    if (!result || !country) return;
    applyMutation.mutate({
      country,
      targetMonth: result.targetMonth,
      targetYear: result.targetYear,
      mastercaseKg: result.mastercaseKg,
      recommendations: result.recommendations.map(r => ({
        skuName: r.skuName,
        weight: r.weight,
        packagingType: r.packagingType,
        recommendedMastercases: r.recommendedMastercases,
      })),
    });
  }, [result, country, applyMutation, appUser]);

  const handleUndo = useCallback(() => {
    if (!result || !country || !snapshot) return;
    undoMutation.mutate({
      country,
      targetMonth: result.targetMonth,
      targetYear: result.targetYear,
      snapshot: snapshot.map(s => ({
        skuName: s.skuName,
        weight: s.weight,
        packagingType: s.packagingType,
        previousValue: s.previousValue ?? "",
        previousImsValue: s.previousImsValue ?? "0",
      })),
    });
  }, [result, country, snapshot, undoMutation, appUser]);

  const handleBulkApply = useCallback(() => {
    if (!result || !country || bulkSelectedMonths.size === 0) return;
    const months = consecutiveOptions
      .filter(o => bulkSelectedMonths.has(`${o.month}-${o.year}`))
      .map(o => ({ month: o.month, year: o.year }));
    bulkApplyMutation.mutate({
      country,
      months,
      recommendations: result.recommendations.map(r => ({
        skuName: r.skuName,
        weight: r.weight,
        packagingType: r.packagingType,
        recommendedMastercases: r.recommendedMastercases,
        sharePercent: r.sharePercent,
      })),
    });
  }, [result, country, bulkSelectedMonths, consecutiveOptions, bulkApplyMutation]);

  // Multi-month apply: each month gets its own unique recommendations
  // Uses tRPC client directly (not raw fetch) to ensure superjson transformer is applied correctly
  const handleMultiApply = useCallback(() => {
    if (!multiResult || !country) return;
    const applySequentially = async () => {
      let totalApplied = 0;
      for (const mr of multiResult.monthResults) {
        try {
          const data = await utils.client.forecastSplit.applyToForecast.mutate({
            country,
            targetMonth: mr.targetMonth,
            targetYear: mr.targetYear,
            mastercaseKg: mr.mastercaseKg,
            recommendations: mr.recommendations.map(r => ({
              skuName: r.skuName,
              weight: r.weight,
              packagingType: r.packagingType,
              recommendedMastercases: r.recommendedMastercases,
            })),
          });
          totalApplied += data?.applied ?? 0;
        } catch (e: any) {
          console.error(`Failed to apply ${SHORT_MONTHS[mr.targetMonth - 1]} ${mr.targetYear}:`, e);
          toast.error(`Failed to apply ${SHORT_MONTHS[mr.targetMonth - 1]} ${mr.targetYear}: ${e?.message ?? 'Unknown error'}`);
        }
      }
      return totalApplied;
    };
    
    applySequentially().then((total) => {
      setShowMultiApplyDialog(false);
      setMultiApplied(true);
      const labels = multiResult.monthResults.map(mr => `${SHORT_MONTHS[mr.targetMonth - 1]} ${mr.targetYear}`).join(', ');
      toast.success(`Applied ${multiResult.monthResults.length} months to Forecast & IMS (${total} SKU updates): ${labels}`);
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.planningFg.invalidate();
      utils.country.data.invalidate();
    }).catch((err) => {
      toast.error("Multi-month apply failed: " + err);
    });
  }, [multiResult, country, appUser, utils]);

  // Handle Excel file upload: send to /api/upload-forecast-split, parse response
  const handleUploadFile = useCallback(async (file: File) => {
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
      return;
    }
    setIsUploading(true);
    setUploadedParsed(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/upload-forecast-split', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Upload failed');
      }
      const parsed = json.result;
      // Normalise to always have a months array
      const months = parsed.type === 'single'
        ? [parsed.month]
        : parsed.months;
      setUploadedParsed({ type: parsed.type, months });
      toast.success(`Parsed ${months.length} month${months.length > 1 ? 's' : ''} from uploaded file — review and apply below`);
    } catch (err: any) {
      toast.error('Failed to parse Excel: ' + (err?.message ?? 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  }, []);

  // Apply uploaded forecast to IMS
  const handleApplyUploaded = useCallback(async () => {
    if (!uploadedParsed) return;
    setIsApplyingUpload(true);
    let totalApplied = 0;
    let failed = 0;
    for (const m of uploadedParsed.months) {
      try {
        const data = await utils.client.forecastSplit.applyToForecast.mutate({
          country: m.country || country || 'Lebanon',
          targetMonth: m.targetMonth,
          targetYear: m.targetYear,
          mastercaseKg: 6,
          recommendations: m.rows.map(r => ({
            skuName: r.skuName,
            weight: r.weight,
            packagingType: (r as any).packagingType,
            recommendedMastercases: r.recommendedMastercases,
          })),
        });
        totalApplied += data?.applied ?? 0;
      } catch (e: any) {
        failed++;
        toast.error(`Failed to apply ${SHORT_MONTHS[m.targetMonth - 1]} ${m.targetYear}: ${e?.message ?? 'Unknown error'}`);
      }
    }
    setIsApplyingUpload(false);
    setShowUploadApplyDialog(false);
    if (totalApplied > 0) {
      toast.success(`Applied uploaded forecast to IMS — ${totalApplied} SKU updates across ${uploadedParsed.months.length - failed} month${uploadedParsed.months.length > 1 ? 's' : ''}`);
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.planningFg.invalidate();
      utils.country.data.invalidate();
    }
  }, [uploadedParsed, country, appUser, utils]);

  const [analysisStep, setAnalysisStep] = useStateLocal(0);
  const [stepTimer, setStepTimer] = useStateLocal<ReturnType<typeof setInterval> | null>(null);

  const ANALYSIS_STEPS = [
    { icon: <Database className="w-4 h-4" />, label: "Fetching IMS & forecast history", duration: 2500 },
    { icon: <Activity className="w-4 h-4" />, label: "Analysing stock health & weeks cover", duration: 3000 },
    { icon: <Moon className="w-4 h-4" />, label: "Checking Ramadan & seasonal calendar", duration: 2000 },
    { icon: <Search className="w-4 h-4" />, label: "Applying market intelligence & competitive context", duration: 3000 },
    { icon: <Cpu className="w-4 h-4" />, label: "Generating AI-powered recommendations", duration: 0 },
  ];

  const recommendMutation = trpc.forecastSplit.recommend.useMutation({
    onSuccess: (data) => {
      if (stepTimer) clearInterval(stepTimer);
      setStepTimer(null);
      setAnalysisStep(0);
      setResult(data as RecommendResult);
      setMultiResult(null);
      setApplied(false);
      setSnapshot(null);
      setBulkSelectedMonths(new Set());
      setMultiApplied(false);
      toast.success("AI recommendation generated successfully");
    },
    onError: (err) => {
      if (stepTimer) clearInterval(stepTimer);
      setStepTimer(null);
      setAnalysisStep(0);
      toast.error("Failed to generate recommendation: " + err.message);
    },
  });

  // Derived values
  const totalTons = inputUnit === "tons" ? inputValue : String(parseFloat(inputValue || "0") * MC_WEIGHT_KG / 1000);
  const mastercaseKg = String(MC_WEIGHT_KG);

  // Abort controller for multi-month generation
  const abortRef = useRef(false);

  const handleGenerate = useCallback(async () => {
    const rawVal = parseFloat(inputValue);
    if (!rawVal || rawVal <= 0) { toast.error(`Please enter a valid ${inputUnit === 'tons' ? 'tonnage' : 'mastercase quantity'}`); return; }
    const totalInputTons = inputUnit === "tons" ? rawVal : (rawVal * MC_WEIGHT_KG / 1000);
    // For single-month or perMonth mode, every call uses the full input tons.
    // For multi-month "totalSplit", we now redistribute the total across
    // months using per-country seasonality weights instead of dividing
    // equally — see `distributeTonsBySeasonality` for the rationale.
    const tons = totalInputTons;
    const mcKg = MC_WEIGHT_KG;
    const month = parseInt(targetMonth);
    const year = parseInt(targetYear);

    if (!month || !year) { toast.error("Please select a target month and year"); return; }
    if (!country) { toast.error("No country selected"); return; }

    if (duration === 1) {
      // Single month — use existing mutation
      setAnalysisStep(0);
      let step = 0;
      const advance = () => {
        step++;
        if (step < ANALYSIS_STEPS.length) setAnalysisStep(step);
      };
      let accumulated = 0;
      ANALYSIS_STEPS.slice(0, -1).forEach((s) => {
        accumulated += s.duration;
        setTimeout(() => advance(), accumulated);
      });
      const directives = buildSkuDirectives();
      recommendMutation.mutate({
        country,
        totalTons: tons,
        mastercaseKg: mcKg,
        targetMonth: month,
        targetYear: year,
        includeNpi,
        ...(plannerInstructions.trim() ? { plannerInstructions: plannerInstructions.trim() } : {}),
        ...(directives.length > 0 ? { skuDirectives: directives } : {}),
      });
    } else {
      // Multi-month — call recommend endpoint sequentially for each month
      // Each month receives the previous month's recommendations as progressive context
      setIsGeneratingMulti(true);
      setResult(null);
      setMultiResult(null);
      setApplied(false);
      setMultiApplied(false);
      setSnapshot(null);
      abortRef.current = false;

      const monthList = getConsecutiveMonths(month, year, duration);
      // Per-month tonnage allocation:
      //  - perMonth mode  → user's input is what each month gets (constant).
      //  - totalSplit mode → split the total across months weighted by each
      //    month's seasonality multiplier (Ramadan, summer peak, winter dip).
      //    This is how a senior demand planner would budget volume across a
      //    horizon: high months carry more of the total, low months carry less.
      const seasonalPlan = splitMode === 'totalSplit'
        ? distributeTonsBySeasonality(totalInputTons, month, year, duration, country)
        : monthList.map(m => ({ month: m.month, year: m.year, tons: totalInputTons, multiplier: 1 }));
      setMultiProgress({ current: 0, total: duration, currentMonthLabel: monthList[0]?.label ?? "" });

      const results: RecommendResult[] = [];
      let previousMonthContext = "";
      
      for (let i = 0; i < monthList.length; i++) {
        if (abortRef.current) break;
        const m = monthList[i];
        const monthTons = seasonalPlan[i]?.tons ?? tons;
        setMultiProgress({ current: i, total: duration, currentMonthLabel: m.label });
        
        try {
          // Build progressive context from previous month's results
          if (results.length > 0) {
            const prev = results[results.length - 1];
            const prevMonthLabel = SHORT_MONTHS[prev.targetMonth - 1];
            previousMonthContext = prev.recommendations
              .map(r => `${r.skuName} ${r.weight}: ${r.recommendedMastercases} MC (${r.sharePercent.toFixed(1)}%) [${r.trend}] [${r.stockAlert ?? 'unknown'}] Driver: ${r.primaryDriver ?? 'N/A'}`)
              .join('\n');
            previousMonthContext = `Month: ${prevMonthLabel} ${prev.targetYear}\n${previousMonthContext}`;
          }

          // Call via tRPC client (not raw fetch) so superjson transformer is applied correctly.
          // Pass the index `i` so per-month-scoped adjustments are filtered correctly.
          const directives = buildSkuDirectives(i);
          const monthResult = await utils.client.forecastSplit.recommend.mutate({
            country,
            totalTons: monthTons,
            mastercaseKg: mcKg,
            targetMonth: m.month,
            targetYear: m.year,
            includeNpi,
            ...(plannerInstructions.trim() ? { plannerInstructions: plannerInstructions.trim() } : {}),
            ...(directives.length > 0 ? { skuDirectives: directives } : {}),
            ...(previousMonthContext ? {
              previousMonthContext,
              monthPositionInForecast: i + 1,
              totalForecastDuration: duration,
            } : {}),
          });
          if (monthResult) {
            results.push(monthResult as RecommendResult);
          } else {
            throw new Error(`No data returned for ${m.label}`);
          }
        } catch (err: any) {
          toast.error(`Failed to generate for ${m.label}: ${err.message}`);
          // Continue with remaining months
        }
        
        setMultiProgress({ current: i + 1, total: duration, currentMonthLabel: i + 1 < monthList.length ? monthList[i + 1]?.label ?? "" : "Complete" });
      }

      if (results.length > 0) {
        const multiRes: MultiMonthResult = {
          duration,
          startMonth: month,
          startYear: year,
          totalTons: tons,
          mastercaseKg: mcKg,
          country,
          monthResults: results,
        };
        setMultiResult(multiRes);
        // Expand all months by default
        setExpandedMonths(new Set(results.map(r => `${r.targetMonth}-${r.targetYear}`)));
        toast.success(`Generated AI recommendations for ${results.length} month${results.length > 1 ? 's' : ''}`);
      }
      
      setIsGeneratingMulti(false);
    }
  }, [inputValue, inputUnit, targetMonth, targetYear, country, duration, splitMode, includeNpi, recommendMutation, utils]);

  const sortRecs = (recs: Recommendation[]) => {
    return [...recs].sort((a, b) => {
      if (sortBy === "share") return b.sharePercent - a.sharePercent;
      if (sortBy === "name") return a.skuName.localeCompare(b.skuName);
      if (sortBy === "category") return a.category.localeCompare(b.category) || b.sharePercent - a.sharePercent;
      return 0;
    });
  };

  const sortedRecs = result ? sortRecs(result.recommendations) : [];
  const coreRecs = sortedRecs.filter(r => r.category === "Core");
  const npiRecs = sortedRecs.filter(r => r.category !== "Core");

  const toggleBulkMonth = (key: string) => {
    setBulkSelectedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleExpandMonth = (key: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Determine which result to show
  const hasResult = result !== null || multiResult !== null;
  const isLoading = recommendMutation.isPending || isGeneratingMulti;

  const RecTable = ({ recs, accentColor }: { recs: Recommendation[]; accentColor: string }) => (
    <div className="rounded-xl border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm min-w-[1200px]">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Mastercases</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Share</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Confidence</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Trend</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Stock</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Driver</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600 max-w-xs">Reasoning</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600 max-w-xs">Seasonality</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600 max-w-xs">Market Intel</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {recs.map((rec, i) => (
            <tr key={i} className={`hover:bg-gray-50/50 transition-colors ${rec.stockAlert === 'critical' ? 'bg-red-50/40' : rec.stockAlert === 'overstock' ? 'bg-amber-50/40' : ''}`}>
              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                <div>{rec.skuName} <span className="text-gray-400 font-normal">{rec.weight}</span></div>
                {rec.packagingType && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium mt-0.5 ${
                    rec.packagingType === 'Old' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'
                  }`}>
                    {rec.packagingType === 'Old' ? '📦 Old Pkg' : '🆕 New Pkg'}
                  </span>
                )}
              </td>
              <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${accentColor}`}>
                {rec.recommendedMastercases.toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <div className="text-xs text-gray-500 mb-0.5">{rec.sharePercent.toFixed(1)}%</div>
                <ShareBar percent={rec.sharePercent} />
              </td>
              <td className="px-4 py-3"><ConfidenceBadge score={rec.confidenceScore} /></td>
              <td className="px-4 py-3"><TrendBadge trend={rec.trend} /></td>
              <td className="px-4 py-3"><StockAlertBadge alert={rec.stockAlert} /></td>
              <td className="px-4 py-3"><PrimaryDriverBadge driver={rec.primaryDriver} /></td>
              <td className="px-4 py-3 text-gray-600 text-xs max-w-xs">{rec.reasoning}</td>
              <td className="px-4 py-3 text-gray-500 text-xs max-w-xs italic">{rec.seasonalityNote || "—"}</td>
              <td className="px-4 py-3 text-indigo-600 text-xs max-w-xs">{rec.marketIntelligenceNote || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  /** Render a single month's result section (used for both single and multi-month) */
  const MonthResultSection = ({ mr, isCollapsible, isExpanded, onToggle }: { mr: RecommendResult; isCollapsible: boolean; isExpanded: boolean; onToggle?: () => void }) => {
    const sorted = sortRecs(mr.recommendations);
    const core = sorted.filter(r => r.category === "Core");
    const npi = sorted.filter(r => r.category !== "Core");
    const totalAssigned = mr.recommendations.reduce((s, r) => s + r.recommendedMastercases, 0);
    const monthLabel = MONTHS.find(m => m.value === mr.targetMonth)?.label ?? "";

    return (
      <div className="space-y-4">
        {/* Month header */}
        {isCollapsible && (
          <button
            onClick={onToggle}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5 text-blue-600" />}
            <Calendar className="w-4 h-4 text-blue-600" />
            <span className="text-base font-bold text-blue-900">{monthLabel} {mr.targetYear}</span>
            <span className="text-sm text-blue-600 ml-2">{totalAssigned.toLocaleString()} MC</span>
            <span className="text-xs text-blue-500 ml-1">({mr.totalTons} tons)</span>
            {mr.isRamadanMonth && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                <Moon className="w-3 h-3" /> Ramadan
              </span>
            )}
            <span className="ml-auto text-xs text-gray-500">{mr.recommendations.length} SKUs</span>
          </button>
        )}

        {(!isCollapsible || isExpanded) && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-blue-600 text-white">
                <CardContent className="py-3">
                  <p className="text-blue-200 text-xs uppercase tracking-wide">Total MC</p>
                  <p className="text-xl font-bold mt-0.5">{mr.totalMastercases.toLocaleString()}</p>
                  <p className="text-blue-200 text-xs">{mr.totalTons} tons</p>
                </CardContent>
              </Card>
              <Card className={mr.totalMastercases - totalAssigned === 0 ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}>
                <CardContent className="py-3">
                  <p className="text-xs uppercase tracking-wide font-medium" style={{color: mr.totalMastercases - totalAssigned === 0 ? '#065f46' : '#92400e'}}>Allocation</p>
                  <p className="text-xl font-bold mt-0.5" style={{color: mr.totalMastercases - totalAssigned === 0 ? '#065f46' : '#92400e'}}>
                    {mr.totalMastercases - totalAssigned === 0 ? '✓ 100%' : `${totalAssigned.toLocaleString()} / ${mr.totalMastercases.toLocaleString()}`}
                  </p>
                  <p className="text-xs mt-0.5" style={{color: mr.totalMastercases - totalAssigned === 0 ? '#059669' : '#b45309'}}>
                    {mr.totalMastercases - totalAssigned === 0 ? 'Fully allocated' : `${mr.totalMastercases - totalAssigned > 0 ? '+' : ''}${mr.totalMastercases - totalAssigned} MC gap`}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Period</p>
                  <p className="text-xl font-bold mt-0.5">{monthLabel}</p>
                  <p className="text-xs text-muted-foreground">{mr.targetYear} · {mr.country}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">SKUs</p>
                  <p className="text-xl font-bold mt-0.5">{mr.recommendations.length}</p>
                  <p className="text-xs text-muted-foreground">{mr.recommendations.filter(r => r.recommendedMastercases > 0).length} with allocation</p>
                </CardContent>
              </Card>
            </div>

            {/* Ramadan Banner */}
            {mr.isRamadanMonth && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-purple-300 bg-gradient-to-r from-purple-50 to-indigo-50">
                <Moon className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-purple-900">Ramadan Month — +{mr.ramadanBoostPct}% Demand Uplift</p>
                  <p className="text-xs text-purple-700 mt-0.5">Night socializing, extended café hours, and gifting culture drive significant demand spikes.</p>
                </div>
              </div>
            )}

            {/* AI Insight */}
            <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardContent className="py-3">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-blue-900 mb-0.5">AI Analysis</p>
                    <p className="text-xs text-blue-800 leading-relaxed">{mr.overallInsight}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Warnings */}
            {mr.warnings.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="py-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-amber-900 mb-0.5">Warnings</p>
                      <ul className="space-y-0.5">
                        {mr.warnings.map((w, i) => (
                          <li key={i} className="text-xs text-amber-800">• {w}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tables */}
            {core.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Core SKUs</h3>
                <RecTable recs={core} accentColor="text-blue-700" />
              </div>
            )}
            {npi.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">NPI SKUs</h3>
                <RecTable recs={npi} accentColor="text-indigo-700" />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            Recommended Forecast SKU Split
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Senior data analyst engine — analyses IMS trends, stock health, Ramadan/seasonal calendar, competitive landscape, and Al Fakher market intelligence to recommend the optimal per-SKU mastercase split.
          </p>
        </div>
        {hasResult && !isLoading && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {/* Excel Export */}
            {result && (
              <Button variant="outline" size="sm" onClick={() => { exportToExcel(result); toast.success("Downloading Excel file..."); }} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Export Excel
              </Button>
            )}
            {multiResult && (
              <Button variant="outline" size="sm" onClick={() => { exportMultiMonthToExcel(multiResult); toast.success("Downloading multi-month Excel file..."); }} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Export Excel ({multiResult.duration}M)
              </Button>
            )}

            {/* Single-month actions */}
            {result && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setBulkSelectedMonths(new Set()); setShowBulkDialog(true); }}
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                >
                  <Layers className="w-4 h-4 mr-1.5" /> Apply to Multiple Months
                </Button>
                {applied ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Applied
                    </span>
                    {snapshot && snapshot.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setShowUndoDialog(true)} className="border-amber-300 text-amber-700 hover:bg-amber-50">
                        <Undo2 className="w-4 h-4 mr-1.5" /> Undo
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setShowApplyDialog(true)} disabled={applyMutation.isPending}>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Apply to Forecast
                  </Button>
                )}
              </>
            )}

            {/* Multi-month actions */}
            {multiResult && (
              <>
                {multiApplied ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                    <CheckCircle2 className="w-4 h-4" /> All {multiResult.monthResults.length} Months Applied
                  </span>
                ) : (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setShowMultiApplyDialog(true)}>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Apply All {multiResult.monthResults.length} Months
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Input Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-1.5">
              <Label>{inputUnit === 'tons' ? 'Monthly Desired Forecast (Tons)' : 'Monthly Desired Forecast (MC)'}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  step={inputUnit === 'tons' ? '0.5' : '1'}
                  placeholder={inputUnit === 'tons' ? 'e.g. 180' : 'e.g. 30000'}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Input Unit</Label>
              <div className="flex rounded-lg border overflow-hidden h-9" style={{ minWidth: '200px' }}>
                <button
                  type="button"
                  onClick={() => { setInputUnit('tons'); setInputValue(''); }}
                  className={`flex-1 text-sm font-medium transition-colors px-4 whitespace-nowrap ${inputUnit === 'tons' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Tons
                </button>
                <button
                  type="button"
                  onClick={() => { setInputUnit('mc'); setInputValue(''); }}
                  className={`flex-1 text-sm font-medium transition-colors px-4 whitespace-nowrap ${inputUnit === 'mc' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Master Cases
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Starting Month</Label>
              <Select value={targetMonth} onValueChange={setTargetMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map(m => (
                    <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select value={targetYear} onValueChange={setTargetYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {[2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <div className="flex rounded-lg border overflow-hidden h-9">
                {([1, 3, 6, 12] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDuration(d); setActivePreset(null); }}
                    className={`flex-1 text-sm font-medium transition-colors px-2 ${duration === d && activePreset === null ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {d}M
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick range presets — calendar-driven durations */}
          <div className="mt-3 p-3 bg-blue-50/60 rounded-lg border border-blue-100">
            <Label className="text-xs font-semibold text-blue-900 block mb-2">
              Quick range — start next month, end on a calendar boundary
            </Label>
            <div className="flex flex-wrap gap-2">
              {(['restOfYear', 'plusQ1', 'plusQ2', 'plusQ3', 'plusQ4'] as const).map(p => {
                const r = computeQuickRange(p);
                const startLabel = `${SHORT_MONTHS[r.startMonth - 1]} ${r.startYear}`;
                const endLabel = `${SHORT_MONTHS[r.endMonth - 1]} ${r.endYear}`;
                const isActive = activePreset === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setTargetMonth(String(r.startMonth));
                      setTargetYear(String(r.startYear));
                      setDuration(r.duration);
                      setActivePreset(p);
                    }}
                    className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-blue-800 border-blue-200 hover:bg-blue-100'
                    }`}
                    title={`${startLabel} → ${endLabel} · ${r.duration} months`}
                  >
                    <span className="font-semibold">{QUICK_RANGE_LABELS[p]}</span>
                    <span className={`ml-1.5 ${isActive ? 'text-blue-100' : 'text-blue-500'}`}>
                      {startLabel} → {endLabel} · {r.duration}M
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-blue-700/80 mt-1.5">
              "Rest of year" runs from next month to December. The "+ Qn" options extend through quarter n of next year (Q1 = Mar, Q2 = Jun, Q3 = Sep, Q4 = Dec).
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Label className="text-sm font-medium">Include NPI (New Products)</Label>
            <div className="flex rounded-lg border overflow-hidden h-9" style={{ minWidth: '160px' }}>
              <button
                type="button"
                onClick={() => setIncludeNpi(true)}
                className={`flex-1 text-sm font-medium transition-colors px-4 whitespace-nowrap ${includeNpi ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setIncludeNpi(false)}
                className={`flex-1 text-sm font-medium transition-colors px-4 whitespace-nowrap ${!includeNpi ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Core Only
              </button>
            </div>
            {!includeNpi && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                NPI SKUs excluded — forecast will be split across Core SKUs only
              </span>
            )}
          </div>

          {/* Duration preview */}
          {duration > 1 && (
            <div className="mt-3 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-800 border border-indigo-100">
              <Clock className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <strong>{duration}-month forecast</strong> starting {MONTHS[parseInt(targetMonth) - 1]?.label} {targetYear}
              {" → "}
              {(() => {
                const months = getConsecutiveMonths(parseInt(targetMonth), parseInt(targetYear), duration);
                const last = months[months.length - 1];
                return `${MONTHS[last.month - 1]?.label} ${last.year}`;
              })()}
              <span className="text-indigo-600 ml-2">(AI will generate unique per-month recommendations accounting for seasonality)</span>
            </div>
          )}

          {/* Split-mode chooser (only when multi-month) */}
          {duration > 1 && (
            <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <Label className="text-sm font-semibold text-amber-900 block mb-2">
                Is your input <strong>per month</strong> or the <strong>total</strong> to split across {duration} months?
              </Label>
              <div className="inline-flex rounded-lg border border-amber-300 overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => setSplitMode("perMonth")}
                  className={`text-sm font-medium transition-colors px-4 py-2 whitespace-nowrap ${splitMode === 'perMonth' ? 'bg-amber-600 text-white' : 'text-gray-700 hover:bg-amber-50'}`}
                >
                  Per Month
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode("totalSplit")}
                  className={`text-sm font-medium transition-colors px-4 py-2 whitespace-nowrap border-l border-amber-300 ${splitMode === 'totalSplit' ? 'bg-amber-600 text-white' : 'text-gray-700 hover:bg-amber-50'}`}
                >
                  Total (split across {duration} months)
                </button>
              </div>
              <p className="text-xs text-amber-700 mt-1.5">
                {splitMode === 'perMonth'
                  ? `Each of the ${duration} months will receive the full amount you entered.`
                  : `Your total will be split across ${duration} months weighted by seasonality — Ramadan, summer, and winter months get more/less of the total instead of an equal share.`}
              </p>
            </div>
          )}

          {/* Per-SKU adjustment panel — explicit, structured overrides */}
          {activeSkus.length > 0 && (() => {
            const directiveCount = Object.values(skuAdjustments).filter(a => a && a.action !== "none").length;
            const filtered = activeSkus.filter((sk: any) => {
              if (!adjustSearch.trim()) return true;
              const q = adjustSearch.trim().toLowerCase();
              return `${sk.name} ${sk.weight} ${sk.packagingType ?? ''}`.toLowerCase().includes(q);
            });
            return (
              <div className="mt-3 border border-purple-200 rounded-lg bg-gradient-to-br from-purple-50 to-indigo-50">
                <button
                  type="button"
                  onClick={() => setShowAdjustPanel(!showAdjustPanel)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-purple-100/50 rounded-t-lg transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {showAdjustPanel ? <ChevronDown className="w-4 h-4 text-purple-700" /> : <ChevronRight className="w-4 h-4 text-purple-700" />}
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <span className="text-sm font-semibold text-purple-900">Per-SKU adjustments</span>
                    {directiveCount > 0 && (
                      <Badge className="bg-purple-600 text-white text-xs">{directiveCount} active</Badge>
                    )}
                  </div>
                  <span className="text-xs text-purple-700">{showAdjustPanel ? "Hide" : "Show"} ({activeSkus.length} SKUs)</span>
                </button>
                {showAdjustPanel && (
                  <div className="px-3 pb-3 border-t border-purple-200">
                    <p className="text-xs text-purple-700 mt-2 mb-2">
                      Pick an action and value for any SKU. These are applied <strong>exactly</strong> to the recommendation, then the rest of the SKUs are rebalanced so the total stays correct.
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <Input
                        placeholder="Search SKUs…"
                        value={adjustSearch}
                        onChange={(e) => setAdjustSearch(e.target.value)}
                        className="h-8 text-sm"
                      />
                      {directiveCount > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-purple-700 hover:text-purple-900 hover:bg-purple-100"
                          onClick={() => setSkuAdjustments({})}
                        >
                          <X className="w-3 h-3 mr-1" /> Clear all
                        </Button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto bg-white rounded border border-purple-100">
                      {filtered.length === 0 && (
                        <div className="text-xs text-muted-foreground text-center py-4">No SKUs match "{adjustSearch}"</div>
                      )}
                      {filtered.map((sku: any) => {
                        const adj = skuAdjustments[sku.id] ?? { action: "none" as SkuAction };
                        const isPctAction = adj.action === "reduce" || adj.action === "increase";
                        const isCapAction = adj.action === "cap";
                        const setAdj = (next: typeof adj) => setSkuAdjustments(prev => {
                          const copy = { ...prev };
                          if (next.action === "none") delete copy[sku.id];
                          else copy[sku.id] = next;
                          return copy;
                        });
                        const rowBg = adj.action === "none" ? "" : adj.action === "zero" ? "bg-red-50" : adj.action === "reduce" ? "bg-orange-50" : adj.action === "increase" ? "bg-emerald-50" : "bg-blue-50";
                        return (
                          <div key={sku.id} className={`flex items-center gap-2 px-2 py-1.5 border-b border-purple-50 last:border-0 ${rowBg}`}>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{sku.name} <span className="text-muted-foreground font-normal">{sku.weight}</span></div>
                              <div className="flex items-center gap-1 mt-0.5">
                                {sku.packagingType && (
                                  <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${sku.packagingType === 'Old' ? 'border-amber-300 text-amber-800 bg-amber-50' : 'border-slate-300 text-slate-700 bg-slate-50'}`}>
                                    {sku.packagingType} Pkg
                                  </Badge>
                                )}
                                {(sku.category ?? 'Core') === 'NPI' && (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-blue-300 text-blue-700 bg-blue-50">NPI</Badge>
                                )}
                              </div>
                            </div>
                            <Select
                              value={adj.action}
                              onValueChange={(v) => setAdj({ action: v as SkuAction, valuePct: adj.valuePct, valueMC: adj.valueMC, monthScope: adj.monthScope })}
                            >
                              <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No change</SelectItem>
                                <SelectItem value="increase">▲ Increase by %</SelectItem>
                                <SelectItem value="reduce">▼ Reduce by %</SelectItem>
                                <SelectItem value="zero">⨯ Set to zero</SelectItem>
                                <SelectItem value="cap">⊓ Cap at MC</SelectItem>
                              </SelectContent>
                            </Select>
                            {isPctAction && (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  max={500}
                                  step={1}
                                  value={adj.valuePct ?? ""}
                                  onChange={(e) => setAdj({ ...adj, valuePct: e.target.value })}
                                  placeholder={adj.action === "increase" ? "25" : "20"}
                                  className="h-8 w-16 text-xs text-right"
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                              </div>
                            )}
                            {isCapAction && (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  step={10}
                                  value={adj.valueMC ?? ""}
                                  onChange={(e) => setAdj({ ...adj, valueMC: e.target.value })}
                                  placeholder="500"
                                  className="h-8 w-20 text-xs text-right"
                                />
                                <span className="text-xs text-muted-foreground">MC</span>
                              </div>
                            )}
                            {duration > 1 && adj.action !== "none" && (() => {
                              const monthList = getConsecutiveMonths(parseInt(targetMonth), parseInt(targetYear), duration);
                              // Always re-clamp the stored indices to the current month window. If the
                              // user shrinks the duration after selecting months, stale indices would
                              // otherwise crash the label render or display incorrect counts.
                              const rawScope = adj.monthScope ?? [];
                              const scope = rawScope.filter(i => i >= 0 && i < monthList.length);
                              const isAll = scope.length === 0 || scope.length === monthList.length;
                              let labelText: string;
                              if (isAll) {
                                labelText = `📅 All ${monthList.length} months`;
                              } else if (scope.length === 1) {
                                const m = monthList[scope[0]];
                                labelText = m
                                  ? `Only ${SHORT_MONTHS[m.month - 1]} ${String(m.year).slice(-2)}`
                                  : `${scope.length} months selected`;
                              } else {
                                labelText = `${scope.length} months selected`;
                              }
                              const toggleMonth = (idx: number, checked: boolean) => {
                                const next = new Set(scope);
                                if (checked) next.add(idx); else next.delete(idx);
                                const arr = Array.from(next).sort((a, b) => a - b);
                                setAdj({ ...adj, monthScope: arr.length === monthList.length ? [] : arr });
                              };
                              return (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 text-xs border-purple-300 justify-between gap-1 min-w-[140px]"
                                    >
                                      <span className="truncate">{labelText}</span>
                                      <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-56 p-2" align="end">
                                    <div className="flex items-center justify-between mb-2 pb-2 border-b">
                                      <span className="text-xs font-semibold text-muted-foreground">Apply to months</span>
                                      <button
                                        type="button"
                                        className="text-[10px] text-purple-600 hover:underline"
                                        onClick={() => setAdj({ ...adj, monthScope: [] })}
                                      >
                                        Select all
                                      </button>
                                    </div>
                                    <div className="space-y-1 max-h-[280px] overflow-y-auto">
                                      {monthList.map((m, idx) => {
                                        const checked = isAll || scope.includes(idx);
                                        return (
                                          <label
                                            key={idx}
                                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer"
                                          >
                                            <Checkbox
                                              checked={checked}
                                              onCheckedChange={(c) => toggleMonth(idx, !!c)}
                                            />
                                            <span className="text-xs">
                                              {SHORT_MONTHS[m.month - 1]} {m.year}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Planner instructions for the AI */}
          <div className="mt-3">
            <Label htmlFor="planner-instructions" className="text-sm font-medium">
              Additional instructions for the AI <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
              Free-text guidance the AI must follow. Example: "Reduce Mint 250g by 20%", "Boost Double Apple", "Skip Watermelon this month", "Prioritize new SKUs", "Cap Blueberry at 1000 MC".
            </p>
            <Textarea
              id="planner-instructions"
              value={plannerInstructions}
              onChange={(e) => setPlannerInstructions(e.target.value)}
              placeholder="e.g. Reduce Mint 250g share by 20%. Increase Double Apple. Don't allocate to Lemon Mint this month."
              rows={3}
              className="resize-y"
              maxLength={1500}
            />
            {plannerInstructions.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1 text-right">{plannerInstructions.length}/1500</div>
            )}
          </div>

          {/* Summary preview */}
          {inputValue && parseFloat(inputValue) > 0 && (() => {
            const totalInputTons = inputUnit === 'tons' ? parseFloat(inputValue) : (parseFloat(inputValue) * MC_WEIGHT_KG / 1000);
            const isSplit = duration > 1 && splitMode === 'totalSplit';
            const startM = parseInt(targetMonth);
            const startY = parseInt(targetYear);
            const seasonalPreview = (isSplit && startM && startY && country)
              ? distributeTonsBySeasonality(totalInputTons, startM, startY, duration, country)
              : null;
            const mcPerMonthFlat = Math.floor((totalInputTons * 1000 / MC_WEIGHT_KG));
            return (
              <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800 border border-blue-100">
                {duration > 1 ? (
                  isSplit && seasonalPreview ? (
                    <>
                      <strong>{totalInputTons.toLocaleString()} tons total</strong> split seasonally across <strong>{duration} months</strong> for {country}:
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5 text-xs">
                        {seasonalPreview.map((p, idx) => {
                          const mc = Math.round(p.tons * 1000 / MC_WEIGHT_KG);
                          const isHigh = p.multiplier > 1.05;
                          const isLow = p.multiplier < 0.95;
                          const label = `${SHORT_MONTHS[p.month - 1]} ${p.year}`;
                          const cls = isHigh ? 'bg-purple-100 border-purple-300 text-purple-800'
                            : isLow ? 'bg-slate-100 border-slate-300 text-slate-700'
                            : 'bg-white border-blue-200 text-blue-800';
                          return (
                            <div key={idx} className={`px-2 py-1 rounded border ${cls}`}>
                              <div className="font-semibold">{label}</div>
                              <div>{p.tons.toFixed(1)}t · {mc.toLocaleString()} MC</div>
                              <div className="text-[10px] opacity-75">×{p.multiplier.toFixed(2)}</div>
                            </div>
                          );
                        })}
                      </div>
                      <span className="block mt-2 text-blue-600">Weights: Ramadan +35-40%, summer (Jun-Aug) +17-22%, winter (Dec-Feb) -7-12% — per country. The AI then splits each month's volume across SKUs using stock health, trend, and history.</span>
                    </>
                  ) : (
                    <>
                      <strong>{totalInputTons.toLocaleString()} tons per month</strong> × <strong>{duration} months</strong> = <strong>{(totalInputTons * duration).toLocaleString()} tons total</strong> ({mcPerMonthFlat.toLocaleString()} MC/month).
                    </>
                  )
                ) : (
                  <>
                    <strong>{totalInputTons.toLocaleString()} tons</strong> ÷ <strong>{MC_WEIGHT_KG} kg/MC</strong> = <strong>{mcPerMonthFlat.toLocaleString()} master cases</strong> to allocate across {country} SKUs.
                  </>
                )}
              </div>
            );
          })()}

          <Button
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleGenerate}
            disabled={isLoading}
          >
            {isLoading ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Running deep analysis…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate AI Recommendation{duration > 1 ? ` (${duration} Months)` : ''}</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Loading state — single month multi-step progress */}
      {recommendMutation.isPending && (
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/60">
          <CardContent className="py-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <p className="text-blue-800 font-semibold text-sm">Senior Data Analyst Engine Running</p>
                <p className="text-blue-500 text-xs">This may take 10–30 seconds</p>
              </div>
            </div>
            <div className="space-y-3">
              {ANALYSIS_STEPS.map((s, i) => {
                const isDone = i < analysisStep;
                const isActive = i === analysisStep;
                return (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-500 ${
                    isDone ? 'bg-emerald-50 border border-emerald-200' :
                    isActive ? 'bg-blue-100 border border-blue-300 shadow-sm' :
                    'bg-white/50 border border-gray-100 opacity-40'
                  }`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isDone ? 'bg-emerald-500 text-white' :
                      isActive ? 'bg-blue-600 text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isDone ? <CheckCircle2 className="w-4 h-4" /> : isActive ? <RefreshCw className="w-4 h-4 animate-spin" /> : s.icon}
                    </div>
                    <span className={`text-sm ${
                      isDone ? 'text-emerald-700 font-medium line-through decoration-emerald-400' :
                      isActive ? 'text-blue-800 font-semibold' :
                      'text-gray-400'
                    }`}>{s.label}</span>
                    {isActive && <span className="ml-auto text-xs text-blue-500 animate-pulse">processing…</span>}
                    {isDone && <span className="ml-auto text-xs text-emerald-600">✓ done</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-5">
              <div className="flex justify-between text-xs text-blue-500 mb-1">
                <span>Progress</span>
                <span>{Math.round((analysisStep / (ANALYSIS_STEPS.length - 1)) * 100)}%</span>
              </div>
              <div className="w-full bg-blue-100 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-700"
                  style={{ width: `${Math.round((analysisStep / (ANALYSIS_STEPS.length - 1)) * 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state — multi-month progress */}
      {isGeneratingMulti && (
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/60">
          <CardContent className="py-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <p className="text-blue-800 font-semibold text-sm">Generating {duration}-Month Forecast</p>
                <p className="text-blue-500 text-xs">Running AI analysis for each month individually for accurate seasonality</p>
              </div>
            </div>
            
            {/* Per-month progress */}
            <div className="space-y-2 mb-4">
              {getConsecutiveMonths(parseInt(targetMonth), parseInt(targetYear), duration).map((m, i) => {
                const key = `${m.month}-${m.year}`;
                const isDone = i < multiProgress.current;
                const isActive = i === multiProgress.current;
                return (
                  <div key={key} className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-300 ${
                    isDone ? 'bg-emerald-50 border border-emerald-200' :
                    isActive ? 'bg-blue-100 border border-blue-300 shadow-sm' :
                    'bg-white/50 border border-gray-100 opacity-40'
                  }`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isDone ? 'bg-emerald-500 text-white' :
                      isActive ? 'bg-blue-600 text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isDone ? <CheckCircle2 className="w-4 h-4" /> : isActive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
                    </div>
                    <span className={`text-sm ${
                      isDone ? 'text-emerald-700 font-medium' :
                      isActive ? 'text-blue-800 font-semibold' :
                      'text-gray-400'
                    }`}>{m.label}</span>
                    {isActive && <span className="ml-auto text-xs text-blue-500 animate-pulse">analysing…</span>}
                    {isDone && <span className="ml-auto text-xs text-emerald-600">✓ done</span>}
                  </div>
                );
              })}
            </div>

            {/* Overall progress bar */}
            <div className="flex justify-between text-xs text-blue-500 mb-1">
              <span>Month {multiProgress.current} of {multiProgress.total}</span>
              <span>{Math.round((multiProgress.current / multiProgress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((multiProgress.current / multiProgress.total) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Single-month Results */}
      {result && !isLoading && (
        <>
          {/* Seasonality Index */}
          {result.marketSeasonalityIndex !== undefined && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-gray-50 text-sm">
              <BarChart2 className="w-4 h-4 text-gray-500 shrink-0" />
              <span className="text-gray-600">
                Market seasonality index for {MONTHS.find(m => m.value === result.targetMonth)?.label}:
                <strong className={`ml-1 ${result.marketSeasonalityIndex > 1.1 ? 'text-emerald-700' : result.marketSeasonalityIndex < 0.9 ? 'text-red-600' : 'text-gray-800'}`}>
                  {result.marketSeasonalityIndex.toFixed(2)}
                </strong>
                <span className="text-gray-400 ml-1">(1.0 = average month{result.marketSeasonalityIndex > 1.1 ? ' — above average demand' : result.marketSeasonalityIndex < 0.9 ? ' — below average demand' : ' — normal demand'})</span>
              </span>
            </div>
          )}

          {/* Market Summary */}
          {result.marketSummary && (
            <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Globe className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-indigo-900 mb-1">{result.country} Market Intelligence</p>
                    <p className="text-sm text-indigo-800 leading-relaxed">{result.marketSummary}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sort control */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Sort by:</span>
            {(["share", "name", "category"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`text-sm px-3 py-1 rounded-full border transition-colors ${sortBy === s ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}
              >
                {s === "share" ? "Share %" : s === "name" ? "SKU Name" : "Category"}
              </button>
            ))}
          </div>

          <MonthResultSection mr={result} isCollapsible={false} isExpanded={true} />
        </>
      )}

      {/* Multi-month Results */}
      {multiResult && !isLoading && (
        <>
          {/* Multi-month summary banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
              <CardContent className="py-4">
                <p className="text-blue-200 text-xs uppercase tracking-wide">Duration</p>
                <p className="text-2xl font-bold mt-1">{multiResult.duration} Months</p>
                <p className="text-blue-200 text-xs mt-0.5">
                  {SHORT_MONTHS[multiResult.startMonth - 1]} {multiResult.startYear} → {(() => {
                    const last = multiResult.monthResults[multiResult.monthResults.length - 1];
                    return `${SHORT_MONTHS[last.targetMonth - 1]} ${last.targetYear}`;
                  })()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Per Month</p>
                <p className="text-2xl font-bold mt-1">{multiResult.monthResults[0]?.totalMastercases.toLocaleString()} MC</p>
                <p className="text-xs text-muted-foreground mt-0.5">{multiResult.totalTons} tons × {multiResult.duration} months</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Total Volume</p>
                <p className="text-2xl font-bold mt-1">{(multiResult.monthResults.reduce((s, r) => s + r.totalMastercases, 0)).toLocaleString()} MC</p>
                <p className="text-xs text-muted-foreground mt-0.5">{(multiResult.totalTons * multiResult.duration).toFixed(1)} tons total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Country</p>
                <p className="text-2xl font-bold mt-1">{multiResult.country}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{multiResult.monthResults.length} months generated</p>
              </CardContent>
            </Card>
          </div>

          {/* Expand/Collapse All */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Sort by:</span>
              {(["share", "name", "category"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`text-sm px-3 py-1 rounded-full border transition-colors ${sortBy === s ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}
                >
                  {s === "share" ? "Share %" : s === "name" ? "SKU Name" : "Category"}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (expandedMonths.size === multiResult.monthResults.length) {
                  setExpandedMonths(new Set());
                } else {
                  setExpandedMonths(new Set(multiResult.monthResults.map(r => `${r.targetMonth}-${r.targetYear}`)));
                }
              }}
            >
              {expandedMonths.size === multiResult.monthResults.length ? "Collapse All" : "Expand All"}
            </Button>
          </div>

          {/* Per-month sections */}
          <div className="space-y-4">
            {multiResult.monthResults.map((mr) => {
              const key = `${mr.targetMonth}-${mr.targetYear}`;
              return (
                <MonthResultSection
                  key={key}
                  mr={mr}
                  isCollapsible={true}
                  isExpanded={expandedMonths.has(key)}
                  onToggle={() => toggleExpandMonth(key)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* Confidence legend */}
      {hasResult && !isLoading && (
        <div className="flex items-center gap-4 text-xs text-gray-500 px-1 flex-wrap">
          <span className="font-medium text-gray-600">Confidence:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">≥80% High</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">55–79% Medium</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">&lt;55% Low</span>
          <span className="font-medium text-gray-600 ml-2">Driver:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200"><Moon className="w-3 h-3" /> Ramadan</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200"><AlertTriangle className="w-3 h-3" /> Stock Critical</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200"><Globe className="w-3 h-3" /> Market Intel</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* UPLOAD MODIFIED EXCEL SECTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="border-2 border-dashed border-blue-200 rounded-xl p-6 bg-blue-50/40">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <FileUp className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-800 text-sm">Apply Uploaded Modified Forecast to IMS</h3>
            <p className="text-xs text-gray-500 mt-0.5">Export the forecast above, modify mastercase quantities in Excel, then upload the file here to apply your changes directly to Forecast &amp; IMS.</p>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <input
                ref={uploadInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ''; }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isUploading}
                onClick={() => uploadInputRef.current?.click()}
                className="border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                {isUploading ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Parsing...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Upload Modified Excel</>
                )}
              </Button>
              {uploadedParsed && (
                <>
                  <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {uploadedParsed.months.length} month{uploadedParsed.months.length > 1 ? 's' : ''} parsed
                    {' '}({uploadedParsed.months.reduce((s, m) => s + m.totalMastercases, 0).toLocaleString()} MC total)
                  </span>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => setShowUploadApplyDialog(true)}
                  >
                    <ArrowRight className="w-4 h-4 mr-1.5" /> Apply to IMS
                  </Button>
                  <button
                    className="text-gray-400 hover:text-gray-600 ml-1"
                    onClick={() => setUploadedParsed(null)}
                    title="Clear uploaded file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            {uploadedParsed && (
              <div className="mt-3 border border-blue-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-blue-100 text-blue-800">
                      <th className="text-left px-3 py-2 font-semibold">Month</th>
                      <th className="text-left px-3 py-2 font-semibold">Country</th>
                      <th className="text-right px-3 py-2 font-semibold">SKUs</th>
                      <th className="text-right px-3 py-2 font-semibold">Total MC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100">
                    {uploadedParsed.months.map((m, i) => (
                      <tr key={i} className="bg-white hover:bg-blue-50/50">
                        <td className="px-3 py-2 font-medium text-gray-700">{SHORT_MONTHS[m.targetMonth - 1]} {m.targetYear}</td>
                        <td className="px-3 py-2 text-gray-600">{m.country}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{m.rows.length}</td>
                        <td className="px-3 py-2 text-right font-bold text-blue-700">{m.totalMastercases.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DIALOGS */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* Apply Confirmation Dialog (single month) */}
      {result && (
        <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Apply to Official Forecast
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                This will overwrite the Forecast values for <strong>{MONTHS.find(m => m.value === result.targetMonth)?.label} {result.targetYear}</strong> in <strong>{result.country}</strong> with the AI-recommended mastercase quantities.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y text-sm">
              {result.recommendations.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2">
                  <span className="text-gray-700 flex items-center gap-2">
                    {r.skuName}
                    <span className="text-gray-400">{r.weight}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${(r.packagingType ?? 'New') === 'Old' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                      {(r.packagingType ?? 'New') === 'Old' ? 'Old Pkg' : 'New Pkg'}
                    </span>
                  </span>
                  <span className="font-bold text-blue-700 shrink-0">{r.recommendedMastercases.toLocaleString()} MC</span>
                </div>
              ))}
            </div>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              Existing forecast values for this month will be replaced. Previous values are saved so you can Undo immediately after.
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowApplyDialog(false)} disabled={applyMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApply}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Confirm & Apply</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Bulk Apply Dialog (single month → multiple months) */}
      {result && (
        <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-600" />
                Apply to Multiple Months
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                Apply the same SKU split ({result.recommendations.length} SKUs, {result.totalMastercases.toLocaleString()} mastercases) to additional consecutive months. Select the months you want to update.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1">
              {consecutiveOptions.map(opt => {
                const key = `${opt.month}-${opt.year}`;
                const isBase = opt.month === result.targetMonth && opt.year === result.targetYear;
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${isBase ? 'bg-blue-50 border-blue-200 cursor-default' : bulkSelectedMonths.has(key) ? 'bg-indigo-50 border-indigo-300' : 'border-gray-200 hover:border-indigo-200 hover:bg-gray-50'}`}
                  >
                    <Checkbox
                      checked={isBase || bulkSelectedMonths.has(key)}
                      disabled={isBase}
                      onCheckedChange={() => !isBase && toggleBulkMonth(key)}
                    />
                    <span className={`text-sm font-medium ${isBase ? 'text-blue-700' : 'text-gray-800'}`}>
                      {opt.label}
                      {isBase && <span className="ml-2 text-xs text-blue-500 font-normal">(base month)</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
              <Layers className="w-3.5 h-3.5 inline mr-1" />
              The same mastercase quantities will be written to each selected month. This is useful for pre-planning a full quarter with the same split.
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowBulkDialog(false)} disabled={bulkApplyMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={handleBulkApply}
                disabled={bulkApplyMutation.isPending || bulkSelectedMonths.size === 0}
              >
                {bulkApplyMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
                ) : (
                  <><Layers className="w-4 h-4 mr-2" /> Apply to {bulkSelectedMonths.size} Month{bulkSelectedMonths.size !== 1 ? 's' : ''}</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Undo Confirmation Dialog (single month) */}
      {result && snapshot && (
        <Dialog open={showUndoDialog} onOpenChange={setShowUndoDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Undo2 className="w-5 h-5 text-amber-600" />
                Undo Applied Forecast
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                This will revert the Forecast for <strong>{MONTHS.find(m => m.value === result.targetMonth)?.label} {result.targetYear}</strong> in <strong>{result.country}</strong> back to the values that existed before the AI recommendation was applied.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-56 overflow-y-auto border rounded-lg divide-y text-sm">
              {snapshot.map((s, i) => {
                const pkg = result.recommendations.find(r => r.skuName === s.skuName && r.weight === s.weight)?.packagingType ?? 'New';
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <span className="text-gray-700 flex items-center gap-2">
                      {s.skuName}
                      <span className="text-gray-400">{s.weight}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${pkg === 'Old' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                        {pkg === 'Old' ? 'Old Pkg' : 'New Pkg'}
                      </span>
                    </span>
                    <span className="text-amber-700 font-medium shrink-0">
                      {s.previousValue ? `${s.previousValue} MC` : <span className="text-gray-400 italic">empty</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              The current AI-recommended values will be replaced with the previous values shown above.
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowUndoDialog(false)} disabled={undoMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleUndo}
                disabled={undoMutation.isPending}
              >
                {undoMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Reverting…</>
                ) : (
                  <><Undo2 className="w-4 h-4 mr-2" /> Confirm Undo</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Multi-month Apply All Dialog */}
      {multiResult && (
        <Dialog open={showMultiApplyDialog} onOpenChange={setShowMultiApplyDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Apply All {multiResult.monthResults.length} Months to Forecast
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                This will write the AI-recommended mastercase quantities to both Forecast and IMS for each month below. Each month has unique per-SKU allocations based on its seasonality analysis.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y text-sm">
              {multiResult.monthResults.map((mr, i) => {
                const totalAssigned = mr.recommendations.reduce((s, r) => s + r.recommendedMastercases, 0);
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-gray-700 font-medium flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-blue-500" />
                      {MONTHS[mr.targetMonth - 1]?.label} {mr.targetYear}
                      {mr.isRamadanMonth && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 border border-purple-200">
                          Ramadan
                        </span>
                      )}
                    </span>
                    <span className="font-bold text-blue-700 shrink-0">{totalAssigned.toLocaleString()} MC</span>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              Existing forecast and IMS values for all {multiResult.monthResults.length} months will be replaced. This action cannot be undone in bulk — save a version snapshot first if needed.
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowMultiApplyDialog(false)}>
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={handleMultiApply}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Apply All {multiResult.monthResults.length} Months
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Upload Apply Confirmation Dialog */}
      {uploadedParsed && (
        <Dialog open={showUploadApplyDialog} onOpenChange={setShowUploadApplyDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-blue-600" />
                Apply Uploaded Modified Forecast to IMS
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                The following months from your uploaded Excel file will be written to Forecast &amp; IMS. Existing values will be overwritten.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y text-sm">
              {uploadedParsed.months.map((m, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-gray-700 font-medium flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                    {SHORT_MONTHS[m.targetMonth - 1]} {m.targetYear}
                    <span className="text-gray-400 text-xs">({m.country})</span>
                  </span>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-blue-700">{m.totalMastercases.toLocaleString()} MC</span>
                    <span className="text-gray-400 text-xs ml-2">{m.rows.length} SKUs</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              Existing forecast and IMS values for the listed months will be replaced with the values from your uploaded file.
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowUploadApplyDialog(false)} disabled={isApplyingUpload}>
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApplyUploaded}
                disabled={isApplyingUpload}
              >
                {isApplyingUpload ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Applying...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Apply {uploadedParsed.months.length} Month{uploadedParsed.months.length > 1 ? 's' : ''} to IMS</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
