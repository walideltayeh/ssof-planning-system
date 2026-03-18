import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitCompareArrows, ArrowRight, Plus, Minus, Equal } from "lucide-react";

type VersionListItem = {
  id: number;
  name: string;
  savedBy: string;
  createdAt: Date;
};

type SnapshotData = {
  skus: Array<{ id: number; name: string; weight: string; category: string }>;
  periods: Array<{ id: number; year: number; month: number; label: string }>;
  forecast: Array<{ skuId: number; periodId: number; value: string }>;
  ims: Array<{ skuId: number; periodId: number; value: string }>;
  shipment: Array<{ skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }>;
  arrival: Array<{ skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }>;
  planningFg: Array<{ skuId: number; periodId: number; openingStock: string; adjustments: string; invoiced: string; arrivals: string }>;
};

type SheetTab = "skus" | "forecast" | "ims" | "shipment" | "arrival" | "planningFg";

const SHEET_LABELS: Record<SheetTab, string> = {
  skus: "SKUs",
  forecast: "Forecast",
  ims: "IMS Actuals",
  shipment: "Shipment (Production)",
  arrival: "Arrival to Regie",
  planningFg: "Planning FG",
};

function computeDiff(snapshotA: SnapshotData, snapshotB: SnapshotData) {
  // SKU diff
  const skuNamesA = new Set(snapshotA.skus.map(s => s.name));
  const skuNamesB = new Set(snapshotB.skus.map(s => s.name));
  const addedSkus = snapshotB.skus.filter(s => !skuNamesA.has(s.name));
  const removedSkus = snapshotA.skus.filter(s => !skuNamesB.has(s.name));
  const commonSkuNames = snapshotA.skus.filter(s => skuNamesB.has(s.name)).map(s => s.name);

  // Build lookup maps
  const skuMapA = Object.fromEntries(snapshotA.skus.map(s => [s.id, s]));
  const skuMapB = Object.fromEntries(snapshotB.skus.map(s => [s.id, s]));
  const periodMapA = Object.fromEntries(snapshotA.periods.map(p => [p.id, p]));
  const periodMapB = Object.fromEntries(snapshotB.periods.map(p => [p.id, p]));

  // Build name-based lookup for cross-version matching
  const skuByNameA = Object.fromEntries(snapshotA.skus.map(s => [s.name, s]));
  const skuByNameB = Object.fromEntries(snapshotB.skus.map(s => [s.name, s]));

  // Period label-based matching
  const periodByLabelA = Object.fromEntries(snapshotA.periods.map(p => [p.label, p]));
  const periodByLabelB = Object.fromEntries(snapshotB.periods.map(p => [p.label, p]));

  // Value diffs per sheet
  function buildValueMap(data: Array<{ skuId: number; periodId: number; value?: string; [key: string]: any }>, skuMap: Record<number, any>, periodMap: Record<number, any>) {
    const map = new Map<string, any>();
    for (const d of data) {
      const sku = skuMap[d.skuId];
      const period = periodMap[d.periodId];
      if (sku && period) {
        map.set(`${sku.name}|${period.label}`, d);
      }
    }
    return map;
  }

  function diffSheet(
    dataA: Array<any>,
    dataB: Array<any>,
    fields: string[]
  ) {
    const mapA = buildValueMap(dataA, skuMapA, periodMapA);
    const mapB = buildValueMap(dataB, skuMapB, periodMapB);
    const allKeys = new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]);
    const changes: Array<{
      skuName: string;
      periodLabel: string;
      field: string;
      valueA: string;
      valueB: string;
    }> = [];

    for (const key of Array.from(allKeys)) {
      const [skuName, periodLabel] = key.split("|");
      if (!commonSkuNames.includes(skuName)) continue;
      const a = mapA.get(key);
      const b = mapB.get(key);
      for (const field of fields) {
        const valA = a ? String(a[field] ?? "0") : "0";
        const valB = b ? String(b[field] ?? "0") : "0";
        if (parseFloat(valA) !== parseFloat(valB)) {
          changes.push({ skuName, periodLabel, field, valueA: valA, valueB: valB });
        }
      }
    }
    return changes;
  }

  const forecastDiff = diffSheet(snapshotA.forecast, snapshotB.forecast, ["value"]);
  const imsDiff = diffSheet(snapshotA.ims, snapshotB.ims, ["value"]);
  const shipmentDiff = diffSheet(snapshotA.shipment, snapshotB.shipment, ["week1", "week2", "week3", "week4"]);
  const arrivalDiff = diffSheet(snapshotA.arrival, snapshotB.arrival, ["week1", "week2", "week3", "week4"]);
  const planningFgDiff = diffSheet(snapshotA.planningFg, snapshotB.planningFg, ["openingStock", "adjustments", "invoiced", "arrivals"]);

  // SKU property changes
  const skuChanges: Array<{ skuName: string; field: string; valueA: string; valueB: string }> = [];
  for (const name of commonSkuNames) {
    const a = skuByNameA[name];
    const b = skuByNameB[name];
    if (a && b) {
      if (a.weight !== b.weight) skuChanges.push({ skuName: name, field: "weight", valueA: a.weight, valueB: b.weight });
      if (a.category !== b.category) skuChanges.push({ skuName: name, field: "category", valueA: a.category, valueB: b.category });
    }
  }

  return {
    addedSkus,
    removedSkus,
    skuChanges,
    forecastDiff,
    imsDiff,
    shipmentDiff,
    arrivalDiff,
    planningFgDiff,
    summary: {
      skus: addedSkus.length + removedSkus.length + skuChanges.length,
      forecast: forecastDiff.length,
      ims: imsDiff.length,
      shipment: shipmentDiff.length,
      arrival: arrivalDiff.length,
      planningFg: planningFgDiff.length,
    },
  };
}

