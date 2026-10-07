import { Fragment, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUnit } from "@/contexts/UnitContext";
import { useIncludeFoc } from "@/hooks/useIncludeFoc";
import { supportsFoc, summarizeFoc, type FocCountry, type FocCell } from "@shared/performance/foc";
import { displayValue, fromMastercases, toMastercases } from "@/lib/forecastUnits";
import { toast } from "sonner";

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
  const figure = compact && totals.foc === null && totals.enteredFoc === 0 ? "—" : displayValue(primary, unit);
  const warning = model.includeFoc && totals.missing > 0
    ? `${totals.missing} FOC ${totals.missing === 1 ? "quantity" : "quantities"} not entered; showing the known subtotal.`
    : undefined;
  return <div
    className={`flex min-w-0 flex-col items-end justify-center leading-none tabular-nums ${muted || compact ? "text-muted-foreground" : ""}`}
    aria-label={compact ? "FOC quantity total" : "Selected-basis forecast total"}
    title={warning}
  >
    <span className={`max-w-full truncate font-bold tracking-tight ${muted || compact ? "text-muted-foreground" : "text-foreground"} ${compact ? "text-[10px]" : grand ? "text-[26px]" : prominent ? "text-[22px]" : "text-[17px]"}`} title={figure}>
      {figure}
    </span>
    {!compact && totals.enteredFoc > 0 && (
      <span className={`mt-1 max-w-full truncate font-medium ${compact ? "text-[8px]" : "text-[9px]"} ${compact ? "text-muted-foreground" : "text-emerald-800"}`} title={`FOC ${displayValue(totals.enteredFoc, unit)}`}>
        +{displayValue(totals.enteredFoc, unit)} FOC
      </span>
    )}
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
  useEffect(() => { setEditing(false); setDraft(""); }, [model.country, unit]);
  const save = async () => {
    if (disabled) return;
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0 || toMastercases(value, unit) > 9999999999.99)) {
      toast.error("Enter a valid non-negative FOC quantity, or leave the quantity blank."); return;
    }
    try { await model.quantity.mutateAsync({ country: model.country, skuId: sku.id, periodId: period.id, value: value === null ? null : toMastercases(value, unit) }); setEditing(false); } catch { /* Error remains visible via toast; retain draft. */ }
  };
  return <td className="border-b border-border/60 bg-[#f1f4f2] px-1.5 py-1 align-top text-right text-[10px] text-muted-foreground" data-testid={`foc-${sku.id}-${period.id}`}>
    {editing ? <input autoFocus aria-label={`FOC quantity ${name} (${unit})`} type="number" min="0" step={unit === "Tons" ? "0.00001" : "0.01"}
      className="w-full rounded border border-emerald-400 bg-background p-1 text-right" value={draft} disabled={model.busy}
      onChange={e => setDraft(e.target.value)} onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { e.preventDefault(); setEditing(false); } }} />
      : <button type="button" aria-label={`Edit FOC ${name}`} title={entered ? displayValue(Number(cell!.value), unit) : "No FOC quantity"} disabled={disabled} className="w-full truncate rounded px-1 text-right font-normal text-muted-foreground disabled:cursor-default"
        onClick={() => { setDraft(entered ? String(fromMastercases(Number(cell!.value), unit)) : ""); setEditing(true); }}>
        {!ready ? "—" : entered ? displayValue(Number(cell!.value), unit) : "—"}
      </button>}
    {entered && <label className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
      <input type="checkbox" aria-label={`Received FOC ${name}`} checked={cell?.received ?? false} disabled={disabled || !entered}
        onChange={e => model.receipt.mutate({ country: model.country, skuId: sku.id, periodId: period.id, received: e.target.checked })} />
      Received {cell?.received ? "Yes" : "No"}
    </label>}
    {entry?.needsReview && <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-1 text-left text-[10px] text-amber-900" role="status">
      Possible duplicate — not added to stock.
      <details><summary className="cursor-pointer underline">Receipt evidence</summary>{entry.matches.map((m, i) => <div key={i}>{m.source}: {m.quantity} MC · {m.date}</div>)}</details>
      {canEdit && <div className="mt-1 space-y-1">
        <button disabled={model.busy} className="block underline" onClick={() => model.review.mutate({ country: model.country, skuId: sku.id, periodId: period.id, decision: "separate", reviewKey: entry.reviewKey })}>Confirm separate shipment</button>
        {entry.matches.some(m => m.source.includes("clearance") || m.source === "Clearance arrival") && <button disabled={model.busy} className="block underline" onClick={() => model.review.mutate({ country: model.country, skuId: sku.id, periodId: period.id, decision: "included", reviewKey: entry.reviewKey })}>Already included in arrival</button>}
      </div>}
    </div>}
    {cell?.received && entry && !entry.needsReview && <div className="mt-1 text-[9px] text-muted-foreground">{entry.receiptMonth} · {model.includeFoc ? entry.added > 0 ? "Stock included" : "No additional FOC stock" : "FOC excluded"}</div>}
  </td>;
}
export function ForecastFocRow({ sku, years, collapsedYears, model, canEdit, ordered }: { sku: Sku; years: Years; collapsedYears: Set<number>; model: Model; canEdit: boolean; ordered: FocCell[] }) {
  return <tr aria-label={`FOC ${sku.name} ${sku.weight} ${sku.packagingType ?? "New"}`} className="border-b bg-[#f1f4f2] text-[10px] font-normal text-muted-foreground">
    <td className="sticky left-0 z-20 w-[76px] bg-[#f1f4f2] px-2 py-1 text-[10px]">{sku.weight}</td>
    <td title={`FOC ${sku.name} · ${sku.packagingType ?? "New"}`} className="sticky left-[76px] z-20 w-[232px] border-r border-[#c9d2ce] bg-[#f1f4f2] px-2 py-1 shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)]"><span>FOC</span><span className="ml-2 inline-block max-w-[174px] truncate align-middle">{sku.name} · {sku.packagingType ?? "New"}</span></td>
    {years.map(y => <Fragment key={y.year}>
      {!collapsedYears.has(y.year) && y.periods.map(p => <FocCellEditor key={`${model.country}:${sku.id}:${p.id}`} sku={sku} period={p} model={model} canEdit={canEdit} />)}
      <td className="border-l-2 border-amber-400 bg-[#f1f4f2] px-1 py-1 text-right"><ForecastFocTotals skus={[sku]} periods={y.periods} ordered={ordered} model={model} compact /></td>
    </Fragment>)}
  </tr>;
}
