import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, Crown, Target, BarChart3, PieChart, Download, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
import { useAppAuth } from "@/contexts/AuthContext";
import { useUnit } from "@/contexts/UnitContext";

const BRAND_COLORS: Record<string, string> = {
  "Al Fakher": "#2563eb",
  "Mazaya": "#dc2626",
  "Nakhla": "#16a34a",
  "Others": "#9333ea",
  "Al Ostoura": "#f59e0b",
  "Al Fakhama": "#ec4899",
  "Frisky": "#06b6d4",
  "Khalil Maamoun": "#84cc16",
  "Al Basha": "#f97316",
  "Gold Dahab": "#eab308",
  "Mawal": "#14b8a6",
  "H Hooka": "#8b5cf6",
  "True Passion": "#ef4444",
  "Malke": "#a855f7",
};

const BRAND_YEARLY: Record<string, Record<number, number>> = {
  "Al Fakher": { 2022: 153839, 2023: 157483, 2024: 157349, 2025: 196990, 2026: 55415 },
  "Mazaya": { 2022: 229627, 2023: 188352, 2024: 224669, 2025: 300968, 2026: 84770 },
  "Nakhla": { 2022: 142411, 2023: 208098, 2024: 226105, 2025: 268628, 2026: 107415 },
  "Others": { 2022: 54255, 2023: 15489, 2024: 24958, 2025: 40776, 2026: 15145 },
};

