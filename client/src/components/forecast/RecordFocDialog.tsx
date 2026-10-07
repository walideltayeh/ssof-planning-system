import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useUnit } from "@/contexts/UnitContext";
import { blankFocDraft, focMonth, parseFocPaste, type FocDraft, type FocMatchSku } from "@shared/focEntry";
import type { FocCountry } from "@shared/performance/foc";
import { FocImpactConfirmation } from "./FocImpactConfirmation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FocSkuCombobox } from "./FocSkuCombobox";

type Period = { id: number; label: string; year: number; month?: number; country?: string };
export function RecordFocDialog({ country, periods, skus, includeFoc, onSaved }: { country: FocCountry; periods: Period[]; skus: FocMatchSku[]; includeFoc: boolean; onSaved: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [drafts, setDrafts] = useState<FocDraft[]>([blankFocDraft()]);
  const previewMutation = trpc.focPlanning.previewEntries.useMutation();
  const commitMutation = trpc.focPlanning.commitEntries.useMutation();
  type EntriesPreview = Awaited<ReturnType<typeof previewMutation.mutateAsync>> & { versionId?: number };
  const [paste, setPaste] = useState(""), [preview, setPreview] = useState<EntriesPreview | null>(null), [confirming, setConfirming] = useState(false);
  const { unit } = useUnit();
  const sortedPeriods = useMemo(() => periods.filter(p => !p.country || p.country === country).sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0)), [periods, country]);
  const monthNumber = (p: Period) => p.month ?? (["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex(m => p.label.toLowerCase().startsWith(m)) + 1);
  useEffect(() => { setPreview(null); setConfirming(false); setDrafts([blankFocDraft()]); setPaste(""); }, [country]);
  const clear = () => { setDrafts([blankFocDraft()]); setPaste(""); setPreview(null); setConfirming(false); };
  const edit = (index: number, key: keyof FocDraft, value: string | boolean | number | undefined) => {
    setDrafts(prev => prev.map((line, i) => i === index ? { ...line, [key]: value, error: undefined } : line));
    setPreview(null);
  };
  const selectSku = (index: number, sku: FocMatchSku | null) => {
    setDrafts(prev => prev.map((line, i) => i === index
      ? { ...line, skuId: sku?.id, flavor: sku?.name ?? "", weight: sku?.weight ?? "", packaging: sku?.packagingType ?? "New", error: undefined }
      : line));
    setPreview(null);
  };
  const periodValue = (date: string) => {
    const parsed = focMonth(date);
    if (!parsed) return "";
    const match = sortedPeriods.find(period => period.year === parsed.year && monthNumber(period) === parsed.month && (!period.country || period.country === country));
    return match ? `${match.year}-${String(monthNumber(match)).padStart(2, "0")}` : "";
  };
  const runPreview = async () => {
    try {
      const result = await previewMutation.mutateAsync({ country, lines: drafts, includeFoc });
      setPreview(result); setConfirming(true);
    } catch (error) { toast.error(`FOC preview failed: ${(error as Error).message}. Edit the entries and preview again.`); }
  };
  const save = async () => {
    if (!preview?.canSave || !preview?.token) return;
    try {
      const result = await commitMutation.mutateAsync({ country, lines: drafts, includeFoc, token: preview.token });
      await onSaved();
      setPreview({ ...preview, versionId: result.versionId });
    } catch (error) {
      toast.error(`FOC save failed: ${(error as Error).message}. This preview is stale; review and preview again.`);
      setPreview(null); setConfirming(false);
    }
  };
  const acceptPaste = () => {
    const parsed = parseFocPaste(paste);
    if (!parsed.length) { toast.error("No rows found in pasted data."); return; }
    setDrafts(parsed); setPaste(""); setPreview(null);
  };
  const matched = preview?.rows ?? [];
  const canReview = drafts.length > 0;
  return <><Dialog open={open && !confirming} onOpenChange={next => { setOpen(next); if (!next) clear(); }}>
    <DialogTrigger asChild><button type="button" className="rounded border border-emerald-700/40 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-900 hover:bg-emerald-100">Record FOC</button></DialogTrigger>
    <DialogContent className="sm:max-w-5xl">
      <DialogHeader><DialogTitle>Record free-of-charge stock</DialogTitle><DialogDescription>Each quantity is entered in MC exactly as recorded. Entries are saved together only after review.</DialogDescription></DialogHeader>
      {!confirming && <>
        <div className="grid gap-2 rounded border bg-muted/30 p-3 sm:grid-cols-[1fr_auto]">
          <label className="text-xs font-medium">Paste sheet rows <span className="font-normal text-muted-foreground">Date, Acc Type, Sales Manager, Flavor, Weight, Packaging, Quantity in MC</span>
            <textarea className="mt-1 min-h-16 w-full rounded border bg-background p-2 font-mono text-[11px]" value={paste} onChange={e => { setPaste(e.target.value); setPreview(null); }} placeholder="Paste tab-separated or CSV data with the exact headings" />
          </label>
          <button onClick={acceptPaste} disabled={!paste.trim()} className="self-end rounded border bg-background px-3 py-2 text-xs disabled:opacity-50"><Upload className="mr-1 inline h-3 w-3" />Use pasted rows</button>
        </div>
        <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
          {drafts.map((line, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded border p-2 md:grid-cols-6">
            <label className="text-[10px] text-muted-foreground">Month<select aria-label="Month" value={periodValue(line.date)} onChange={e => edit(index, "date", e.target.value)} className="mt-1 h-7 w-full rounded border bg-background px-1 text-xs"><option value="">Select month</option>
              {sortedPeriods.filter(p => !p.country || p.country === country).map(p => <option key={p.id} value={`${p.year}-${String(monthNumber(p)).padStart(2, "0")}`}>{p.label}</option>)}</select>
              {line.date && !periodValue(line.date) && <span className="mt-1 block truncate text-[9px] text-amber-800" title={line.date}>Pasted month: {line.date}</span>}
            </label>
            <label className="text-[10px] text-muted-foreground">SKU
              <FocSkuCombobox country={country} skus={skus} selectedSkuId={line.skuId} onSelect={sku => selectSku(index, sku)} />
              {!line.skuId && (line.flavor || line.weight || line.packaging) && <span className="mt-1 block truncate text-[9px] text-amber-800" title={`${line.flavor} · ${line.weight} · ${line.packaging}`}>Pasted identity: {line.flavor || "—"} · {line.weight || "—"} · {line.packaging || "—"}</span>}
            </label>
            <label className="text-[10px] text-muted-foreground">Quantity (MC)<input value={line.quantityMC} onChange={e => edit(index, "quantityMC", e.target.value)} type="number" min="0" step="0.01" className="mt-1 h-7 w-full rounded border px-1 text-xs" /></label>
            <label className="text-[10px] text-muted-foreground">Acc Type<input value={line.accType} onChange={e => edit(index, "accType", e.target.value)} className="mt-1 h-7 w-full rounded border px-1 text-xs" /></label>
            <label className="text-[10px] text-muted-foreground">Sales Manager<input value={line.salesManager} onChange={e => edit(index, "salesManager", e.target.value)} className="mt-1 h-7 w-full rounded border px-1 text-xs" /></label>
            <div className="flex items-end justify-between gap-1"><label className="mb-1 flex items-center gap-1 text-[10px]"><input type="checkbox" checked={line.received} onChange={e => edit(index, "received", e.target.checked)} />Received Yes</label><button aria-label="Remove entry" onClick={() => { setDrafts(prev => prev.filter((_, i) => i !== index)); setPreview(null); }} className="mb-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>
            {line.error && <p className="col-span-full text-[10px] text-destructive">{line.error}</p>}
          </div>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <button onClick={() => { setDrafts(prev => [...prev, blankFocDraft()]); setPreview(null); }} className="rounded border px-2 py-1.5 text-xs"><Plus className="mr-1 inline h-3 w-3" />Add entry</button>
          <span className="text-[10px] text-muted-foreground">Display unit: {unit}; manual quantities remain exact MC.</span>
          <button onClick={runPreview} disabled={!canReview || previewMutation.isPending} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">{previewMutation.isPending ? "Checking…" : "Preview all entries"}</button>
        </div>
      </>}
    </DialogContent>
  </Dialog>
      {confirming && preview && <FocImpactConfirmation open onOpenChange={value => { if (!value) { const saved = !!preview.versionId; setConfirming(false); setPreview(null); if (saved) { setOpen(false); clear(); } } }} title="Review FOC entries" description="Every row must match a unique SKU and month. Errors are shown below; nothing is saved yet." impacts={preview.impact ?? []} warnings={preview.warnings ?? []} includeFoc={includeFoc} unit={unit} busy={commitMutation.isPending} canConfirm={!!preview.canSave} versionId={preview.versionId} onConfirm={save}>
        <div className="max-h-56 overflow-auto rounded border">
          <table className="w-full text-[11px]"><thead className="sticky top-0 bg-muted"><tr>{["#", "SKU / month", "Quantity", "Received", "Acc Type", "Sales Manager", "Result"].map(h => <th key={h} className="p-1.5 text-left">{h}</th>)}</tr></thead><tbody>
            {matched.map(row => <tr key={row.row} className="border-t"><td className="p-1.5">{row.row}</td><td className="p-1.5">{row.sku ?? row.flavor} · {row.month ?? row.date}</td><td className="p-1.5 tabular-nums">{row.quantity} MC</td><td className="p-1.5">{row.received ? "Yes" : "No"}</td><td className="p-1.5">{row.accType || "—"}</td><td className="p-1.5">{row.salesManager || "—"}</td><td className={`p-1.5 ${row.errors?.length ? "text-destructive" : "text-emerald-800"}`}>{row.errors?.join(" ") || "Matched"}</td></tr>)}
          </tbody></table>
        </div>
        {(!preview.canSave || matched.some(row => row.errors?.length)) && <p className="text-xs font-medium text-destructive">Resolve every row error, then edit and run preview again.</p>}
      </FocImpactConfirmation>}
  </>;
}
