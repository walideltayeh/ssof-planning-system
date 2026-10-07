import { Fragment, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUnit } from "@/contexts/UnitContext";
import { useIncludeFoc } from "@/hooks/useIncludeFoc";
import { supportsFoc, summarizeFoc, type FocCountry, type FocCell } from "@shared/performance/foc";
import { displayValue, exactDisplayValue, fromMastercases, toMastercases } from "@/lib/forecastUnits";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function useForecastFoc(country: string | null) {
  const supported = supportsFoc(country ?? "");
  const target = (supported ? country : "Libya") as FocCountry;
  const inclusion = useIncludeFoc(target);
  const utils = trpc.useUtils();
  const query = trpc.focPlanning.list.useQuery({ country: target, includeFoc: inclusion.includeFoc }, { enabled: supported, retry: false });
  const invalidate = async (c: FocCountry) => Promise.all([
    utils.focPlanning.list.invalidate({ country: c }), utils.country.data.invalidate({ country: c }),
    utils.country.planningFg.invalidate(), utils.country.performance.invalidate(), utils.country.intlAnalysis.invalidate(),
    utils.country.stockLevels.invalidate(), utils.country.currentMonthClosingStock.invalidate(),
  ]);
  const error = (e: { message: string }) => toast.error(`FOC could not be saved: ${e.message}`);
  const quantity = trpc.focPlanning.update.useMutation({ onSuccess: (_, v) => invalidate(v.country), onError: error });
  const receipt = trpc.focPlanning.receiptUpdate.useMutation({
    onSuccess: (result, v) => { if (result.warnings.length) toast.warning("Possible duplicate receipt. FOC is not added until administrator review."); return invalidate(v.country); },
    onError: error,
  });
  const review = trpc.focPlanning.receiptReview.useMutation({ onSuccess: (_, v) => invalidate(v.country), onError: error });
  return { ...inclusion, supported, country: target, query, quantity, receipt, review,
    busy: quantity.isPending || receipt.isPending || review.isPending,
    invalidate, cells: (query.data?.cells ?? []) as FocCell[] };
}
type Model = ReturnType<typeof useForecastFoc>;
type Sku = { id: number; name: string; weight: string; packagingType?: string | null; isActive?: boolean; isExcludedFromTotal?: boolean | null };
type Period = { id: number; label: string; year: number };
type Years = { year: number; periods: Period[] }[];