const BRAND_MONTHLY: Record<string, Record<number, number[]>> = {
  "Al Fakher": {
    2022: [3167, 8275, 25322, 6738, 15562, 10186, 13723, 11114, 12553, 8237, 17052, 21910],
    2023: [7838, 8056, 11517, 11788, 11098, 7417, 18465, 16261, 21857, 17279, 12209, 13698],
    2024: [11471, 13550, 11283, 8056, 10171, 15808, 18022, 13534, 10188, 21931, 11789, 11546],
    2025: [14784, 10218, 21235, 22196, 1554, 10767, 14935, 17847, 23853, 24612, 23101, 11888],
    2026: [21751, 12477, 21187, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  "Mazaya": {
    2022: [14686, 20115, 17290, 19336, 22667, 22621, 26991, 37505, 26541, 6296, 8115, 7464],
    2023: [7587, 2809, 14256, 16710, 14485, 10904, 15866, 22133, 26295, 23780, 21309, 12218],
    2024: [13979, 16247, 11755, 16646, 17597, 21641, 32187, 27747, 21005, 21859, 15474, 8532],
    2025: [23723, 21545, 19765, 24907, 23695, 22001, 34080, 28975, 31782, 31782, 15744, 22969],
    2026: [38552, 22380, 23838, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  "Nakhla": {
    2022: [3373, 13442, 23325, 7907, 0, 6156, 20960, 27286, 14738, 11468, 10735, 3021],
    2023: [35127, 12055, 26878, 14687, 16711, 9819, 20684, 14070, 8655, 19160, 22175, 8077],
    2024: [31319, 24844, 18212, 12762, 19578, 20911, 31384, 23715, 14954, 16677, 7632, 4117],
    2025: [46585, 17017, 18897, 28293, 26491, 17064, 26029, 24662, 20865, 14704, 16556, 11465],
    2026: [59330, 22688, 25397, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  "Others": {
    2022: [4354, 9828, 1881, 2379, 7000, 5897, 5148, 9444, 5141, 585, 1426, 1172],
    2023: [774, 7910, 1114, 524, 337, 1033, 285, 0, 709, 1325, 480, 998],
    2024: [2084, 308, 1132, 389, 290, 616, 1941, 2925, 1287, 3102, 1589, 9295],
    2025: [662, 3191, 2586, 4193, 2907, 5505, 3050, 3055, 3353, 4596, 885, 6793],
    2026: [4523, 4132, 6490, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

const FLAVOR_DATA: Record<string, Record<string, Record<number, number>>> = {
  "Al Fakher": {
    "Two Apple": { 2020: 9624, 2021: 90212, 2022: 120230, 2023: 124885, 2024: 128963, 2025: 159291, 2026: 49308 },
    "Grapes": { 2020: 1893, 2021: 7923, 2022: 9113, 2023: 8384, 2024: 7284, 2025: 12307, 2026: 1820 },
    "Lemon Mint": { 2020: 2715, 2021: 5188, 2022: 8503, 2023: 7483, 2024: 6570, 2025: 8231, 2026: 1601 },
    "Mint": { 2020: 1599, 2021: 7177, 2022: 7068, 2023: 5633, 2024: 4948, 2025: 8541, 2026: 1007 },
    "Grape Mint": { 2020: 797, 2021: 5416, 2022: 0, 2023: 8349, 2024: 4677, 2025: 6488, 2026: 1215 },
    "Gum": { 2020: 213, 2021: 1767, 2022: 1974, 2023: 991, 2024: 543, 2025: 990, 2026: 276 },
    "Other Flavors": { 2020: 530, 2021: 2784, 2022: 3077, 2023: 1758, 2024: 4364, 2025: 1142, 2026: 188 },
  },
  "Mazaya": {
    "Two Apple": { 2020: 5857, 2021: 82459, 2022: 90732, 2023: 58134, 2024: 117337, 2025: 84203, 2026: 25073 },
    "Lemon Mint": { 2020: 40528, 2021: 119214, 2022: 90100, 2023: 92428, 2024: 70252, 2025: 176984, 2026: 48854 },
    "Gum": { 2020: 1478, 2021: 15419, 2022: 17168, 2023: 8450, 2024: 12592, 2025: 11027, 2026: 3708 },
    "Mint": { 2020: 1484, 2021: 8471, 2022: 6680, 2023: 5724, 2024: 6639, 2025: 7184, 2026: 1680 },
    "Grapes": { 2020: 864, 2021: 4353, 2022: 5289, 2023: 4243, 2024: 4202, 2025: 5592, 2026: 837 },
    "Grape Mint": { 2020: 1045, 2021: 4835, 2022: 0, 2023: 4614, 2024: 5165, 2025: 5942, 2026: 1052 },
    "Other Flavors": { 2020: 1548, 2021: 7442, 2022: 14119, 2023: 14759, 2024: 8482, 2025: 10036, 2026: 3566 },
  },
  "Nakhla": {
    "Two Apple": { 2020: 148654, 2021: 152000, 2022: 140289, 2023: 207312, 2024: 224025, 2025: 265905, 2026: 107415 },
    "Lemon Mint": { 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 966, 2025: 2723, 2026: 0 },
    "Grapes": { 2020: 115, 2021: 39, 2022: 366, 2023: 20, 2024: 251, 2025: 0, 2026: 0 },
    "Other Flavors": { 2020: 839, 2021: 1110, 2022: 1732, 2023: 766, 2024: 863, 2025: 0, 2026: 0 },
  },
};

const OTHER_BRANDS_FLAVOR: Record<string, Record<string, Record<number, number>>> = {
  "Al Ostoura": {
    "Two Apple": { 2020: 971, 2021: 3435, 2022: 2402, 2023: 1067, 2024: 533, 2025: 2857, 2026: 0 },
    "Lemon Mint": { 2020: 462, 2021: 604, 2022: 287, 2023: 121, 2024: 45, 2025: 260, 2026: 0 },
    "Other": { 2020: 276, 2021: 641, 2022: 18, 2023: 2, 2024: 1, 2025: 8372, 2026: 4446 },
  },
  "Khalil Maamoun": {
    "Two Apple": { 2020: 3756, 2021: 40533, 2022: 37768, 2023: 2242, 2024: 9136, 2025: 16275, 2026: 3460 },
    "Lemon Mint": { 2020: 297, 2021: 288, 2022: 627, 2023: 162, 2024: 0, 2025: 0, 2026: 0 },
    "Other": { 2020: 111, 2021: 1673, 2022: 921, 2023: 486, 2024: 0, 2025: 0, 2026: 0 },
  },
  "Al Basha": {
    "Two Apple": { 2020: 0, 2021: 0, 2022: 1584, 2023: 3233, 2024: 2799, 2025: 4705, 2026: 2070 },
    "Lemon Mint": { 2020: 0, 2021: 0, 2022: 0, 2023: 1189, 2024: 1168, 2025: 1166, 2026: 404 },
  },
  "Gold Dahab": {
    "Two Apple": { 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 1653, 2025: 5895, 2026: 2843 },
  },
  "Mawal": {
    "Two Apple": { 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 4448, 2025: 5593, 2026: 1401 },
    "Lemon Mint": { 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 1144, 2025: 775, 2026: 225 },
    "Other": { 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 451, 2025: 1239, 2026: 260 },
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS = [2022, 2023, 2024, 2025, 2026];
const MAIN_BRANDS = ["Al Fakher", "Mazaya", "Nakhla", "Others"];

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtFull(n: number): string {
  return n.toLocaleString();
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return (n / total * 100).toFixed(1) + "%";
}

function yoyGrowth(curr: number, prev: number): { value: number; label: string } {
  if (prev === 0) return { value: 0, label: "N/A" };
  const g = ((curr - prev) / prev) * 100;
  return { value: g, label: (g > 0 ? "+" : "") + g.toFixed(1) + "%" };
}

function GrowthBadge({ current, previous }: { current: number; previous: number }) {
  const { value, label } = yoyGrowth(current, previous);
  if (label === "N/A") return <Badge variant="secondary" className="text-xs">N/A</Badge>;
  const isPositive = value > 0;
  const isNeutral = Math.abs(value) < 1;
  return (
    <Badge
      variant="secondary"
      className={`text-xs gap-0.5 ${isNeutral ? "text-gray-500" : isPositive ? "text-green-600" : "text-red-600"}`}
    >
      {isNeutral ? <Minus className="w-3 h-3" /> : isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {label}
    </Badge>
  );
}

function KpiCard({ title, value, subtitle, color, icon }: { title: string; value: string; subtitle?: string; color: string; icon?: React.ReactNode }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: color }} />
      <CardContent className="p-4 pl-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          {icon && <span style={{ color }} className="opacity-60">{icon}</span>}
        </div>
        <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function StackedBar({ segments, height = 24, labels, formatVal: fv, unitLabel: ul }: { segments: { value: number; color: string; label: string }[]; height?: number; labels?: boolean; formatVal?: (v: number, d?: number) => string; unitLabel?: string }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div className="h-6 bg-muted rounded" />;
  const valFmt = fv ?? fmtFull;
  const uLbl = ul ?? "";
  return (
    <div className="w-full">
      <div className="flex rounded overflow-hidden" style={{ height }}>
        {segments.map((seg, i) => {
          const w = (seg.value / total) * 100;
          if (w < 0.5) return null;
          return (
            <div
              key={i}
              className="relative group transition-all"
              style={{ width: `${w}%`, backgroundColor: seg.color }}
              title={`${seg.label}: ${valFmt(seg.value)} ${uLbl} (${pct(seg.value, total)})`}
            >
              {w > 8 && labels && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow">
                  {w.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniSparkline({ data, color, width = 120, height = 32 }: { data: number[]; color: string; width?: number; height?: number }) {
  const filtered = data.filter(v => v > 0);
  if (filtered.length === 0) return null;
  const max = Math.max(...filtered);
  const min = Math.min(...filtered);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  );
}

function BarChart({ items, maxValue }: { items: { label: string; value: number; color: string; sublabel?: string }[]; maxValue: number }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="min-w-[130px] text-xs font-medium truncate" title={item.label}>{item.label}</div>
          <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
            <div
              className="h-full rounded transition-all duration-500"
              style={{
                width: `${maxValue > 0 ? Math.min((item.value / maxValue) * 100, 100) : 0}%`,
                backgroundColor: item.color,
              }}
            />
            <span className="absolute right-2 top-0 h-full flex items-center text-[10px] font-semibold text-foreground">
              {fmtFull(item.value)}
            </span>
          </div>
          {item.sublabel && <span className="text-xs text-muted-foreground min-w-[45px] text-right">{item.sublabel}</span>}
        </div>
      ))}
    </div>
  );
}

function TwoAppleComparison({ flavorData, formatVal, unitLabel }: { flavorData: Record<string, Record<string, Record<number, number>>>; formatVal: (v: number, d?: number) => string; unitLabel: string }) {
  const twoAppleData = useMemo(() => {
    const data: Record<string, Record<number, number>> = {};
    const allSources = { ...OTHER_BRANDS_FLAVOR, ...flavorData };
    for (const [brand, flavors] of Object.entries(allSources)) {
      if (flavors["Two Apple"]) data[brand] = flavors["Two Apple"];
    }
    return data;
  }, [flavorData]);
  const taBrands = Object.keys(twoAppleData).sort((a, b) => {
    const aVol = Math.max(...Object.values(twoAppleData[a] ?? {}));
    const bVol = Math.max(...Object.values(twoAppleData[b] ?? {}));
    return bVol - aVol;
  });
  const allYears = Array.from(new Set(taBrands.flatMap(b => Object.keys(twoAppleData[b] ?? {}).map(Number)))).sort();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500" />
          Two Apple Battle (#1 Flavor)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium">Brand</th>
                {allYears.map(y => <th key={y} className="text-right py-2 font-medium px-2">{y}</th>)}
                <th className="text-right py-2 font-medium px-2">Trend</th>
              </tr>
            </thead>
            <tbody>
              {taBrands.map(b => (
                <tr key={b} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="py-2 font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                    {b}
                  </td>
                  {allYears.map(y => (
                    <td key={y} className="text-right py-2 px-2 tabular-nums">{formatVal(twoAppleData[b]?.[y] ?? 0)}</td>
                  ))}
                  <td className="py-2 px-2">
                    <MiniSparkline data={allYears.map(y => twoAppleData[b]?.[y] ?? 0)} color={BRAND_COLORS[b] ?? "#9ca3af"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompetitorAnalysisPage() {
  const { country } = useCountry();
  const { user } = useAppAuth();
  const { formatVal, unitLabel, convertVal } = useUnit();
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [comparisonYear, setComparisonYear] = useState<number>(2024);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: dbData, refetch } = trpc.country.competitorData.useQuery(
    { country: country ?? "Lebanon" },
    { staleTime: 60_000 }
  );

  const isLebanon = (country ?? "Lebanon") === "Lebanon";

  const activeBrandMonthly = useMemo<Record<string, Record<number, number[]>>>(() => {
    if (dbData?.brandMonthly) return dbData.brandMonthly as any;
    return isLebanon ? BRAND_MONTHLY : {};
  }, [dbData, isLebanon]);

  const activeBrandYearly = useMemo<Record<string, Record<number, number>>>(() => {
    const bm = activeBrandMonthly;
    const result: Record<string, Record<number, number>> = {};
    for (const [brand, years] of Object.entries(bm)) {
      result[brand] = {};
      for (const [y, months] of Object.entries(years)) {
        result[brand][Number(y)] = (months as number[]).reduce((s, v) => s + v, 0);
      }
    }
    return result;
  }, [activeBrandMonthly]);

  const activeFlavorData = useMemo<Record<string, Record<string, Record<number, number>>>>(() => {
    if (dbData?.flavorYearly) return dbData.flavorYearly as any;
    return isLebanon ? FLAVOR_DATA : {};
  }, [dbData, isLebanon]);

  const activeYears = useMemo(() => {
    const yearSet = new Set<number>();
    for (const years of Object.values(activeBrandYearly)) {
      for (const y of Object.keys(years)) yearSet.add(Number(y));
    }
    const sorted = Array.from(yearSet).sort((a, b) => a - b);
    return sorted.length > 0 ? sorted : YEARS;
  }, [activeBrandYearly]);

  const activeMainBrands = useMemo(() => {
    return Object.keys(activeBrandYearly);
  }, [activeBrandYearly]);

  const handleSelectedYearChange = (y: number) => {
    setSelectedYear(y);
    if (comparisonYear === y) {
      const fallback = activeYears.filter(v => v !== y);
      setComparisonYear(fallback.length > 0 ? fallback[fallback.length - 1] : y);
    }
  };

  const handleComparisonYearChange = (y: number) => {
    setComparisonYear(y);
    if (selectedYear === y) {
      const fallback = activeYears.filter(v => v !== y);
      setSelectedYear(fallback.length > 0 ? fallback[fallback.length - 1] : y);
    }
  };

  const handleDownloadTemplate = () => {
    const c = country ?? "Lebanon";
    window.open(`/api/export-competitor-template?country=${encodeURIComponent(c)}`, "_blank");
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const c = country ?? "Lebanon";
      const u = user?.username ?? "unknown";
      const res = await fetch(`/api/import-competitor?country=${encodeURIComponent(c)}&username=${encodeURIComponent(u)}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      toast.success(`Competitor data uploaded: ${json.brands} brands, ${json.flavors} flavor entries`);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload competitor data");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const totals = useMemo(() => {
    const result: Record<number, number> = {};
    for (const y of activeYears) {
      result[y] = Object.values(activeBrandYearly).reduce((s, bv) => s + (bv[y] ?? 0), 0);
    }
    return result;
  }, [activeBrandYearly, activeYears]);

  const totalMarket = totals[selectedYear] ?? 0;
  const prevTotal = totals[comparisonYear] ?? 0;
  const afVolume = activeBrandYearly["Al Fakher"]?.[selectedYear] ?? 0;
  const afPrevVolume = activeBrandYearly["Al Fakher"]?.[comparisonYear] ?? 0;
  const nakhlaVolume = activeBrandYearly["Nakhla"]?.[selectedYear] ?? 0;
  const mazayaVolume = activeBrandYearly["Mazaya"]?.[selectedYear] ?? 0;

  const marketLeader = useMemo(() => {
    const brands = Object.entries(activeBrandYearly)
      .map(([name, years]) => ({ name, vol: years[selectedYear] ?? 0 }))
      .sort((a, b) => b.vol - a.vol);
    return brands[0]?.name ?? "N/A";
  }, [activeBrandYearly, selectedYear]);

  const maxYear = Math.max(...activeYears);
  const is2026 = selectedYear === maxYear && selectedYear >= 2026;

  const monthlyActiveCount = useMemo(() => {
    if (!activeBrandMonthly["Al Fakher"]?.[selectedYear]) return 12;
    return activeBrandMonthly["Al Fakher"][selectedYear].filter(v => v > 0).length;
  }, [selectedYear, activeBrandMonthly]);

  const dataSource = dbData?.uploadedAt
    ? `Last updated by ${dbData.uploadedBy ?? "unknown"} on ${new Date(dbData.uploadedAt).toLocaleDateString()}`
    : isLebanon ? "Regie Official Data (Default)" : "No data uploaded yet";

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Competitor Analysis</h1>
          <p className="text-sm text-muted-foreground">
            {country ?? "Lebanon"} Market — {dataSource} ({unitLabel})
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadTemplate}>
            <Download className="w-3.5 h-3.5" />
            Template
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
          <div className="h-5 w-px bg-border mx-1" />
          <Select value={selectedYear.toString()} onValueChange={v => handleSelectedYearChange(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeYears.map(y => <SelectItem key={y} value={y.toString()}>{y}{y === maxYear && y >= 2026 ? " (YTD)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">vs</span>
          <Select value={comparisonYear.toString()} onValueChange={v => handleComparisonYearChange(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeYears.filter(y => y !== selectedYear).map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {dbData?.uploadedAt && (
        <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-800 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Using uploaded competitor data. Download template to view/edit, then re-upload.
        </div>
      )}

      {is2026 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800">
          2026 data is Year-to-Date (Jan–Mar). Volumes are not annualized — compare with care.
        </div>
      )}

      {!isLebanon && !dbData?.uploadedAt && activeMainBrands.length === 0 && (
        <Card className="p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-10 h-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No competitor data for {country}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Download the template, fill in competitor brand and flavor data for {country}, then upload it to see the analysis.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadTemplate}>
                <Download className="w-3.5 h-3.5" />
                Download Template
              </Button>
              <Button variant="default" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" />
                Upload Data
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeMainBrands.length > 0 && <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="Total Market"
          value={formatVal(totalMarket) + " " + unitLabel}
          subtitle={`vs ${formatVal(prevTotal)} in ${comparisonYear}`}
          color="#64748b"
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <KpiCard
          title="Al Fakher Share"
          value={pct(afVolume, totalMarket)}
          subtitle={`${formatVal(afVolume)} ${unitLabel} — Rank #${afVolume >= nakhlaVolume && afVolume >= mazayaVolume ? 1 : afVolume >= Math.min(nakhlaVolume, mazayaVolume) ? 2 : 3}`}
          color={BRAND_COLORS["Al Fakher"]}
          icon={<Target className="w-4 h-4" />}
        />
        <KpiCard
          title="Market Leader"
          value={marketLeader}
          subtitle={`${formatVal(activeBrandYearly[marketLeader]?.[selectedYear] ?? 0)} ${unitLabel}`}
          color={BRAND_COLORS[marketLeader]}
          icon={<Crown className="w-4 h-4" />}
        />
        <KpiCard
          title="Al Fakher YoY"
          value={yoyGrowth(afVolume, afPrevVolume).label}
          subtitle={`${formatVal(afPrevVolume)} → ${formatVal(afVolume)}`}
          color={yoyGrowth(afVolume, afPrevVolume).value >= 0 ? "#16a34a" : "#dc2626"}
          icon={<PieChart className="w-4 h-4" />}
        />
      </div>

      <Tabs defaultValue="market-share" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="market-share">Market Share</TabsTrigger>
          <TabsTrigger value="monthly-trends">Monthly Trends</TabsTrigger>
          <TabsTrigger value="flavor-battle">Flavor Breakdown</TabsTrigger>
          <TabsTrigger value="two-apple">Two Apple Deep Dive</TabsTrigger>
          <TabsTrigger value="emerging">Emerging Brands</TabsTrigger>
        </TabsList>

        <TabsContent value="market-share" className="space-y-4">
          <MarketShareTab selectedYear={selectedYear} comparisonYear={comparisonYear} totals={totals} brandYearly={activeBrandYearly} brands={activeMainBrands} years={activeYears} formatVal={formatVal} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="monthly-trends" className="space-y-4">
          <MonthlyTrendsTab selectedYear={selectedYear} monthlyActiveCount={monthlyActiveCount} brandMonthly={activeBrandMonthly} brands={activeMainBrands} formatVal={formatVal} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="flavor-battle" className="space-y-4">
          <FlavorBreakdownTab selectedYear={selectedYear} flavorData={activeFlavorData} formatVal={formatVal} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="two-apple" className="space-y-4">
          <TwoAppleComparison flavorData={activeFlavorData} formatVal={formatVal} unitLabel={unitLabel} />
          <TwoAppleMarketShareTab flavorData={activeFlavorData} formatVal={formatVal} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="emerging" className="space-y-4">
          <EmergingBrandsTab selectedYear={selectedYear} flavorData={activeFlavorData} formatVal={formatVal} unitLabel={unitLabel} />
        </TabsContent>
      </Tabs>
      </>}
    </div>
  );
}

function MarketShareTab({ selectedYear, comparisonYear, totals, brandYearly, brands, years, formatVal, unitLabel }: { selectedYear: number; comparisonYear: number; totals: Record<number, number>; brandYearly: Record<string, Record<number, number>>; brands: string[]; years: number[]; formatVal: (v: number, d?: number) => string; unitLabel: string }) {
  const insights = useMemo(() => {
    const ranked = brands
      .filter(b => b !== "Others")
      .map(b => ({ name: b, vol: brandYearly[b]?.[selectedYear] ?? 0 }))
      .sort((a, b) => b.vol - a.vol);
    const leader = ranked[0];
    if (!leader) return [];
    const growths = ranked.map(b => ({
      name: b.name,
      growth: brandYearly[b.name]?.[comparisonYear]
        ? ((b.vol - (brandYearly[b.name]?.[comparisonYear] ?? 0)) / (brandYearly[b.name]?.[comparisonYear] ?? 1)) * 100
        : 0,
    })).sort((a, b) => b.growth - a.growth);
    const fastestGrower = growths[0];
    const afRank = ranked.findIndex(b => b.name === "Al Fakher") + 1;
    return [
      `${leader.name} leads the market in ${selectedYear} with ${formatVal(leader.vol)} ${unitLabel}`,
      fastestGrower ? `${fastestGrower.name} has the highest YoY growth at ${fastestGrower.growth > 0 ? "+" : ""}${fastestGrower.growth.toFixed(1)}% vs ${comparisonYear}` : "",
      afRank > 0 ? `Al Fakher ranks #${afRank} by volume` : "",
      `Total market: ${formatVal(totals[selectedYear])} ${unitLabel} in ${selectedYear} (${yoyGrowth(totals[selectedYear], totals[comparisonYear]).label} vs ${comparisonYear})`,
    ].filter(Boolean);
  }, [selectedYear, comparisonYear, totals, brandYearly, brands, formatVal, unitLabel]);

  const maxYear = Math.max(...years);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Market Share by Year</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {years.map(y => {
              const total = totals[y] ?? 1;
              const segments = brands.map(b => ({
                value: brandYearly[b]?.[y] ?? 0,
                color: BRAND_COLORS[b] ?? "#9ca3af",
                label: b,
              }));
              return (
                <div key={y}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold ${y === selectedYear ? "text-foreground" : "text-muted-foreground"}`}>
                      {y}{y === maxYear && y >= 2026 ? " (YTD)" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatVal(total)} {unitLabel}</span>
                  </div>
                  <StackedBar segments={segments} height={y === selectedYear ? 28 : 20} labels={y === selectedYear} formatVal={formatVal} unitLabel={unitLabel} />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t">
            {brands.map(b => (
              <div key={b} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                {b}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Brand Volume — {selectedYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {brands.map(b => {
              const vol = brandYearly[b]?.[selectedYear] ?? 0;
              const prevVol = brandYearly[b]?.[comparisonYear] ?? 0;
              const total = totals[selectedYear] ?? 1;
              const share = (vol / total * 100).toFixed(1);
              return (
                <div key={b} className="flex items-center gap-3">
                  <div className="min-w-[80px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] }} />
                      <span className="text-xs font-semibold">{b}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground ml-3.5">{share}% share</span>
                  </div>
                  <div className="flex-1">
                    <div className="h-7 bg-muted rounded overflow-hidden relative">
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${(vol / (totals[selectedYear] ?? 1)) * 100}%`,
                          backgroundColor: BRAND_COLORS[b],
                          opacity: 0.85,
                        }}
                      />
                      <span className="absolute right-2 top-0 h-full flex items-center text-[10px] font-bold">
                        {formatVal(vol)} {unitLabel}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-[60px] text-right">
                    <GrowthBadge current={vol} previous={prevVol} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">Key Insights</h4>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              {insights.map((ins, i) => <li key={i}>{ins}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MonthlyTrendsTab({ selectedYear, monthlyActiveCount, brandMonthly, brands, formatVal, unitLabel }: { selectedYear: number; monthlyActiveCount: number; brandMonthly: Record<string, Record<number, number[]>>; brands: string[]; formatVal: (v: number, d?: number) => string; unitLabel: string }) {
  const monthData = useMemo(() => {
    return MONTHS.map((m, i) => {
      const row: Record<string, any> = { month: m };
      for (const b of brands) {
        row[b] = brandMonthly[b]?.[selectedYear]?.[i] ?? 0;
      }
      return row;
    });
  }, [selectedYear, brandMonthly, brands]);

  const maxMonthly = useMemo(() => {
    return Math.max(...monthData.map(d => Math.max(...brands.map(b => (d[b] as number) ?? 0))));
  }, [monthData, brands]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Monthly Volume by Brand — {selectedYear}{monthlyActiveCount < 12 ? ` (${monthlyActiveCount} months)` : ""}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium w-16">Month</th>
                {brands.map(b => (
                  <th key={b} className="text-right py-2 font-medium px-2">
                    <span className="flex items-center justify-end gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                      {b}
                    </span>
                  </th>
                ))}
                <th className="text-right py-2 font-medium px-2">Total</th>
                <th className="text-right py-2 font-medium px-2">AF Share</th>
              </tr>
            </thead>
            <tbody>
              {monthData.map((d, i) => {
                const total = brands.reduce((s, b) => s + ((d[b] as number) ?? 0), 0);
                if (total === 0) return null;
                const afVal = (d["Al Fakher"] as number) ?? 0;
                const afShare = total > 0 ? ((afVal / total) * 100).toFixed(1) : "0";
                return (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 font-medium">{d.month}</td>
                    {brands.map(b => (
                      <td key={b} className="text-right py-2 px-2 tabular-nums">{formatVal((d[b] as number) ?? 0)}</td>
                    ))}
                    <td className="text-right py-2 px-2 tabular-nums font-semibold">{formatVal(total)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{afShare}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-3 border-t">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Visual Trend</h4>
          <div className="space-y-3">
            {brands.map(b => (
              <div key={b} className="flex items-center gap-3">
                <div className="min-w-[80px] text-xs font-medium flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                  {b}
                </div>
                <div className="flex-1 flex items-end gap-[2px]" style={{ height: 40 }}>
                  {(brandMonthly[b]?.[selectedYear] ?? []).map((v, i) => {
                    if (v === 0 && i >= monthlyActiveCount) return <div key={i} className="flex-1" />;
                    const h = maxMonthly > 0 ? (v / maxMonthly) * 36 + 2 : 2;
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-t transition-all"
                        style={{ height: h, backgroundColor: BRAND_COLORS[b] ?? "#9ca3af", opacity: 0.8 }}
                        title={`${MONTHS[i]}: ${formatVal(v)} ${unitLabel}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FlavorBreakdownTab({ selectedYear, flavorData, formatVal, unitLabel }: { selectedYear: number; flavorData: Record<string, Record<string, Record<number, number>>>; formatVal: (v: number, d?: number) => string; unitLabel: string }) {
  const FLAVOR_COLORS: Record<string, string> = {
    "Two Apple": "#dc2626",
    "Lemon Mint": "#16a34a",
    "Grapes": "#7c3aed",
    "Grape Mint": "#0891b2",
    "Mint": "#059669",
    "Gum": "#d97706",
    "Other Flavors": "#6b7280",
    "Other": "#6b7280",
  };

  const flavorBrands = Object.keys(flavorData).filter(b => b !== "Others");
  const allFlavors = Array.from(new Set(flavorBrands.flatMap(b => Object.keys(flavorData[b] ?? {}))));

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {flavorBrands.map(brand => {
        const flavors = flavorData[brand] ?? {};
        const items = Object.entries(flavors)
          .map(([f, years]) => ({ flavor: f, volume: years[selectedYear] ?? 0 }))
          .sort((a, b) => b.volume - a.volume);
        const brandTotal = items.reduce((s, x) => s + x.volume, 0);
        const maxVol = Math.max(...items.map(x => x.volume));

        return (
          <Card key={brand}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND_COLORS[brand] }} />
                  {brand}
                </CardTitle>
                <Badge variant="secondary" className="text-[10px]">{formatVal(brandTotal)} {unitLabel}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <StackedBar
                segments={items.map(x => ({
                  value: x.volume,
                  color: FLAVOR_COLORS[x.flavor] ?? "#9ca3af",
                  label: x.flavor,
                }))}
                height={20}
                labels
                formatVal={formatVal}
                unitLabel={unitLabel}
              />
              <div className="mt-3 space-y-1.5">
                {items.map(x => (
                  <div key={x.flavor} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FLAVOR_COLORS[x.flavor] ?? "#9ca3af" }} />
                    <span className="text-xs flex-1">{x.flavor}</span>
                    <span className="text-xs tabular-nums font-medium">{formatVal(x.volume)}</span>
                    <span className="text-[10px] text-muted-foreground min-w-[35px] text-right">{pct(x.volume, brandTotal)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card className="md:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Head-to-Head by Flavor — {selectedYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-medium">Flavor</th>
                  {flavorBrands.map(b => (
                    <th key={b} className="text-right py-2 font-medium px-3">
                      <span className="flex items-center justify-end gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                        {b}
                      </span>
                    </th>
                  ))}
                  <th className="text-right py-2 font-medium px-3">Leader</th>
                </tr>
              </thead>
              <tbody>
                {allFlavors.map(flavor => {
                  const vals = flavorBrands.map(b => flavorData[b]?.[flavor]?.[selectedYear] ?? 0);
                  const maxIdx = vals.indexOf(Math.max(...vals));
                  return (
                    <tr key={flavor} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FLAVOR_COLORS[flavor] ?? "#9ca3af" }} />
                        {flavor}
                      </td>
                      {flavorBrands.map((b, i) => (
                        <td key={b} className={`text-right py-2 px-3 tabular-nums ${i === maxIdx ? "font-bold" : ""}`}>
                          {formatVal(vals[i])}
                        </td>
                      ))}
                      <td className="text-right py-2 px-3">
                        <Badge variant="secondary" className="text-[10px]" style={{ color: BRAND_COLORS[flavorBrands[maxIdx]] ?? "#9ca3af" }}>
                          {flavorBrands[maxIdx]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TwoAppleMarketShareTab({ flavorData, formatVal, unitLabel }: { flavorData: Record<string, Record<string, Record<number, number>>>; formatVal: (v: number, d?: number) => string; unitLabel: string }) {
  const twoAppleBrands = useMemo(() => {
    const result: { name: string; data: Record<number, number> }[] = [];
    const allSources = { ...OTHER_BRANDS_FLAVOR, ...flavorData };
    for (const [brand, flavors] of Object.entries(allSources)) {
      if (flavors["Two Apple"]) result.push({ name: brand, data: flavors["Two Apple"] });
    }
    return result;
  }, [flavorData]);

  const years = useMemo(() => {
    return Array.from(new Set(twoAppleBrands.flatMap(b => Object.keys(b.data).map(Number)))).sort();
  }, [twoAppleBrands]);

  const maxYear = years.length > 0 ? Math.max(...years) : 2026;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Two Apple — Market Share by Brand</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {years.map(y => {
            const segments = twoAppleBrands
              .map(b => ({ value: b.data[y] ?? 0, color: BRAND_COLORS[b.name] ?? "#9ca3af", label: b.name }))
              .filter(s => s.value > 0);
            const total = segments.reduce((s, x) => s + x.value, 0);
            if (total === 0) return null;
            return (
              <div key={y}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-semibold">{y}{y === maxYear && y >= 2026 ? " (YTD)" : ""}</span>
                  <span className="text-xs text-muted-foreground">{formatVal(total)} {unitLabel}</span>
                </div>
                <StackedBar segments={segments} height={22} labels formatVal={formatVal} unitLabel={unitLabel} />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t">
          {twoAppleBrands.map(b => (
            <div key={b.name} className="flex items-center gap-1 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b.name] ?? "#9ca3af" }} />
              {b.name}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmergingBrandsTab({ selectedYear, flavorData, formatVal, unitLabel }: { selectedYear: number; flavorData: Record<string, Record<string, Record<number, number>>>; formatVal: (v: number, d?: number) => string; unitLabel: string }) {
  const emerging = useMemo(() => {
    const merged = { ...OTHER_BRANDS_FLAVOR, ...flavorData };
    const mainBrandNames = new Set(["Al Fakher", "Mazaya", "Nakhla", "Others"]);
    const brands: { name: string; volume: number; prevVolume: number; flavors: string[] }[] = [];

    for (const [brand, flavors] of Object.entries(merged)) {
      if (mainBrandNames.has(brand)) continue;
      let vol = 0;
      let prevVol = 0;
      const flavorNames: string[] = [];
      for (const [flavor, years] of Object.entries(flavors)) {
        vol += years[selectedYear] ?? 0;
        prevVol += years[selectedYear - 1] ?? 0;
        if ((years[selectedYear] ?? 0) > 0) flavorNames.push(flavor);
      }
      if (vol > 0 || prevVol > 0) {
        brands.push({ name: brand, volume: vol, prevVolume: prevVol, flavors: flavorNames });
      }
    }

    return brands.sort((a, b) => b.volume - a.volume);
  }, [selectedYear, flavorData]);

  const maxVol = Math.max(...emerging.map(b => b.volume), 1);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Emerging / Minor Brands — {selectedYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {emerging.map(b => (
              <div key={b.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b.name] ?? "#9ca3af" }} />
                    <span className="text-xs font-semibold">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums font-medium">{formatVal(b.volume)} {unitLabel}</span>
                    <GrowthBadge current={b.volume} previous={b.prevVolume} />
                  </div>
                </div>
                <div className="h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${(b.volume / maxVol) * 100}%`,
                      backgroundColor: BRAND_COLORS[b.name] ?? "#9ca3af",
                      opacity: 0.8,
                    }}
                  />
                </div>
                <div className="flex gap-1 mt-1">
                  {b.flavors.map(f => (
                    <Badge key={f} variant="outline" className="text-[9px] h-4">{f}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Strategic Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <div className="p-3 bg-blue-50 rounded-lg dark:bg-blue-900/20">
            <h5 className="font-semibold text-blue-800 dark:text-blue-300 mb-1">Al Fakher Position</h5>
            <ul className="list-disc pl-4 space-y-1 text-blue-700 dark:text-blue-400">
              <li>Consistent #3 by volume in Lebanon market</li>
              <li>Most diversified flavor portfolio of all brands</li>
              <li>Strong in Two Apple but trails Nakhla significantly</li>
              <li>Growing share in Grapes & Mint variants</li>
            </ul>
          </div>
          <div className="p-3 bg-red-50 rounded-lg dark:bg-red-900/20">
            <h5 className="font-semibold text-red-800 dark:text-red-300 mb-1">Key Threats</h5>
            <ul className="list-disc pl-4 space-y-1 text-red-700 dark:text-red-400">
              <li>Nakhla growing fastest — Two Apple Bahraini dominance</li>
              <li>Mazaya's Lemon Mint is the single largest SKU in Lebanon</li>
              <li>New entrants (Gold Dahab, Mawal) taking share in Two Apple</li>
              <li>Khalil Maamoun resurging in 2025 (16K MC Two Apple)</li>
            </ul>
          </div>
          <div className="p-3 bg-green-50 rounded-lg dark:bg-green-900/20">
            <h5 className="font-semibold text-green-800 dark:text-green-300 mb-1">Opportunities</h5>
            <ul className="list-disc pl-4 space-y-1 text-green-700 dark:text-green-400">
              <li>Two Apple gap vs Nakhla — potential with pricing/promotions</li>
              <li>Lemon Mint — 2nd largest flavor, dominated by Mazaya. Room to grow</li>
              <li>Portfolio breadth advantage — most competitors are single-flavor</li>
              <li>Market overall growing — 633K (2024) → 807K (2025) = +27%</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
