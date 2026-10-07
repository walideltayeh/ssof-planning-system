import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TableSkeleton } from "@/components/TableSkeleton";
import { RecordFocDialog } from "@/components/forecast/RecordFocDialog";
import { MoveFocDialog } from "@/components/forecast/MoveFocDialog";
import { FocImpactConfirmation } from "@/components/forecast/FocImpactConfirmation";
import { trpc } from "@/lib/trpc";
import { exactDisplayValue, fromMastercases, toMastercases } from "@/lib/forecastUnits";
import { toast } from "sonner";
import type { FocCell, FocCountry } from "@shared/performance/foc";
import type { FocReceiptEntry } from "@shared/performance/focReceipts";

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };
type Period = { id: number; label: string; year: number; sortOrder: number; month?: number; country?: string };
type Sku = { id: number; name: string; category: string; weight: string; packagingType?: string | null; isActive?: boolean };
type Change = {
  value?: number | null;
  received?: boolean;
  lineId?: string;
  remove?: boolean;
  decision?: "separate" | "included";
  reviewKey?: string;
};
type CellPreview = {
  impact?: Array<{ sku: string; month: string; before: number; after: number; beforeArrivals: number; afterArrivals: number }>;
  warnings?: FocReceiptEntry[];
  canSave?: boolean;
  token?: string;
  versionId?: number;
};