function formatNum(v: string) {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function VersionComparison({
  versions,
}: {
  versions: VersionListItem[];
}) {
  const [open, setOpen] = useState(false);
  const [versionAId, setVersionAId] = useState<string>("");
  const [versionBId, setVersionBId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<SheetTab>("skus");

  const canCompare = Boolean(versionAId) && Boolean(versionBId) && versionAId !== versionBId;

  const compareQuery = trpc.versions.compare.useQuery(
    { versionAId: Number(versionAId), versionBId: Number(versionBId) },
    { enabled: canCompare && open }
  );

  const diff = useMemo(() => {
    if (!compareQuery.data) return null;
    return computeDiff(
      compareQuery.data.versionA.snapshot as SnapshotData,
      compareQuery.data.versionB.snapshot as SnapshotData
    );
  }, [compareQuery.data]);

  const versionAName = versions.find(v => v.id === Number(versionAId))?.name || "Version A";
  const versionBName = versions.find(v => v.id === Number(versionBId))?.name || "Version B";

  const totalChanges = diff
    ? Object.values(diff.summary).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={versions.length < 2}
        className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
      >
        <GitCompareArrows className="h-4 w-4 mr-2" />
        Compare Versions
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-indigo-600" />
              Version Comparison
            </DialogTitle>
          </DialogHeader>

          {/* Version selectors */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Base Version (A)
              </label>
              <Select value={versionAId} onValueChange={setVersionAId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select base version..." />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem
                      key={v.id}
                      value={String(v.id)}
                      disabled={String(v.id) === versionBId}
                    >
                      {v.name} ({new Date(v.createdAt).toLocaleDateString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground mt-5 shrink-0" />
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Compare Version (B)
              </label>
              <Select value={versionBId} onValueChange={setVersionBId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select compare version..." />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem
                      key={v.id}
                      value={String(v.id)}
                      disabled={String(v.id) === versionAId}
                    >
                      {v.name} ({new Date(v.createdAt).toLocaleDateString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Loading / Results */}
          {compareQuery.isLoading && canCompare ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          ) : !canCompare ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Select two different versions to compare
            </div>
          ) : diff ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Summary badges */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <Badge variant="secondary" className="text-xs">
                  {totalChanges} total changes
                </Badge>
                {(Object.keys(SHEET_LABELS) as SheetTab[]).map((key) => {
                  const count = diff.summary[key];
                  if (count === 0) return null;
                  return (
                    <Badge
                      key={key}
                      variant="outline"
                      className={`text-xs cursor-pointer ${
                        activeTab === key
                          ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                          : ""
                      }`}
                      onClick={() => setActiveTab(key)}
                    >
                      {SHEET_LABELS[key]}: {count}
                    </Badge>
                  );
                })}
              </div>

              {/* Tab buttons */}
              <div className="flex gap-1 border-b mb-3 overflow-x-auto">
                {(Object.keys(SHEET_LABELS) as SheetTab[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === key
                        ? "border-indigo-600 text-indigo-700"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {SHEET_LABELS[key]}
                    {diff.summary[key] > 0 && (
                      <span className="ml-1 text-[10px] bg-indigo-100 text-indigo-700 px-1 rounded">
                        {diff.summary[key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Diff content */}
              <div className="flex-1 overflow-auto">
                {activeTab === "skus" ? (
                  <SkuDiffView
                    addedSkus={diff.addedSkus}
                    removedSkus={diff.removedSkus}
                    skuChanges={diff.skuChanges}
                    versionAName={versionAName}
                    versionBName={versionBName}
                  />
                ) : (
                  <ValueDiffTable
                    changes={
                      activeTab === "forecast"
                        ? diff.forecastDiff
                        : activeTab === "ims"
                        ? diff.imsDiff
                        : activeTab === "shipment"
                        ? diff.shipmentDiff
                        : activeTab === "arrival"
                        ? diff.arrivalDiff
                        : diff.planningFgDiff
                    }
                    versionAName={versionAName}
                    versionBName={versionBName}
                  />
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SkuDiffView({
  addedSkus,
  removedSkus,
  skuChanges,
  versionAName,
  versionBName,
}: {
  addedSkus: Array<{ name: string; weight: string; category: string }>;
  removedSkus: Array<{ name: string; weight: string; category: string }>;
  skuChanges: Array<{ skuName: string; field: string; valueA: string; valueB: string }>;
  versionAName: string;
  versionBName: string;
}) {
  if (addedSkus.length === 0 && removedSkus.length === 0 && skuChanges.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Equal className="h-4 w-4 mr-2" />
        No SKU changes between versions
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {addedSkus.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-emerald-700">
              <Plus className="h-4 w-4" />
              Added in {versionBName} ({addedSkus.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-2">
              {addedSkus.map((s) => (
                <Badge key={s.name} variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  {s.name} ({s.weight}, {s.category})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {removedSkus.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700">
              <Minus className="h-4 w-4" />
              Removed from {versionAName} ({removedSkus.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-2">
              {removedSkus.map((s) => (
                <Badge key={s.name} variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  {s.name} ({s.weight}, {s.category})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {skuChanges.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>{versionAName}</TableHead>
              <TableHead>{versionBName}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skuChanges.map((c, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{c.skuName}</TableCell>
                <TableCell>{c.field}</TableCell>
                <TableCell className="text-red-600 bg-red-50">{c.valueA}</TableCell>
                <TableCell className="text-emerald-600 bg-emerald-50">{c.valueB}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ValueDiffTable({
  changes,
  versionAName,
  versionBName,
}: {
  changes: Array<{
    skuName: string;
    periodLabel: string;
    field: string;
    valueA: string;
    valueB: string;
  }>;
  versionAName: string;
  versionBName: string;
}) {
  if (changes.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Equal className="h-4 w-4 mr-2" />
        No changes in this sheet
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Period</TableHead>
          <TableHead>Field</TableHead>
          <TableHead className="text-right">{versionAName}</TableHead>
          <TableHead className="text-right">{versionBName}</TableHead>
          <TableHead className="text-right">Diff</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.slice(0, 200).map((c, i) => {
          const numA = parseFloat(c.valueA) || 0;
          const numB = parseFloat(c.valueB) || 0;
          const diff = numB - numA;
          return (
            <TableRow key={i}>
              <TableCell className="font-medium text-xs">{c.skuName}</TableCell>
              <TableCell className="text-xs">{c.periodLabel}</TableCell>
              <TableCell className="text-xs">{c.field}</TableCell>
              <TableCell className="text-right text-xs text-red-600 bg-red-50">
                {formatNum(c.valueA)}
              </TableCell>
              <TableCell className="text-right text-xs text-emerald-600 bg-emerald-50">
                {formatNum(c.valueB)}
              </TableCell>
              <TableCell
                className={`text-right text-xs font-medium ${
                  diff > 0
                    ? "text-emerald-700"
                    : diff < 0
                    ? "text-red-700"
                    : "text-muted-foreground"
                }`}
              >
                {diff > 0 ? "+" : ""}
                {formatNum(String(diff))}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      {changes.length > 200 && (
        <tfoot>
          <tr>
            <td colSpan={6} className="text-center text-xs text-muted-foreground py-2">
              Showing first 200 of {changes.length} changes
            </td>
          </tr>
        </tfoot>
      )}
    </Table>
  );
}