export function ForecastFocTotals({ skus, periods, ordered, model, prominent = false, grand = false, compact = false, muted = false }: { skus: Sku[]; periods: Period[]; ordered: FocCell[]; model: Model; prominent?: boolean; grand?: boolean; compact?: boolean; muted?: boolean }) {
  const { unit } = useUnit();
  const totals = summarizeFoc(skus.map(s => ({ ...s, isExcludedFromTotal: false })), periods, ordered, model.cells, model.includeFoc).total;
  const primary = compact ? totals.enteredFoc : model.includeFoc ? totals.knownPhysical : totals.ordered;
  const figure = primary === 0 ? "" : displayValue(primary, unit);
  const exactFigure = exactDisplayValue(primary, unit);
  const warning = model.includeFoc && totals.missing > 0
    ? `${totals.missing} FOC ${totals.missing === 1 ? "quantity" : "quantities"} not entered; showing the known subtotal.`
    : undefined;
  return <div
    className={`flex min-w-0 flex-col items-end justify-center leading-none tabular-nums ${muted || compact ? "text-muted-foreground" : ""}`}
    aria-label={compact ? "FOC quantity total" : "Selected-basis forecast total"}
    title={warning}
  >
    <span className={`max-w-full truncate font-semibold tracking-tight ${muted || compact ? "text-muted-foreground" : grand ? "text-amber-900" : prominent ? "text-white" : "text-foreground"} ${compact ? "text-[10px]" : grand ? "text-[14px]" : prominent ? "text-[13px]" : "text-[12px]"}`} title={exactFigure}>
      {figure}
    </span>
  </div>;
}
export function ForecastFocBanner({ model, canEdit }: { model: Model; canEdit: boolean }) {
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs">
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={model.includeFoc} onChange={e => model.setIncludeFoc(e.target.checked)} />Include FOC</label>
    <span>Combined basis: <strong>{model.includeFoc ? "Ordered + planned FOC" : "Ordered only — FOC excluded"}</strong>.</span>
    <span className="text-muted-foreground">{canEdit ? "Country administrator editing enabled." : "Read-only view."} FOC enters stock only when Received Yes, included and duplicate-checked. Blank quantities remain distinct from zero.</span>
    {model.query.error && <span role="alert" className="text-destructive">FOC could not be loaded. <button className="underline" onClick={() => model.query.refetch()}>Retry</button></span>}
  </div>;
}
function FocCellEditor({ sku, period, model, canEdit }: { sku: Sku; period: Period; model: Model; canEdit: boolean }) {
  const { unit } = useUnit();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const cell = model.cells.find(c => c.skuId === sku.id && c.periodId === period.id);
  const entry = model.query.data?.receipts.entries.find(c => c.skuId === sku.id && c.periodId === period.id);
  const name = `${sku.name} ${sku.weight} ${sku.packagingType ?? "New"} ${period.label}`;
  const ready = !!model.query.data && !model.query.error;
  const disabled = !canEdit || model.busy || !ready;
  const entered = cell?.value != null;
  const positive = entered && Number(cell!.value) > 0;
  useEffect(() => { setEditing(false); setDraft(""); }, [model.country, unit]);
  const save = async () => {
    if (disabled) return;
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0 || toMastercases(value, unit) > 9999999999.99)) {
      toast.error("Enter a valid non-negative FOC quantity, or leave the quantity blank."); return;
    }
    try { await model.quantity.mutateAsync({ country: model.country, skuId: sku.id, periodId: period.id, value: value === null ? null : toMastercases(value, unit) }); setEditing(false); } catch { /* Error remains visible via toast; retain draft. */ }
  };
  return <td className="border-b border-border/60 bg-[#f1f4f2] px-1.5 py-0.5 align-middle text-right text-[10px] text-muted-foreground" data-testid={`foc-${sku.id}-${period.id}`}>
    <div className="flex items-center justify-end gap-1">
    {editing ? <input autoFocus aria-label={`FOC quantity ${name} (${unit})`} type="number" min="0" step={unit === "Tons" ? "0.00001" : "0.01"}
      className="h-5 min-w-0 flex-1 rounded border border-emerald-400 bg-background px-1 text-right" value={draft} disabled={model.busy}
      onChange={e => setDraft(e.target.value)} onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { e.preventDefault(); setEditing(false); } }} />
       : <button type="button" aria-label={`Edit FOC ${name}`} title={entered ? exactDisplayValue(Number(cell!.value), unit) : "No FOC quantity"} disabled={disabled} className="min-w-0 flex-1 truncate rounded px-1 text-right font-normal text-muted-foreground disabled:cursor-default"
        onClick={() => { setDraft(entered ? String(fromMastercases(Number(cell!.value), unit)) : ""); setEditing(true); }}>
         {ready && positive ? displayValue(Number(cell!.value), unit) : ""}
      </button>}
    {positive && <label title="Received FOC" className="inline-flex shrink-0 items-center justify-end gap-1 text-[9px] text-muted-foreground">
      <input type="checkbox" aria-label={`Received FOC ${name}`} checked={cell?.received ?? false} disabled={disabled}
        onChange={e => model.receipt.mutate({ country: model.country, skuId: sku.id, periodId: period.id, received: e.target.checked })} />
       {cell?.received ? "Yes" : "No"}
    </label>}
    {entry?.needsReview && <Popover>
      <PopoverTrigger asChild><button type="button" aria-label={`Review FOC receipt ${name}`} title="Possible duplicate — not added to stock." className="shrink-0 text-[9px] font-semibold text-amber-800 underline">Review</button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-amber-300 bg-amber-50 p-3">
      <div className="text-left text-xs text-amber-900" role="status">
      Possible duplicate — not added to stock.
      <details><summary className="cursor-pointer underline">Receipt evidence</summary>{entry.matches.map((m, i) => <div key={i}>{m.source}: {m.quantity} MC · {m.date}</div>)}</details>
      {canEdit && <div className="mt-1 space-y-1">
        <button disabled={model.busy} className="block underline" onClick={() => model.review.mutate({ country: model.country, skuId: sku.id, periodId: period.id, decision: "separate", reviewKey: entry.reviewKey })}>Confirm separate shipment</button>
        {entry.matches.some(m => m.source.includes("clearance") || m.source === "Clearance arrival") && <button disabled={model.busy} className="block underline" onClick={() => model.review.mutate({ country: model.country, skuId: sku.id, periodId: period.id, decision: "included", reviewKey: entry.reviewKey })}>Already included in arrival</button>}
      </div>}
      </div>
      </PopoverContent>
    </Popover>}
    </div>
  </td>;
}
export function ForecastFocRow({ sku, years, collapsedYears, model, canEdit, ordered }: { sku: Sku; years: Years; collapsedYears: Set<number>; model: Model; canEdit: boolean; ordered: FocCell[] }) {
  const hasPositive = years.some(y => y.periods.some(p => {
    const value = model.cells.find(c => c.skuId === sku.id && c.periodId === p.id)?.value;
    return value != null && Number(value) > 0;
  }));
  if (!hasPositive) return <Fragment />;
  return <tr aria-label={`FOC ${sku.name} ${sku.weight} ${sku.packagingType ?? "New"}`} className="h-7 border-b bg-[#f1f4f2] text-[10px] font-normal text-muted-foreground">
    <td className="sticky left-0 z-20 w-[50px] border-r border-[#d7dfda] bg-[#f1f4f2] px-1 py-1 text-[10px]">{sku.weight}</td>
    <td title={`FOC ${sku.name} · ${sku.packagingType ?? "New"}`} className="sticky left-[50px] z-20 w-[180px] border-r border-[#c9d2ce] bg-[#f1f4f2] px-2 py-1 shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)]">
      <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-800">FOC</span>
      <span className="inline-block max-w-[90px] truncate align-middle">{sku.name} · {sku.packagingType ?? "New"}</span>
      <ForecastFocEditButton sku={sku} years={years} model={model} canEdit={canEdit} />
    </td>
    {years.map(y => <Fragment key={y.year}>
      {!collapsedYears.has(y.year) && y.periods.map(p => <FocCellEditor key={`${model.country}:${sku.id}:${p.id}`} sku={sku} period={p} model={model} canEdit={canEdit} />)}
      <td className="border-l-2 border-amber-400 bg-[#f1f4f2] px-1 py-1 text-right"><ForecastFocTotals skus={[sku]} periods={y.periods} ordered={ordered} model={model} compact /></td>
    </Fragment>)}
  </tr>;
}