export default function FocRecordPage() {
  const { country } = useCountry();
  const { isAdminFor } = useAppAuth();
  const { unit, formatVal } = useUnit();
  const supported = country === "Libya" || country === "Syria";
  const focCountry = (supported ? country : "Libya") as FocCountry;
  const canEdit = supported && isAdminFor(focCountry);
  const utils = trpc.useUtils();
  const query = trpc.focPlanning.list.useQuery(
    { country: focCountry, includeFoc: true },
    { enabled: supported, retry: false, refetchOnWindowFocus: true },
  );
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedWeights, setCollapsedWeights] = useState<Set<string>>(new Set());
  const [moveRequest, setMoveRequest] = useState<{ sourceSkuId: number; periodId?: number } | null>(null);
  const invalidate = async () => Promise.all([
    utils.focPlanning.list.invalidate({ country: focCountry }),
    utils.country.data.invalidate({ country: focCountry }),
    utils.country.planningFg.invalidate(),
    utils.country.performance.invalidate(),
    utils.country.intlAnalysis.invalidate(),
    utils.country.stockLevels.invalidate(),
    utils.country.currentMonthClosingStock.invalidate(),
  ]);

  const skus = useMemo(() => ((query.data?.skus ?? []) as Sku[])
    .filter(sku => sku.isActive !== false)
    .sort((a, b) => (a.category === "Core" ? 0 : 1) - (b.category === "Core" ? 0 : 1)
      || (WEIGHT_ORDER[a.weight] ?? 9) - (WEIGHT_ORDER[b.weight] ?? 9)
      || a.name.localeCompare(b.name)), [query.data?.skus]);
  const periods = useMemo(() => ((query.data?.periods ?? []) as Period[])
    .filter(period => !period.country || period.country === focCountry)
    .sort((a, b) => a.year - b.year || a.sortOrder - b.sortOrder), [query.data?.periods, focCountry]);
  const bySkuCell = useMemo(() => {
    const map = new Map<string, FocCell>();
    for (const cell of (query.data?.cells ?? []) as FocCell[]) map.set(`${cell.skuId}-${cell.periodId}`, cell);
    return map;
  }, [query.data?.cells]);
  const receiptEntries: FocReceiptEntry[] = (query.data?.receipts?.entries ?? []) as FocReceiptEntry[];
  const years = useMemo(() => {
    const result: { year: number; periods: Period[] }[] = [];
    for (const period of periods) {
      let current = result[result.length - 1];
      if (!current || current.year !== period.year) {
        current = { year: period.year, periods: [] };
        result.push(current);
      }
      current.periods.push(period);
    }
    return result;
  }, [periods]);

  if (!supported) {
    return <div className="mx-auto max-w-2xl border-y-2 border-[#7f1d1d] py-10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7f1d1d]">SSOF · FOC Record</p>
      <h1 className="mt-2 text-xl font-semibold">FOC Record access denied</h1>
      <p className="mt-2 text-sm text-muted-foreground">FOC Record is restricted to Libya and Syria. No FOC data is loaded for {country ?? "this country"}.</p>
    </div>;
  }
  if (query.isLoading) return <TableSkeleton title="FOC Record" rows={12} cols={periods.length + 2} />;
  if (query.error) return <div className="flex min-h-56 flex-col items-center justify-center gap-3 border border-[#e2d9d5] bg-[#fcfaf7] px-5 text-center">
    <AlertCircle className="h-5 w-5 text-[#7f1d1d]" />
    <div><h1 className="font-semibold">FOC Record could not be loaded</h1><p className="mt-1 text-sm text-muted-foreground">{query.error.message}</p></div>
    <Button variant="outline" size="sm" onClick={() => void query.refetch()}><RotateCw className="mr-2 h-3.5 w-3.5" />Retry</Button>
  </div>;

  const showMonth = (value: number) => value === 0 ? "" : formatVal(value);
  const grand = (theseSkus: Sku[], thesePeriods: Period[]) => theseSkus.reduce((sum, sku) =>
    sum + thesePeriods.reduce((rowTotal, period) => {
      const cell = bySkuCell.get(`${sku.id}-${period.id}`);
      return rowTotal + (Number(cell?.value ?? 0) || 0);
    }, 0), 0);
  const receiptTotals = (theseSkus: Sku[], thesePeriods: Period[]) => {
    let received = 0, unreceived = 0;
    for (const sku of theseSkus) for (const period of thesePeriods) {
      const cell = bySkuCell.get(`${sku.id}-${period.id}`);
      const lines = cell?.lines ?? [];
      if (lines.length) for (const line of lines) {
        const qty = Number(line.quantityMC) || 0;
        if (line.received) received += qty;
        else unreceived += qty;
      } else if (cell?.value != null) {
        if (cell.received) received += Number(cell.value) || 0;
        else unreceived += Number(cell.value) || 0;
      }
    }
    return { received, unreceived };
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">FOC Record</h1>
        <p className="mt-1 text-sm text-muted-foreground">Monthly free-of-charge stock by SKU. Grouped by Core/NPI and sorted by weight.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">{canEdit ? "Country administrator" : "Read only"} · stored in MC · display {unit}</span>
        {canEdit && <RecordFocDialog country={focCountry} periods={periods} skus={skus} includeFoc={true} onSaved={invalidate} />}
      </div>
    </div>
    {!canEdit && <p className="text-xs text-muted-foreground">Read-only view · quantities stored in MC · display {unit}. Only country administrators can change this record.</p>}

    {skus.length === 0 ? <div className="border border-[#e2d9d5] bg-[#fcfaf7] px-5 py-10 text-center">
      <h2 className="text-sm font-semibold">No active SKUs</h2><p className="mt-1 text-xs text-muted-foreground">Active country SKUs appear here once available.</p>
    </div> : <Card><CardContent className="p-0">
      <div className="max-h-[75vh] overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-20">
          <tr className="bg-muted">
            <th className="sticky left-0 bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[50px]">Weight</th>
            <th className="sticky left-[50px] bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px]">SKU Name</th>
            {years.map(group => {
              const isCollapsed = collapsedYears.has(group.year);
              return (
                <th
                  key={`yh-${group.year}`}
                  colSpan={isCollapsed ? 1 : group.periods.length + 1}
                  className="px-1 py-1 text-center font-bold border-l border-border text-primary cursor-pointer select-none hover:bg-muted/80 transition-colors"
                  onClick={() => setCollapsedYears(prev => { const next = new Set(prev); next.has(group.year) ? next.delete(group.year) : next.add(group.year); return next; })}
                  title={isCollapsed ? `Expand ${group.year}` : `Collapse ${group.year}`}
                >
                  <span className="inline-flex items-center gap-1 justify-center">
                    <svg className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    {group.year}
                  </span>
                </th>
              );
            })}
          </tr>
          <tr className="bg-muted border-b">
            <th className="sticky left-0 bg-muted z-30 px-2 py-1" />
            <th className="sticky left-[50px] bg-muted z-30 px-2 py-1" />
            {years.map(({ year, periods: yPeriods }) => {
              const isCollapsed = collapsedYears.has(year);
              return (
                <Fragment key={`sub-${year}`}>
                  {!isCollapsed && yPeriods.map(period => (
                    <th key={period.id} className="px-1 py-1 text-center text-muted-foreground min-w-[60px] text-[10px]">{period.label.split(" ")[0]}</th>
                  ))}
                  <th className="px-1 py-1 text-center font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-800 min-w-[70px] text-[10px]">
                    {isCollapsed ? year : "Total"}
                  </th>
                </Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {years.length === 0 && <tr><td colSpan={2} className="px-4 py-8 text-center text-xs text-muted-foreground">No forecast periods are configured.</td></tr>}
          {(["Core", "NPI"] as const).map(category => {
            const catSkus = skus.filter(sku => sku.category === category);
            if (!catSkus.length) return null;
            const weightGroups = [...new Set(catSkus.map(sku => sku.weight))];
            return <Fragment key={category}>
              <tr className={`${category === "Core" ? "bg-emerald-50" : "bg-violet-50"} cursor-pointer select-none hover:brightness-95 transition-all`}
                onClick={() => setCollapsedCategories(prev => { const next = new Set(prev); next.has(category) ? next.delete(category) : next.add(category); return next; })}>
                <td colSpan={2 + years.reduce((sum, group) => sum + (collapsedYears.has(group.year) ? 1 : group.periods.length + 1), 0)}
                  className="px-3 py-1.5 font-bold text-xs tracking-wider uppercase sticky left-0 z-10"
                  style={{ color: category === "Core" ? "#047857" : "#6d28d9" }}>
                  <span className="inline-flex items-center gap-2">
                    <svg className={`h-3.5 w-3.5 transition-transform duration-200 ${collapsedCategories.has(category) ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    {category}
                    <span className="font-normal normal-case text-[10px] text-muted-foreground">({catSkus.length} SKUs){collapsedCategories.has(category) ? " — collapsed" : ""}</span>
                  </span>
                </td>
              </tr>
              {!collapsedCategories.has(category) && weightGroups.map(weight => {
                const groupSkus = catSkus.filter(sku => sku.weight === weight);
                return <Fragment key={`${category}-${weight}`}>
                  <tr className="bg-slate-100 cursor-pointer select-none hover:bg-slate-200 transition-colors"
                    onClick={() => setCollapsedWeights(prev => { const key = `${category}-${weight}`; const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}>
                    <td colSpan={2 + years.reduce((sum, group) => sum + (collapsedYears.has(group.year) ? 1 : group.periods.length + 1), 0)}
                      className="px-4 py-1 text-xs font-semibold text-slate-600 sticky left-0 z-10">
                      <span className="inline-flex items-center gap-2">
                        <svg className={`h-3 w-3 transition-transform duration-200 ${collapsedWeights.has(`${category}-${weight}`) ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${weight === "50g" ? "bg-blue-100 text-blue-700" : weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{weight}</span>
                        <span className="text-[10px] font-normal text-muted-foreground">{groupSkus.length} SKUs{collapsedWeights.has(`${category}-${weight}`) ? " — collapsed" : ""}</span>
                      </span>
                    </td>
                  </tr>
                  {!collapsedWeights.has(`${category}-${weight}`) && groupSkus.map((sku, index) => <Fragment key={sku.id}>
                    <tr aria-label={`FOC ${sku.name} ${sku.weight} ${sku.packagingType ?? "New"}`} className={`border-b border-border hover:bg-muted ${index % 2 ? "bg-slate-50" : ""}`}>
                      <td className={`sticky left-0 ${index % 2 ? "bg-slate-50" : "bg-background"} z-10 px-2 py-1.5`}>
                        <div className="flex flex-col items-start gap-0.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${sku.weight === "50g" ? "bg-blue-100 text-blue-700" : sku.weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{sku.weight}</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${sku.packagingType === "Old" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-800"}`}>{sku.packagingType ?? "New"}</span>
                        </div>
                      </td>
                      <td title={`${sku.name} · ${sku.packagingType ?? "New"}`} className={`group/sku sticky left-[50px] ${index % 2 ? "bg-slate-50" : "bg-background"} z-10 px-2 py-1.5 font-medium whitespace-nowrap`}>
                         <span>{sku.name}</span>
                         {canEdit && <button type="button" aria-label={`Move FOC for ${sku.name} ${sku.weight} ${sku.packagingType ?? "New"} to another SKU`}
                           onClick={() => setMoveRequest({ sourceSkuId: sku.id })}
                           className="ml-2 rounded border border-primary/30 px-1.5 py-0.5 text-[9px] font-semibold text-primary opacity-100 transition-opacity hover:bg-primary/10 sm:opacity-0 group-hover/sku:opacity-100 focus:opacity-100">
                           Move to another SKU
                         </button>}
                      </td>
                      {years.map(group => <Fragment key={`${sku.id}-${group.year}`}>
                        {!collapsedYears.has(group.year) && group.periods.map(period => (
                          <FocRecordCell key={`${focCountry}-${sku.id}-${period.id}`} country={focCountry} sku={sku} period={period}
                            cell={bySkuCell.get(`${sku.id}-${period.id}`)}
                            reviewEntries={receiptEntries.filter(entry => entry.skuId === sku.id && entry.periodId === period.id && entry.needsReview)}
                            rowBg={index % 2 ? "bg-slate-50" : "bg-background"}
                             canEdit={canEdit} unit={unit} onSaved={invalidate}
                             onMove={() => setMoveRequest({ sourceSkuId: sku.id, periodId: period.id })} />
                        ))}
                        <td className="px-1 py-1.5 text-right tabular-nums font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-900">{showMonth(group.periods.reduce((sum, period) => sum + (Number(bySkuCell.get(`${sku.id}-${period.id}`)?.value ?? 0) || 0), 0))}</td>
                      </Fragment>)}
                    </tr>
                  </Fragment>)}
                </Fragment>;
              })}
              <tr className={`font-semibold ${category === "Core" ? "bg-emerald-50" : "bg-violet-50"} border-b-2`}>
                <td className="sticky left-0 z-10 px-2 py-1.5" style={{ backgroundColor: category === "Core" ? "rgb(236 253 245)" : "rgb(245 243 255)" }} />
                <td className="sticky left-[50px] z-10 px-2 py-1.5 whitespace-nowrap text-xs" style={{ color: category === "Core" ? "#047857" : "#6d28d9" }}>Subtotal {category}</td>
                {years.map(group => <Fragment key={`subtotal-${category}-${group.year}`}>
                  {!collapsedYears.has(group.year) && group.periods.map(period => <td key={period.id} className="px-1 py-1.5 text-right tabular-nums" style={{ color: category === "Core" ? "#047857" : "#6d28d9" }}>{showMonth(grand(catSkus, [period]))}</td>)}
                  <td className="px-1 py-1.5 text-right tabular-nums font-bold border-l-2 border-amber-400 bg-amber-50" style={{ color: category === "Core" ? "#047857" : "#6d28d9" }}>{showMonth(grand(catSkus, group.periods))}</td>
                </Fragment>)}
              </tr>
            </Fragment>;
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-primary bg-slate-100 font-bold">
            <td className="sticky left-0 bg-slate-100 z-10 px-2 py-2" />
            <td className="sticky left-[50px] bg-slate-100 z-10 px-2 py-2 whitespace-nowrap text-primary">Grand Total</td>
            {years.map(group => <Fragment key={`grand-${group.year}`}>
              {!collapsedYears.has(group.year) && group.periods.map(period => <td key={period.id} className="px-1 py-2 text-right tabular-nums text-primary">{showMonth(grand(skus, [period]))}</td>)}
              <td className="px-1 py-2 text-right tabular-nums font-bold border-l-2 border-amber-400 bg-amber-100 text-amber-900">{showMonth(grand(skus, group.periods))}</td>
            </Fragment>)}
          </tr>
          {(["Received", "Not received"] as const).map(status => <tr key={status} className="border-t border-border/70 bg-muted text-[10px] font-medium">
            <td className="sticky left-0 z-10 border-r border-border/70 bg-muted px-2 py-1" />
            <td className="sticky left-[50px] z-10 border-r border-border/70 bg-muted px-2 py-1">{status} total</td>
            {years.map(group => <Fragment key={`${status}-${group.year}`}>
              {!collapsedYears.has(group.year) && group.periods.map(period => {
                const split = receiptTotals(skus, [period]);
                return <td key={period.id} className="px-1 py-1 text-right tabular-nums text-muted-foreground">{showMonth(status === "Received" ? split.received : split.unreceived)}</td>;
              })}
              {(() => {
                const split = receiptTotals(skus, group.periods);
                return <td className="border-l-2 border-amber-400 bg-[#f8edcf] px-1 py-1 text-right tabular-nums text-amber-900">{showMonth(status === "Received" ? split.received : split.unreceived)}</td>;
              })()}
            </Fragment>)}
          </tr>)}
        </tfoot>
      </table>
      </div>
    </CardContent></Card>}
    {canEdit && moveRequest && <MoveFocDialog key={`${focCountry}-${moveRequest.sourceSkuId}-${moveRequest.periodId ?? "all"}`}
      country={focCountry} periods={periods} skus={skus} sourceSkuId={moveRequest.sourceSkuId} initialPeriodId={moveRequest.periodId}
      open onOpenChange={open => { if (!open) setMoveRequest(null); }} onSaved={invalidate} />}
    {skus.length > 0 && <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-[10px] text-muted-foreground">
      <span>All periods received: <strong className="text-primary">{showMonth(receiptTotals(skus, periods).received) || "0"} {unit}</strong></span>
      <span>All periods not received: <strong className="text-amber-900">{showMonth(receiptTotals(skus, periods).unreceived) || "0"} {unit}</strong></span>
    </div>}
  </div>;
}

function FocRecordCell({ country, sku, period, cell, reviewEntries, rowBg, canEdit, unit, onSaved, onMove }: {
  country: FocCountry; sku: Sku; period: Period; cell?: FocCell; reviewEntries: FocReceiptEntry[]; rowBg: string; canEdit: boolean; unit: "MC" | "KG" | "Tons"; onSaved: () => Promise<unknown>; onMove: () => void;
}) {
  const { formatVal } = useUnit();
  const previewMutation = trpc.focPlanning.previewCell.useMutation();
  const commitMutation = trpc.focPlanning.commitCell.useMutation();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<CellPreview | null>(null);
  const [change, setChange] = useState<Change>({});
  useEffect(() => { setEditing(false); setExpanded(false); setPreview(null); }, [unit]);
  const lines = cell?.lines ?? [];
  const quantity = Number(cell?.value ?? 0);
  const hasValue = cell?.value != null;
  const skuLabel = `${sku.name} ${sku.weight} ${sku.packagingType ?? "New"}`;
  const label = `${skuLabel} ${period.label}`;
  const busy = previewMutation.isPending || commitMutation.isPending;
  const request = async (operation: Change) => {
    setPreview(null);
    try {
      const result = await previewMutation.mutateAsync({
        country, skuId: sku.id, periodId: period.id, includeFoc: true, ...operation,
      });
      setChange(operation);
      setPreview(result);
    } catch (error) {
      toast.error(`FOC preview failed: ${(error as Error).message}. Nothing was changed.`);
    }
  };
  const save = async () => {
    if (!preview?.token) return;
    try {
      const result = await commitMutation.mutateAsync({
        country, skuId: sku.id, periodId: period.id, includeFoc: true, ...change, token: preview.token,
      });
      await onSaved();
      setPreview({ ...preview, versionId: result.versionId });
      setEditing(false);
      toast.success("FOC record saved.");
    } catch (error) {
      toast.error(`FOC save failed: ${(error as Error).message}. Preview again before retrying.`);
      setPreview(null);
    }
  };
  const submitQuantity = () => {
    const displayQty = draft.trim() === "" ? null : Number(draft);
    if (displayQty !== null && (!Number.isFinite(displayQty) || displayQty < 0)) {
      toast.error("Enter a valid non-negative quantity, or leave it blank.");
      return;
    }
    void request({ value: displayQty === null ? null : toMastercases(displayQty, unit) });
    setEditing(false);
  };
  const receiptToggle = lines.length ? lines.every(line => line.received) : !!cell?.received;
  const someReceived = lines.some(line => line.received) && !receiptToggle;
  const receiptRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (receiptRef.current) receiptRef.current.indeterminate = someReceived; }, [someReceived]);
  const displayQuantity = hasValue && quantity > 0 ? formatVal(quantity) : "";

  return <td className={`relative ${rowBg} px-1 py-1.5 text-right align-middle tabular-nums`} data-testid={`foc-record-${sku.id}-${period.id}`}>
    <div className="flex min-h-6 items-center justify-end gap-1">
      {editing ? <div className="flex flex-1 items-center gap-1">
        <input autoFocus type="number" min="0" step={unit === "Tons" ? "0.00001" : "0.01"} aria-label={`Edit FOC ${skuLabel} ${period.label} quantity in ${unit}`}
          value={draft} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submitQuantity(); } if (event.key === "Escape") setEditing(false); }}
          className="h-6 min-w-[5ch] flex-1 border border-primary bg-background px-1 text-right text-[10px] outline-none focus:ring-1 focus:ring-primary" />
        <button type="button" disabled={busy} onClick={submitQuantity} className="text-[9px] font-semibold text-primary underline">Preview</button>
      </div> : canEdit
        ? <button type="button" disabled={busy} title={hasValue ? exactDisplayValue(quantity, unit) : "No recorded FOC quantity"}
          aria-label={`Edit FOC ${skuLabel} ${period.label}`} onClick={() => { setDraft(hasValue ? String(fromMastercases(quantity, unit)) : ""); setEditing(true); }}
          className="flex-none whitespace-nowrap px-1 text-right text-xs text-foreground hover:bg-primary/10">{displayQuantity}</button>
        : <span title={hasValue ? exactDisplayValue(quantity, unit) : "No recorded FOC quantity"} className="flex-none whitespace-nowrap px-1 text-xs text-foreground">{displayQuantity}</span>}
      <label title={someReceived ? "Some recorded lines have been received" : "Received status"} className={`inline-flex shrink-0 items-center gap-1 text-[9px] ${receiptToggle ? "text-[#426047]" : "text-[#84643d]"}`}>
        <input ref={receiptRef} aria-label={`Received FOC ${label}`} type="checkbox" checked={receiptToggle} disabled={!canEdit || busy || quantity <= 0}
          onChange={event => void request({ received: event.target.checked })} />
        {someReceived ? "Some" : receiptToggle ? "Yes" : "No"}
      </label>
      {(lines.length > 0 || reviewEntries.length > 0 || hasValue) && <Popover open={expanded} onOpenChange={setExpanded}>
        <PopoverTrigger asChild><button type="button" title={`${lines.length} recorded line${lines.length === 1 ? "" : "s"}`}
          aria-label={`View recorded FOC lines ${label}`} aria-expanded={expanded}
          className="inline-flex shrink-0 items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{lines.length}
        </button></PopoverTrigger>
        <PopoverContent align="end" side="bottom" className="z-[55] w-[min(25rem,85vw)] max-h-[70vh] overflow-y-auto border-[#d7cec9] bg-[#fcfaf7] p-3 text-left shadow-md">
          <p className="mb-1 text-[10px] font-semibold">{skuLabel} · {period.label} <span className="font-normal text-muted-foreground">Recorded lines · MC stored</span></p>
          {canEdit && <button type="button" onClick={onMove} className="mb-2 rounded border border-primary/30 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10">Move this month to another SKU</button>}
          {lines.map(line => <FocRecordLine key={line.id} country={country} sku={sku} period={period} line={line} canEdit={canEdit} unit={unit} onSaved={onSaved} />)}
          {reviewEntries.map(entry => <div key={entry.reviewKey} className="border-t border-amber-300 py-1.5 text-[10px] text-amber-950">
            <strong>Possible duplicate receipt · {entry.quantity} MC · {entry.receiptMonth}</strong>
            {entry.matches.map((match, index) => <div key={`${match.source}-${index}`} className="text-amber-900/80">{match.source} · {match.quantity} MC · {match.date}</div>)}
            {canEdit && <div className="mt-1 flex gap-3">
              <button disabled={busy} className="underline" onClick={() => void request({ decision: "separate", reviewKey: entry.reviewKey, lineId: entry.lineId })}>Confirm separate shipment</button>
              {entry.matches.some(match => match.source.toLowerCase().includes("clearance")) && <button disabled={busy} className="underline" onClick={() => void request({ decision: "included", reviewKey: entry.reviewKey, lineId: entry.lineId })}>Already included</button>}
            </div>}
          </div>)}
          {canEdit && hasValue && <button type="button" disabled={busy} aria-label={`Delete FOC ${skuLabel} ${period.label}`}
            onClick={() => void request({ remove: true })} className="mt-2 border-t pt-2 text-[10px] text-destructive hover:underline">Delete this entire monthly FOC entry</button>}
        </PopoverContent>
      </Popover>}
    </div>
    {preview && <FocImpactConfirmation open onOpenChange={open => { if (!open) setPreview(null); }}
      title={change.decision ? "Review duplicate receipt decision" : "Review FOC record change"}
      description="Confirm the impact before saving. No changes have been saved yet."
      impacts={preview.impact ?? []} warnings={preview.warnings ?? []} includeFoc={true} unit={unit}
      busy={commitMutation.isPending} canConfirm={!!preview.canSave} onConfirm={save} versionId={preview.versionId} />}
  </td>;
}

function FocRecordLine({ country, sku, period, line, canEdit, unit, onSaved }: {
  country: FocCountry; sku: Sku; period: Period; line: NonNullable<FocCell["lines"]>[number]; canEdit: boolean; unit: "MC" | "KG" | "Tons"; onSaved: () => Promise<unknown>;
}) {
  const previewMutation = trpc.focPlanning.previewCell.useMutation();
  const commitMutation = trpc.focPlanning.commitCell.useMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(fromMastercases(Number(line.quantityMC) || 0, unit)));
  const [preview, setPreview] = useState<CellPreview | null>(null);
  const [change, setChange] = useState<Change>({});
  useEffect(() => { setEditing(false); setPreview(null); }, [unit]);
  const busy = previewMutation.isPending || commitMutation.isPending;
  const skuLabel = `${sku.name} ${sku.weight} ${sku.packagingType ?? "New"}`;
  const request = async (operation: Change) => {
    try {
      const result = await previewMutation.mutateAsync({ country, skuId: sku.id, periodId: period.id, includeFoc: true, ...operation });
      setChange(operation);
      setPreview(result);
    } catch (error) { toast.error(`FOC line preview failed: ${(error as Error).message}. Nothing was changed.`); }
  };
  const save = async () => {
    if (!preview?.token) return;
    try {
      const result = await commitMutation.mutateAsync({ country, skuId: sku.id, periodId: period.id, includeFoc: true, ...change, token: preview.token });
      await onSaved();
      setPreview({ ...preview, versionId: result.versionId });
      setEditing(false);
      toast.success("FOC line saved.");
    } catch (error) { toast.error(`FOC save failed: ${(error as Error).message}. Preview again before retrying.`); setPreview(null); }
  };
  const submit = () => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) { toast.error("Enter a valid non-negative quantity."); return; }
    void request({ lineId: line.id, value: toMastercases(value, unit) });
    setEditing(false);
  };
  return <div className="border-t border-[#e4dcd6] py-1.5 text-[10px]" aria-label={`FOC line ${line.id} for ${skuLabel} ${period.label}`}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <strong className="tabular-nums">{exactDisplayValue(Number(line.quantityMC) || 0, unit)} {unit}</strong>
      <span className={line.received ? "text-[#426047]" : "text-[#84643d]"}>{line.received ? "Received" : "Not received"}</span>
    </div>
    <div className="mt-0.5 text-muted-foreground">{line.source} · {line.accType || "No Acc Type"} · {line.salesManager || "No manager"}</div>
    <div className="text-muted-foreground">
      Original entry: {line.date || "Date unavailable"} · {line.flavor || sku.name} · {line.weight || sku.weight} · {line.packaging || sku.packagingType || "New"}
    </div>
    <div className="text-muted-foreground">Original quantity: {line.originalQuantityMC ?? line.quantityMC} MC</div>
    <div className="text-muted-foreground">{line.actor || "Unknown actor"} · {line.recordedAt ? new Date(line.recordedAt).toLocaleString() : "Time unavailable"}</div>
    {canEdit && <div className="mt-1 flex flex-wrap items-center gap-2">
      {editing ? <>
        <input aria-label={`Edit FOC line ${line.id} quantity for ${skuLabel} ${period.label} in ${unit}`} type="number" min="0" step={unit === "Tons" ? "0.00001" : "0.01"} value={draft} onChange={event => setDraft(event.target.value)} className="h-6 w-24 border bg-white px-1 text-right" />
        <button disabled={busy} onClick={submit} className="text-primary underline">Preview quantity</button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground underline">Cancel</button>
      </> : <>
        <button aria-label={`Edit FOC line ${line.id} quantity for ${skuLabel} ${period.label}`} disabled={busy} onClick={() => { setDraft(String(fromMastercases(Number(line.quantityMC) || 0, unit))); setEditing(true); }} className="text-primary underline">Edit quantity</button>
        <button disabled={busy} onClick={() => void request({ lineId: line.id, received: !line.received })} className="text-primary underline">Set {line.received ? "not received" : "received"}</button>
        <button aria-label={`Delete FOC line ${line.id} for ${skuLabel} ${period.label}`} disabled={busy} onClick={() => void request({ lineId: line.id, remove: true })} className="text-destructive underline">Delete line</button>
      </>}
    </div>}
    {preview && <FocImpactConfirmation open onOpenChange={open => { if (!open) setPreview(null); }} title="Review FOC line change"
      description="Check the impact before applying this line edit." impacts={preview.impact ?? []} warnings={preview.warnings ?? []}
      includeFoc={true} unit={unit} busy={commitMutation.isPending} canConfirm={!!preview.canSave} onConfirm={save} versionId={preview.versionId} />}
  </div>;
}
