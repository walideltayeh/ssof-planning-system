import { Fragment, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUnit } from "@/contexts/UnitContext";
import { useIncludeFoc } from "@/hooks/useIncludeFoc";
import { supportsFoc, summarizeFoc, type FocCountry, type FocCell } from "@shared/performance/foc";
import { displayValue, exactDisplayValue, fromMastercases, toMastercases } from "@/lib/forecastUnits";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FocImpactConfirmation } from "./FocImpactConfirmation";
import { recordedFocLines } from "@shared/focEntry";

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
  return { ...inclusion, supported, country: target, query,
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
  const previewMutation = trpc.focPlanning.previewCell.useMutation();
  const commitMutation = trpc.focPlanning.commitCell.useMutation();
  type CellChange = { value?: number | null; received?: boolean; lineId?: string; decision?: "separate" | "included"; reviewKey?: string };
  type CellPreview = Awaited<ReturnType<typeof previewMutation.mutateAsync>> & { versionId?: number };
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<CellPreview | null>(null);
  const [change, setChange] = useState<CellChange>({});
  const cell = model.cells.find(c => c.skuId === sku.id && c.periodId === period.id);
  const receiptEntries = model.query.data?.receipts.entries.filter(c => c.skuId === sku.id && c.periodId === period.id) ?? [];
  const entry = receiptEntries.find(c => c.needsReview) ?? receiptEntries[0];
  const name = `${sku.name} ${sku.weight} ${sku.packagingType ?? "New"} ${period.label}`;
  const ready = !!model.query.data && !model.query.error;
  const disabled = !canEdit || !ready || previewMutation.isPending || commitMutation.isPending;
  const entered = cell?.value != null;
  const positive = entered && Number(cell!.value) > 0;
  const lines = cell ? recordedFocLines(cell) : [];
  const allReceived = lines.length > 0 && lines.every(line => line.received);
  const someReceived = lines.some(line => line.received) && !allReceived;
  const receiptRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (receiptRef.current) receiptRef.current.indeterminate = someReceived; }, [someReceived]);
  useEffect(() => { setEditing(false); setDraft(""); setPreview(null); setChange({}); }, [model.country, unit, model.includeFoc]);
  const requestChange = async (operation: CellChange) => {
    if (disabled) return;
    setPreview(null); setEditing(false);
    try {
      const result = await previewMutation.mutateAsync({ country: model.country, skuId: sku.id, periodId: period.id, ...operation, includeFoc: model.includeFoc });
      setPreview(result); setChange(operation); setEditing(false);
    } catch (error) { toast.error(`FOC preview failed: ${(error as Error).message}. No change was saved.`); }
  };
  const submitQuantity = () => {
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0 || toMastercases(value, unit) > 9999999999.99)) { toast.error("Enter a valid non-negative FOC quantity, or leave it blank."); return; }
    const exactValue = value === null ? null : toMastercases(value, unit);
    void requestChange({ value: exactValue });
  };
  const savePreview = async () => {
    if (!preview?.token) return;
    try {
      const result = await commitMutation.mutateAsync({ country: model.country, skuId: sku.id, periodId: period.id, ...change, includeFoc: model.includeFoc, token: preview.token });
      await model.invalidate(model.country);
      setPreview({ ...preview, versionId: result.versionId });
      toast.success("FOC change saved and recorded in version history.");
    } catch (error) { toast.error(`FOC save failed: ${(error as Error).message}. Preview again before retrying.`); setPreview(null); }
  };
  return <td className="border-b border-border/60 bg-[#f1f4f2] px-1.5 py-0.5 align-middle text-right text-[10px] text-muted-foreground" data-testid={`foc-${sku.id}-${period.id}`}>
    <div className="flex items-center justify-end gap-1">
      {editing ? <input autoFocus type="number" aria-label={`FOC quantity ${name} (${unit})`} min="0" step={unit === "Tons" ? "0.00001" : "0.01"}
        value={draft} onChange={e => setDraft(e.target.value)} onBlur={submitQuantity}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitQuantity(); } else if (e.key === "Escape") setEditing(false); }}
        className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-right text-[10px]" />
        : <button type="button" aria-label={`Edit FOC ${name}`} title={entered ? exactDisplayValue(Number(cell!.value), unit) : "No FOC quantity"} disabled={disabled} className="min-w-0 flex-1 truncate rounded px-1 text-right font-normal text-muted-foreground disabled:cursor-default"
        onClick={() => { setDraft(entered ? String(fromMastercases(Number(cell!.value), unit)) : ""); setEditing(true); setPreview(null); }}>
        {ready && positive ? displayValue(Number(cell!.value), unit) : ""}
      </button>}
      {positive && <label title={someReceived ? "Some FOC lines received" : "Received FOC"} className="inline-flex shrink-0 items-center justify-end gap-1 text-[9px] text-muted-foreground">
        <input ref={receiptRef} type="checkbox" aria-label={`Received FOC ${name}`} checked={allReceived} disabled={disabled}
          onChange={e => void requestChange({ received: e.target.checked })} />
        {someReceived ? "Some" : allReceived ? "Yes" : "No"}
      </label>}
      {lines.length > 0 && <Popover><PopoverTrigger asChild><button type="button" title="Inspect FOC lines" className="shrink-0 text-[9px] underline">Lines</button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 p-3">
          <div className="text-xs font-semibold">Recorded lines · {name}</div>
          {lines.map(line => <div key={line.id} className="border-t pt-2 text-[10px]">
            <div className="flex justify-between gap-2"><strong>{line.quantityMC} MC{line.originalQuantityMC != null && Number(line.originalQuantityMC) !== line.quantityMC ? ` · Originally recorded ${Number(line.originalQuantityMC)} MC` : ""}</strong><span>{line.received ? "Received" : "Not received"}</span></div>
            <div className="text-muted-foreground">{line.source} · {line.accType || "No Acc Type"} · {line.salesManager || "No manager"}</div>
            {line.date && <div className="text-muted-foreground">Original entry: {line.date} · {line.flavor} · {line.weight} · {line.packaging}</div>}
            <div className="text-muted-foreground">{line.actor || "Unknown actor"} · {line.recordedAt ? new Date(line.recordedAt).toLocaleString() : "Time unavailable"}</div>
            {receiptEntries.filter(receipt => receipt.needsReview && receipt.lineId === line.id).map(receipt => <div key={receipt.reviewKey} className="mt-1 rounded bg-amber-50 p-1 text-amber-900">
              <div>Possible duplicate receipt — held out of stock until review.</div>
              {canEdit && <div className="flex gap-2">
                <button disabled={disabled} className="underline" onClick={() => void requestChange({ decision: "separate", reviewKey: receipt.reviewKey, lineId: line.id })}>Confirm separate shipment</button>
                {receipt.matches.some(m => m.source.includes("clearance") || m.source === "Clearance arrival") && <button disabled={disabled} className="underline" onClick={() => void requestChange({ decision: "included", reviewKey: receipt.reviewKey, lineId: line.id })}>Already included</button>}
              </div>}
            </div>)}
            {canEdit && cell?.lines?.some(persisted => persisted.id === line.id) && <button disabled={disabled} className="mt-1 underline" onClick={() => void requestChange({ received: !line.received, lineId: line.id })}>Set this line {line.received ? "not received" : "received"}</button>}
          </div>)}
        </PopoverContent>
      </Popover>}
    {entry?.needsReview && <Popover>
      <PopoverTrigger asChild><button type="button" aria-label={`Review FOC receipt ${name}`} title="Possible duplicate — held out of stock until review." className="shrink-0 text-[9px] font-semibold text-amber-800 underline">Review</button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-amber-300 bg-amber-50 p-3">
      <div className="text-left text-xs text-amber-900" role="status">
      Possible duplicate — held out of stock until review.
      <details><summary className="cursor-pointer underline">Receipt evidence</summary>{entry.matches.map((m, i) => <div key={i}>{m.source}: {m.quantity} MC · {m.date}</div>)}</details>
        {canEdit && <div className="mt-1 space-y-1">
          <button disabled={disabled} className="block underline" onClick={() => void requestChange({ decision: "separate", reviewKey: entry.reviewKey, lineId: entry.lineId })}>Confirm separate shipment</button>
          {entry.matches.some(m => m.source.includes("clearance") || m.source === "Clearance arrival") && <button disabled={disabled} className="block underline" onClick={() => void requestChange({ decision: "included", reviewKey: entry.reviewKey, lineId: entry.lineId })}>Already included in arrival</button>}
      </div>}
      </div>
      </PopoverContent>
    </Popover>}
    </div>
    {!!preview && <FocImpactConfirmation open onOpenChange={value => { if (!value) setPreview(null); }} title={change.decision ? `Review duplicate decision: ${change.decision === "separate" ? "confirm separate shipment" : "already included"}` : "Review FOC cell change"} impacts={preview.impact ?? []} warnings={preview.warnings ?? []} includeFoc={model.includeFoc} unit={unit} busy={commitMutation.isPending} canConfirm={!!preview.canSave} onConfirm={savePreview} versionId={preview.versionId} />}
  </td>;
}
export function ForecastFocRow({ sku, years, collapsedYears, model, canEdit, ordered }: { sku: Sku; years: Years; collapsedYears: Set<number>; model: Model; canEdit: boolean; ordered: FocCell[] }) {
  const hasVisibleFoc = years.some(y => y.periods.some(p => {
    const cell = model.cells.find(c => c.skuId === sku.id && c.periodId === p.id);
    return cell?.value != null && Number(cell.value) > 0;
  }));
  if (!hasVisibleFoc) return <Fragment />;
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
  const hasHistory = model.cells.some(c => c.skuId === sku.id && c.lines?.length);
  if (!canEdit && !hasHistory) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" aria-label={`${canEdit ? "Edit" : "View"} FOC quantities for ${sku.name}`} title={canEdit ? "Edit monthly FOC quantities" : "View recorded FOC lines"} className="ml-1 shrink-0 whitespace-nowrap text-[9px] font-medium text-primary opacity-0 group-hover/sku:opacity-100 focus:opacity-100">FOC</button></DialogTrigger>
    <DialogContent className="sm:max-w-3xl">
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