export function ForecastFocEditButton({ sku, years, model, canEdit }: { sku: Sku; years: Years; model: Model; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" aria-label={`Edit FOC quantities for ${sku.name}`} title="Edit monthly FOC quantities" className="ml-1 shrink-0 whitespace-nowrap text-[9px] font-medium text-primary opacity-0 group-hover/sku:opacity-100 focus:opacity-100">FOC</button></DialogTrigger>
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>FOC quantities · {sku.name}</DialogTitle></DialogHeader>
      <DialogDescription className="text-xs">Enter a monthly quantity, or leave it blank. Received quantities are audited before affecting stock.</DialogDescription>
      <div className="max-h-[55vh] overflow-auto rounded border border-border">
        <table className="w-full border-separate border-spacing-0 text-xs"><thead><tr className="bg-muted text-muted-foreground">
          {years.flatMap(y => y.periods).map(p => <th key={p.id} className="min-w-24 border-b px-2 py-2 text-left font-medium">{p.label}</th>)}
        </tr></thead><tbody><tr>
          {years.flatMap(y => y.periods).map(p => <FocCellEditor key={`${model.country}:${sku.id}:${p.id}:edit`} sku={sku} period={p} model={model} canEdit={canEdit} />)}
        </tr></tbody></table>
      </div>
    </DialogContent>
  </Dialog>;
}
