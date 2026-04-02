import { useState, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, Crown, BarChart3, Download, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
import { useAppAuth } from "@/contexts/AuthContext";
import { useUnit } from "@/contexts/UnitContext";

const BRAND_MONTHLY_KG: Record<string, Record<number, number[]>> = {
  "Al Fakher": {
    2025: [88704, 61308, 127410, 133176, 9324, 64602, 89610, 107082, 143118, 147672, 138606, 71328],
    2026: [130506, 74862, 127122, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  "Mazaya": {
    2025: [142338, 129270, 118590, 149442, 142170, 132006, 204480, 173850, 190692, 190692, 94464, 137814],
    2026: [231312, 134280, 143028, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  "Nakhla": {
    2025: [504498, 191763, 216395, 311143, 298105, 191690, 285523, 271845, 232245, 166425, 188725, 127790],
    2026: [657065, 246418, 283450, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  "Others": {
    2025: [8916, 22734, 17736, 24484, 13846, 32818, 19820, 19978, 22026, 30976, 6300, 84384],
    2026: [34114, 27988, 45948, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

const FLAVOR_DATA_KG: Record<string, Record<string, Record<number, number>>> = {
  "Al Fakher": {
    "Two Apple": { 2025: 955746, 2026: 295848 },
    "Grapes": { 2025: 73842, 2026: 10920 },
    "Lemon Mint": { 2025: 49386, 2026: 9606 },
    "Mint": { 2025: 51246, 2026: 6042 },
    "Grape Mint": { 2025: 38928, 2026: 7290 },
    "Gum": { 2025: 5940, 2026: 1656 },
    "Other Flavors": { 2025: 6852, 2026: 1128 },
  },
  "Mazaya": {
    "Two Apple": { 2025: 505218, 2026: 150438 },
    "Lemon Mint": { 2025: 1061904, 2026: 293124 },
    "Gum": { 2025: 66162, 2026: 22248 },
    "Mint": { 2025: 43104, 2026: 10080 },
    "Grapes": { 2025: 33552, 2026: 5022 },
    "Grape Mint": { 2025: 35652, 2026: 6312 },
    "Other Flavors": { 2025: 60216, 2026: 21396 },
  },
  "Nakhla": {
    "Two Apple": { 2025: 2952108, 2026: 1186933 },
    "Lemon Mint": { 2025: 34038, 2026: 0 },
  },
};

const OTHER_BRANDS_FLAVOR_KG: Record<string, Record<string, Record<number, number>>> = {
  "Al Ostoura": {
    "Two Apple": { 2025: 21798, 2026: 0 },
    "Lemon Mint": { 2025: 2060, 2026: 0 },
    "Other Flavors": { 2025: 68484, 2026: 34004 },
    "Gum": { 2025: 60, 2026: 0 },
    "Grape Mint": { 2025: 50, 2026: 0 },
    "Grapes": { 2025: 100, 2026: 0 },
    "Mint": { 2025: 90, 2026: 0 },
  },
  "Al Fakhama": {
    "Two Apple": { 2025: 14222, 2026: 0 },
    "Lemon Mint": { 2025: 1054, 2026: 0 },
  },
  "Frisky": { "Two Apple": { 2025: 1050, 2026: 210 } },
  "Khalil Maamoun": { "Two Apple": { 2025: 97650, 2026: 20760 } },
  "Al Basha": { "Two Apple": { 2025: 47050, 2026: 24740 }, "Lemon Mint": { 2025: 11660, 2026: 0 } },
  "Gold Dahab": { "Two Apple": { 2025: 35370, 2026: 17058 } },
  "Mawal": { "Two Apple": { 2025: 33558, 2026: 11316 }, "Lemon Mint": { 2025: 4650, 2026: 0 }, "Other Flavors": { 2025: 4020, 2026: 0 }, "Gum": { 2025: 1338, 2026: 0 }, "Mint": { 2025: 2076, 2026: 0 } },
  "Malke": { "Lemon Mint": { 2025: 150, 2026: 0 } },
};

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


function TwoAppleComparison({ selectedYear, comparisonYear, flavorData, otherBrandsFlavorData, unit, unitLabel }: { selectedYear: number; comparisonYear: number; flavorData: Record<string, Record<string, Record<number, number>>>; otherBrandsFlavorData: Record<string, Record<string, Record<number, number>>>; unit: string; unitLabel: string }) {
  const twoAppleData = useMemo(() => {
    const data: Record<string, Record<number, number>> = {};
    const allSources = { ...otherBrandsFlavorData, ...flavorData };
    for (const [brand, flavors] of Object.entries(allSources)) {
      if (flavors["Two Apple"]) data[brand] = flavors["Two Apple"];
    }
    return data;
  }, [flavorData, otherBrandsFlavorData]);
  const taBrands = Object.keys(twoAppleData)
    .filter(b => (twoAppleData[b]?.[selectedYear] ?? 0) > 0)
    .sort((a, b) => (twoAppleData[b]?.[selectedYear] ?? 0) - (twoAppleData[a]?.[selectedYear] ?? 0));
  const totalTwoAppleConverted = taBrands.reduce((s, b) => s + (twoAppleData[b]?.[selectedYear] ?? 0), 0);
  const prevTotalConverted = Object.keys(twoAppleData).reduce((s, b) => s + (twoAppleData[b]?.[comparisonYear] ?? 0), 0);
  const fmtN = (v: number) => { const d = unit === "Tons" ? 2 : 0; return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500" />
          Two Apple Battle — {selectedYear}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Total: {fmtN(totalTwoAppleConverted)} {unitLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium">#</th>
                <th className="text-left py-2 font-medium">Brand</th>
                <th className="text-right py-2 font-medium px-2">Volume ({unitLabel})</th>
                <th className="text-right py-2 font-medium px-2">Share</th>
                <th className="text-right py-2 font-medium px-2">YoY vs {comparisonYear}</th>
                <th className="py-2 font-medium px-2 w-[140px]">Share</th>
              </tr>
            </thead>
            <tbody>
              {taBrands.map((b, idx) => {
                const vol = twoAppleData[b]?.[selectedYear] ?? 0;
                const prev = twoAppleData[b]?.[comparisonYear] ?? 0;
                const share = totalTwoAppleConverted > 0 ? (vol / totalTwoAppleConverted) * 100 : 0;
                return (
                  <tr key={b} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 text-muted-foreground font-semibold">{idx + 1}</td>
                    <td className="py-2 font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                        {b}
                      </span>
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums font-semibold">{fmtN(vol)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{share.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2">
                      <GrowthBadge current={vol} previous={prev} />
                    </td>
                    <td className="py-2 px-2">
                      <div className="h-3.5 bg-muted rounded overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${Math.min(share, 100)}%`, backgroundColor: BRAND_COLORS[b] ?? "#9ca3af" }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
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
  const { unitLabel, unit } = useUnit();
  const fmtNum = (n: number, decimals?: number) => {
    const d = decimals ?? (unit === "Tons" ? 2 : 0);
    return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const tonDiv = unit === "Tons" ? 1000 : 1;
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [compareYear1, setCompareYear1] = useState<number>(2024);
  const [compareYear2, setCompareYear2] = useState<number>(2023);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: dbData, refetch } = trpc.country.competitorData.useQuery(
    { country: country ?? "Lebanon" },
    { staleTime: 60_000 }
  );

  const isLebanon = (country ?? "Lebanon") === "Lebanon";

  const mcBrandMonthly = useMemo<Record<string, Record<number, number[]>>>(() => {
    if (dbData?.brandMonthly) return dbData.brandMonthly as any;
    return isLebanon ? BRAND_MONTHLY : {};
  }, [dbData, isLebanon]);

  const kgBrandMonthly = useMemo<Record<string, Record<number, number[]>>>(() => {
    if (dbData?.brandMonthlyKg) return dbData.brandMonthlyKg as any;
    return isLebanon ? BRAND_MONTHLY_KG : {};
  }, [dbData, isLebanon]);

  const mcFlavorData = useMemo<Record<string, Record<string, Record<number, number>>>>(() => {
    if (dbData?.flavorYearly) return dbData.flavorYearly as any;
    return isLebanon ? FLAVOR_DATA : {};
  }, [dbData, isLebanon]);

  const kgFlavorData = useMemo<Record<string, Record<string, Record<number, number>>>>(() => {
    if (dbData?.flavorYearlyKg) return dbData.flavorYearlyKg as any;
    return isLebanon ? FLAVOR_DATA_KG : {};
  }, [dbData, isLebanon]);

  const activeBrandMonthly = useMemo<Record<string, Record<number, number[]>>>(() => {
    if (unit === "MC") return mcBrandMonthly;
    const result: Record<string, Record<number, number[]>> = {};
    for (const [brand, years] of Object.entries(mcBrandMonthly)) {
      result[brand] = {};
      for (const [y, months] of Object.entries(years)) {
        const yr = Number(y);
        const kgMonths = kgBrandMonthly[brand]?.[yr];
        if (kgMonths) {
          result[brand][yr] = kgMonths.map(v => v / tonDiv);
        } else {
          result[brand][yr] = (months as number[]).slice();
        }
      }
    }
    return result;
  }, [mcBrandMonthly, kgBrandMonthly, unit, tonDiv]);

  const activeBrandYearly = useMemo<Record<string, Record<number, number>>>(() => {
    const result: Record<string, Record<number, number>> = {};
    for (const [brand, years] of Object.entries(activeBrandMonthly)) {
      result[brand] = {};
      for (const [y, months] of Object.entries(years)) {
        result[brand][Number(y)] = (months as number[]).reduce((s, v) => s + v, 0);
      }
    }
    return result;
  }, [activeBrandMonthly]);

  const activeFlavorData = useMemo<Record<string, Record<string, Record<number, number>>>>(() => {
    if (unit === "MC") return mcFlavorData;
    const result: Record<string, Record<string, Record<number, number>>> = {};
    for (const [brand, flavors] of Object.entries(mcFlavorData)) {
      result[brand] = {};
      for (const [flavor, years] of Object.entries(flavors)) {
        result[brand][flavor] = {};
        for (const [y, val] of Object.entries(years)) {
          const yr = Number(y);
          const kgVal = kgFlavorData[brand]?.[flavor]?.[yr];
          result[brand][flavor][yr] = kgVal != null ? kgVal / tonDiv : (val as number);
        }
      }
    }
    return result;
  }, [mcFlavorData, kgFlavorData, unit, tonDiv]);

  const hasKgData = useCallback((year: number) => {
    return Object.values(kgBrandMonthly).some(yrs => yrs[year] != null);
  }, [kgBrandMonthly]);

  const effectiveUnitLabel = useCallback((year: number) => {
    if (unit === "MC") return unitLabel;
    return hasKgData(year) ? unitLabel : "MC";
  }, [unit, unitLabel, hasKgData]);

  const activeOtherBrandsFlavorData = useMemo<Record<string, Record<string, Record<number, number>>>>(() => {
    if (unit === "MC") return OTHER_BRANDS_FLAVOR;
    const result: Record<string, Record<string, Record<number, number>>> = {};
    for (const [brand, flavors] of Object.entries(OTHER_BRANDS_FLAVOR)) {
      result[brand] = {};
      for (const [flavor, years] of Object.entries(flavors)) {
        result[brand][flavor] = {};
        for (const [y, val] of Object.entries(years)) {
          const yr = Number(y);
          const kgVal = OTHER_BRANDS_FLAVOR_KG[brand]?.[flavor]?.[yr];
          result[brand][flavor][yr] = kgVal != null ? kgVal / tonDiv : (val as number);
        }
      }
    }
    return result;
  }, [unit, tonDiv]);

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
    if (compareYear1 === y) {
      const fb = activeYears.filter(v => v !== y && v !== compareYear2);
      if (fb.length) setCompareYear1(fb[fb.length - 1]);
    }
    if (compareYear2 === y) {
      const fb = activeYears.filter(v => v !== y && v !== compareYear1);
      if (fb.length) setCompareYear2(fb[0]);
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

  const totalMarketConverted = useMemo(() => {
    const result: Record<number, number> = {};
    for (const y of activeYears) {
      result[y] = Object.values(activeBrandYearly).reduce((s, bv) => s + (bv[y] ?? 0), 0);
    }
    return result;
  }, [activeBrandYearly, activeYears]);

  const totalMarket = totalMarketConverted[selectedYear] ?? 0;
  const prevTotal = totalMarketConverted[compareYear1] ?? 0;

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
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Year</span>
            <Select value={selectedYear.toString()} onValueChange={v => handleSelectedYearChange(Number(v))}>
              <SelectTrigger className="w-[90px] h-8 text-xs font-semibold border-primary/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeYears.map(y => <SelectItem key={y} value={y.toString()}>{y}{y === maxYear && y >= 2026 ? " (YTD)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground">vs</span>
            <Select value={compareYear1.toString()} onValueChange={v => setCompareYear1(Number(v))}>
              <SelectTrigger className="w-[80px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeYears.filter(y => y !== selectedYear && y !== compareYear2).map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground">vs</span>
            <Select value={compareYear2.toString()} onValueChange={v => setCompareYear2(Number(v))}>
              <SelectTrigger className="w-[80px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeYears.filter(y => y !== selectedYear && y !== compareYear1).map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
      {(() => {
        const displayYears = [selectedYear, compareYear1, compareYear2].sort((a, b) => b - a);
        const top5 = Object.entries(activeBrandYearly)
          .map(([name, yrs]) => ({ name, yrs }))
          .sort((a, b) => (b.yrs[selectedYear] ?? 0) - (a.yrs[selectedYear] ?? 0))
          .slice(0, 5);
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                Top Brands — Head to Head
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 font-medium">#</th>
                      <th className="text-left py-2 font-medium">Brand</th>
                      {displayYears.map(y => (
                        <th key={y} className={`text-right py-2 font-medium px-2 ${y === selectedYear ? "text-foreground" : ""}`}>
                          {y}{y === maxYear && y >= 2026 ? " *" : ""}
                          <div className="text-[9px] font-normal">({unitLabel})</div>
                        </th>
                      ))}
                      <th className="text-right py-2 font-medium px-2">
                        Share {selectedYear}
                      </th>
                      <th className="text-right py-2 font-medium px-2">
                        {selectedYear} vs {compareYear1}
                      </th>
                      <th className="py-2 font-medium px-2 w-[140px]">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top5.map((b, idx) => {
                      const vol = b.yrs[selectedYear] ?? 0;
                      const share = totalMarket > 0 ? (vol / totalMarket) * 100 : 0;
                      const prevVol = b.yrs[compareYear1] ?? 0;
                      return (
                        <tr key={b.name} className={`border-b last:border-0 hover:bg-muted/50 ${b.name === "Al Fakher" ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
                          <td className="py-2.5 font-semibold text-muted-foreground">{idx + 1}</td>
                          <td className="py-2.5 font-semibold">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND_COLORS[b.name] ?? "#9ca3af" }} />
                              {b.name}
                              {idx === 0 && <Crown className="w-3 h-3 text-amber-500" />}
                            </span>
                          </td>
                          {displayYears.map(y => (
                            <td key={y} className={`text-right py-2.5 px-2 tabular-nums ${y === selectedYear ? "font-bold" : "text-muted-foreground"}`}>
                              {fmtNum(b.yrs[y] ?? 0)}
                            </td>
                          ))}
                          <td className="text-right py-2.5 px-2 tabular-nums">{share.toFixed(1)}%</td>
                          <td className="text-right py-2.5 px-2">
                            <GrowthBadge current={vol} previous={prevVol} />
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="h-4 bg-muted rounded overflow-hidden">
                              <div className="h-full rounded transition-all duration-500" style={{ width: `${Math.min(share, 100)}%`, backgroundColor: BRAND_COLORS[b.name] ?? "#9ca3af" }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 font-semibold">
                      <td className="py-2.5" colSpan={2}>Total Market</td>
                      {displayYears.map(y => (
                        <td key={y} className={`text-right py-2.5 px-2 tabular-nums ${y === selectedYear ? "font-bold" : "text-muted-foreground"}`}>
                          {fmtNum(totalMarketConverted[y] ?? 0)}
                        </td>
                      ))}
                      <td className="text-right py-2.5 px-2">100%</td>
                      <td className="text-right py-2.5 px-2">
                        <GrowthBadge current={totalMarketConverted[selectedYear] ?? 0} previous={totalMarketConverted[compareYear1] ?? 0} />
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {is2026 && <p className="text-[10px] text-muted-foreground mt-2">* Year-to-date data</p>}
            </CardContent>
          </Card>
        );
      })()}

      <Tabs defaultValue="market-share" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="market-share">Market Share</TabsTrigger>
          <TabsTrigger value="monthly-trends">Monthly Trends</TabsTrigger>
          <TabsTrigger value="flavor-battle">Flavor Breakdown</TabsTrigger>
          <TabsTrigger value="two-apple">Two Apple Deep Dive</TabsTrigger>
          <TabsTrigger value="emerging">Emerging Brands</TabsTrigger>
        </TabsList>

        <TabsContent value="market-share" className="space-y-4">
          <MarketShareTab selectedYear={selectedYear} comparisonYear={compareYear1} totals={totals} brandYearly={activeBrandYearly} brands={activeMainBrands} years={activeYears} unit={unit} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="monthly-trends" className="space-y-4">
          <MonthlyTrendsTab selectedYear={selectedYear} monthlyActiveCount={monthlyActiveCount} brandMonthly={activeBrandMonthly} brands={activeMainBrands} unit={unit} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="flavor-battle" className="space-y-4">
          <FlavorBreakdownTab selectedYear={selectedYear} flavorData={activeFlavorData} unit={unit} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="two-apple" className="space-y-4">
          <TwoAppleComparison selectedYear={selectedYear} comparisonYear={compareYear1} flavorData={activeFlavorData} otherBrandsFlavorData={activeOtherBrandsFlavorData} unit={unit} unitLabel={unitLabel} />
          <TwoAppleMarketShareTab selectedYear={selectedYear} comparisonYear={compareYear1} flavorData={activeFlavorData} otherBrandsFlavorData={activeOtherBrandsFlavorData} unit={unit} unitLabel={unitLabel} />
        </TabsContent>

        <TabsContent value="emerging" className="space-y-4">
          <EmergingBrandsTab selectedYear={selectedYear} flavorData={activeFlavorData} otherBrandsFlavorData={activeOtherBrandsFlavorData} unit={unit} unitLabel={unitLabel} />
        </TabsContent>
      </Tabs>
      </>}
    </div>
  );
}

function MarketShareTab({ selectedYear, comparisonYear, totals, brandYearly, brands, years, unit, unitLabel }: { selectedYear: number; comparisonYear: number; totals: Record<number, number>; brandYearly: Record<string, Record<number, number>>; brands: string[]; years: number[]; unit: string; unitLabel: string }) {
  const fmtNum = (n: number, decimals?: number) => { const d = decimals ?? (unit === "Tons" ? 2 : 0); return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const fbv = (v: number) => fmtNum(v);
  const totalConverted = (year: number) => {
    let sum = 0;
    for (const [b, yrs] of Object.entries(brandYearly)) sum += yrs[year] ?? 0;
    return sum;
  };
  const fmtTotalConverted = (year: number) => {
    const v = totalConverted(year);
    const d = unit === "Tons" ? 2 : 0;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  const insights = useMemo(() => {
    const ranked = brands
      .filter(b => b !== "Others")
      .map(b => ({ name: b, vol: brandYearly[b]?.[selectedYear] ?? 0 }))
      .sort((a, b) => b.vol - a.vol);
    const leader = ranked[0];
    if (!leader) return [];
    const growths = ranked.map(b => ({
      name: b.name,
      growth: (() => {
        const prev = brandYearly[b.name]?.[comparisonYear] ?? 0;
        return prev ? ((b.vol - prev) / prev) * 100 : 0;
      })(),
    })).sort((a, b) => b.growth - a.growth);
    const fastestGrower = growths[0];
    const afRank = ranked.findIndex(b => b.name === "Al Fakher") + 1;
    const tc = totalConverted(selectedYear);
    const tcPrev = totalConverted(comparisonYear);
    const d = unit === "Tons" ? 2 : 0;
    const fmtL = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return [
      `${leader.name} leads the market in ${selectedYear} with ${fmtL(leader.vol)} ${unitLabel}`,
      fastestGrower ? `${fastestGrower.name} has the highest YoY growth at ${fastestGrower.growth > 0 ? "+" : ""}${fastestGrower.growth.toFixed(1)}% vs ${comparisonYear}` : "",
      afRank > 0 ? `Al Fakher ranks #${afRank} by volume` : "",
      `Total market: ${fmtL(tc)} ${unitLabel} in ${selectedYear} (${yoyGrowth(tc, tcPrev).label} vs ${comparisonYear})`,
    ].filter(Boolean);
  }, [selectedYear, comparisonYear, totals, brandYearly, brands, unit, unitLabel]);

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
                    <span className="text-xs text-muted-foreground">{fmtTotalConverted(y)} {unitLabel}</span>
                  </div>
                  <StackedBar segments={segments} height={y === selectedYear ? 28 : 20} labels={y === selectedYear} />
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
              const volC = brandYearly[b]?.[selectedYear] ?? 0;
              const prevVolC = brandYearly[b]?.[comparisonYear] ?? 0;
              const tc = totalConverted(selectedYear);
              const share = tc > 0 ? (volC / tc * 100).toFixed(1) : "0";
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
                          width: `${tc > 0 ? (volC / tc) * 100 : 0}%`,
                          backgroundColor: BRAND_COLORS[b],
                          opacity: 0.85,
                        }}
                      />
                      <span className="absolute right-2 top-0 h-full flex items-center text-[10px] font-bold">
                        {fbv(brandYearly[b]?.[selectedYear] ?? 0)} {unitLabel}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-[60px] text-right">
                    <GrowthBadge current={volC} previous={prevVolC} />
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

function MonthlyTrendsTab({ selectedYear, monthlyActiveCount, brandMonthly, brands, unit, unitLabel }: { selectedYear: number; monthlyActiveCount: number; brandMonthly: Record<string, Record<number, number[]>>; brands: string[]; unit: string; unitLabel: string }) {
  const fmtNum = (n: number, decimals?: number) => { const d = decimals ?? (unit === "Tons" ? 2 : 0); return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
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
                const totalRaw = brands.reduce((s, b) => s + ((d[b] as number) ?? 0), 0);
                if (totalRaw === 0) return null;
                const totalConv = brands.reduce((s, b) => s + ((d[b] as number) ?? 0), 0);
                const afValConv = (d["Al Fakher"] as number) ?? 0;
                const afShare = totalConv > 0 ? ((afValConv / totalConv) * 100).toFixed(1) : "0";
                return (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 font-medium">{d.month}</td>
                    {brands.map(b => (
                      <td key={b} className="text-right py-2 px-2 tabular-nums">{fmtNum((d[b] as number) ?? 0)}</td>
                    ))}
                    <td className="text-right py-2 px-2 tabular-nums font-semibold">{fmtNum(totalConv)}</td>
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
                        title={`${MONTHS[i]}: ${fmtNum(v)} ${unitLabel}`}
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

function FlavorBreakdownTab({ selectedYear, flavorData, unit, unitLabel }: { selectedYear: number; flavorData: Record<string, Record<string, Record<number, number>>>; unit: string; unitLabel: string }) {
  const fmtNum = (n: number, decimals?: number) => { const d = decimals ?? (unit === "Tons" ? 2 : 0); return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
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
                <Badge variant="secondary" className="text-[10px]">{fmtNum(brandTotal)} {unitLabel}</Badge>
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
              />
              <div className="mt-3 space-y-1.5">
                {items.map(x => (
                  <div key={x.flavor} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FLAVOR_COLORS[x.flavor] ?? "#9ca3af" }} />
                    <span className="text-xs flex-1">{x.flavor}</span>
                    <span className="text-xs tabular-nums font-medium">{fmtNum(x.volume)}</span>
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
                  const valsConverted = vals.slice();
                  const maxIdx = valsConverted.indexOf(Math.max(...valsConverted));
                  return (
                    <tr key={flavor} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FLAVOR_COLORS[flavor] ?? "#9ca3af" }} />
                        {flavor}
                      </td>
                      {flavorBrands.map((b, i) => (
                        <td key={b} className={`text-right py-2 px-3 tabular-nums ${i === maxIdx ? "font-bold" : ""}`}>
                          {fmtNum(vals[i])}
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

function TwoAppleMarketShareTab({ selectedYear, comparisonYear, flavorData, otherBrandsFlavorData, unit, unitLabel }: { selectedYear: number; comparisonYear: number; flavorData: Record<string, Record<string, Record<number, number>>>; otherBrandsFlavorData: Record<string, Record<string, Record<number, number>>>; unit: string; unitLabel: string }) {
  const twoAppleBrands = useMemo(() => {
    const result: { name: string; data: Record<number, number> }[] = [];
    const allSources = { ...otherBrandsFlavorData, ...flavorData };
    for (const [brand, flavors] of Object.entries(allSources)) {
      if (flavors["Two Apple"]) result.push({ name: brand, data: flavors["Two Apple"] });
    }
    return result;
  }, [flavorData]);

  const segments = twoAppleBrands
    .map(b => ({ value: b.data[selectedYear] ?? 0, color: BRAND_COLORS[b.name] ?? "#9ca3af", label: b.name }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = segments.reduce((s, x) => s + x.value, 0);

  const prevSegments = twoAppleBrands
    .map(b => ({ name: b.name, value: b.data[comparisonYear] ?? 0 }));
  const prevTotal = prevSegments.reduce((s, x) => s + x.value, 0);

  const fmtN = (v: number) => { const d = unit === "Tons" ? 2 : 0; return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Two Apple — Market Share — {selectedYear}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Total: {fmtN(total)} {unitLabel}
            {prevTotal > 0 && <> ({yoyGrowth(total, prevTotal).label} vs {comparisonYear})</>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total > 0 ? (
          <>
            <StackedBar segments={segments} height={28} labels />
            <div className="mt-3 space-y-1.5">
              {segments.map(seg => {
                const share = total > 0 ? (seg.value / total) * 100 : 0;
                const prev = prevSegments.find(p => p.name === seg.label)?.value ?? 0;
                return (
                  <div key={seg.label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                    <span className="text-xs flex-1">{seg.label}</span>
                    <span className="text-xs tabular-nums font-medium">{fmtN(seg.value)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground min-w-[40px] text-right">{share.toFixed(1)}%</span>
                    <GrowthBadge current={seg.value} previous={prev} />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">No Two Apple data for {selectedYear}</p>
        )}
      </CardContent>
    </Card>
  );
}

function EmergingBrandsTab({ selectedYear, flavorData, otherBrandsFlavorData, unit, unitLabel }: { selectedYear: number; flavorData: Record<string, Record<string, Record<number, number>>>; otherBrandsFlavorData: Record<string, Record<string, Record<number, number>>>; unit: string; unitLabel: string }) {
  const emerging = useMemo(() => {
    const merged = { ...otherBrandsFlavorData, ...flavorData };
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
  }, [selectedYear, flavorData, unit]);

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
                    <span className="text-xs tabular-nums font-medium">{(() => { const d = unit === "Tons" ? 2 : 0; return b.volume.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); })()} {unitLabel}</span>
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
