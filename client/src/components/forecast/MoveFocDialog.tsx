import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { FocMatchSku } from "@shared/focEntry";
import type { FocCountry } from "@shared/performance/foc";
import { useUnit } from "@/contexts/UnitContext";
import { trpc } from "@/lib/trpc";
import { exactDisplayValue } from "@/lib/forecastUnits";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FocImpactConfirmation } from "./FocImpactConfirmation";
import { FocSkuCombobox } from "./FocSkuCombobox";

type Period = { id: number; label: string; year: number; sortOrder: number; month?: number; country?: string };
type SelectionMode = "all" | "selected" | "range";

export function MoveFocDialog({
  country,
  periods,
  skus,
  sourceSkuId,
  initialPeriodId,
  open,
  onOpenChange,
  onSaved,
}: {
  country: FocCountry;
  periods: Period[];
  skus: FocMatchSku[];
  sourceSkuId: number;
  initialPeriodId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  const { unit } = useUnit();
  const previewMutation = trpc.focPlanning.previewMove.useMutation();
  const commitMutation = trpc.focPlanning.commitMove.useMutation();
  type MovePreview = Awaited<ReturnType<typeof previewMutation.mutateAsync>> & { versionId?: number };
  const sortedPeriods = useMemo(
    () => periods.filter(period => !period.country || period.country === country)
      .slice().sort((a, b) => a.year - b.year || a.sortOrder - b.sortOrder),
    [periods, country],
  );
  const [targetSkuId, setTargetSkuId] = useState<number | undefined>();
  const [mode, setMode] = useState<SelectionMode>("all");
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<number[]>([]);
  const [rangeStartId, setRangeStartId] = useState<number | undefined>();
  const [rangeEndId, setRangeEndId] = useState<number | undefined>();
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const requestId = useRef(0);
  const busy = previewMutation.isPending || commitMutation.isPending;
  const sourceSku = skus.find(sku => sku.id === sourceSkuId);
  const selectedMonths = useMemo(() => {
    if (mode === "all") return undefined;
    if (mode === "selected") return selectedPeriodIds;
    const start = sortedPeriods.findIndex(period => period.id === rangeStartId);
    const end = sortedPeriods.findIndex(period => period.id === rangeEndId);
    if (start < 0 || end < 0) return [];
    return sortedPeriods.slice(Math.min(start, end), Math.max(start, end) + 1).map(period => period.id);
  }, [mode, selectedPeriodIds, rangeStartId, rangeEndId, sortedPeriods]);

  const clearPreview = () => {
    requestId.current += 1;
    setPreview(null);
    setConfirming(false);
  };
  const reset = () => {
    clearPreview();
    setTargetSkuId(undefined);
    const initial = initialPeriodId && sortedPeriods.some(period => period.id === initialPeriodId) ? initialPeriodId : undefined;
    setMode(initial ? "selected" : "all");
    setSelectedPeriodIds(initial ? [initial] : []);
    setRangeStartId(initial ?? sortedPeriods[0]?.id);
    setRangeEndId(initial ?? sortedPeriods[sortedPeriods.length - 1]?.id);
  };

  useEffect(() => {
    if (open) reset();
    else clearPreview();
    // Opening a move always starts from the latest source/period/country/unit context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceSkuId, initialPeriodId, country, unit]);

  const runPreview = async () => {
    if (!targetSkuId || targetSkuId === sourceSkuId) return;
    if (mode !== "all" && !selectedMonths?.length) {
      toast.error("Select at least one month to move.");
      return;
    }
    const request = ++requestId.current;
    setPreview(null);
    setConfirming(false);
    try {
      const result = await previewMutation.mutateAsync({
        country,
        sourceSkuId,
        targetSkuId,
        ...(selectedMonths ? { periodIds: selectedMonths } : {}),
      });
      if (request !== requestId.current) return;
      setPreview(result);
      setConfirming(true);
    } catch (error) {
      if (request === requestId.current) toast.error(`FOC move preview failed: ${(error as Error).message}. Nothing was changed.`);
    }
  };

  const save = async () => {
    if (!preview?.token || !preview.canSave || !targetSkuId) return;
    try {
      const result = await commitMutation.mutateAsync({
        country,
        sourceSkuId,
        targetSkuId,
        ...(selectedMonths ? { periodIds: selectedMonths } : {}),
        token: preview.token,
      });
      await onSaved();
      setPreview({ ...preview, versionId: result.versionId });
      toast.success("FOC quantities moved and saved.");
    } catch (error) {
      toast.error(`FOC move failed: ${(error as Error).message}. Preview again before retrying.`);
      clearPreview();
    }
  };

  const changeSelection = (change: () => void) => {
    clearPreview();
    change();
  };
  const move = preview?.move;
  const format = (value: number) => `${exactDisplayValue(Number(value) || 0, unit)} ${unit}`;
  const fullLabel = (sku: FocMatchSku | undefined, fallback?: string) =>
    sku ? `${sku.name} · ${sku.weight} · ${sku.packagingType ?? "New"}` : fallback ?? "SKU";
  const monthLabel = (periodId: number, month?: string) =>
    month ?? sortedPeriods.find(period => period.id === periodId)?.label ?? `Period ${periodId}`;

  return <>
    <Dialog open={open && !confirming} onOpenChange={value => { if (!value) onOpenChange(false); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move FOC to another SKU</DialogTitle>
          <DialogDescription>Move recorded monthly FOC from one active SKU to another. Source line details stay unchanged.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded border border-border bg-muted/30 p-3 text-xs">
            <span className="font-medium text-muted-foreground">Moving from</span>
            <p className="mt-1 font-semibold">{fullLabel(sourceSku)}</p>
          </div>
          <label className="block text-xs font-medium">Move to
            <FocSkuCombobox country={country} skus={skus} selectedSkuId={targetSkuId} onSelect={sku => changeSelection(() => setTargetSkuId(sku?.id))} />
          </label>
          {targetSkuId === sourceSkuId && <p className="text-xs text-destructive">Choose a different target SKU.</p>}

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold">Months to move</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {([
                ["all", "All months"],
                ["selected", "Selected months"],
                ["range", "Month range"],
              ] as const).map(([value, label]) => <label key={value} className="inline-flex items-center gap-1.5">
                <input type="radio" name={`move-mode-${sourceSkuId}`} checked={mode === value} onChange={() => changeSelection(() => setMode(value))} />
                {label}
              </label>)}
            </div>
            {mode === "selected" && <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded border bg-background p-2 sm:grid-cols-3">
              {sortedPeriods.map(period => <label key={period.id} className="inline-flex items-center gap-1.5 text-[11px]">
                <input type="checkbox" checked={selectedPeriodIds.includes(period.id)} onChange={event => changeSelection(() => setSelectedPeriodIds(previous => event.target.checked
                  ? [...previous, period.id]
                  : previous.filter(id => id !== period.id)))} />
                {period.label}
              </label>)}
            </div>}
            {mode === "range" && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-muted-foreground">From
                <select value={rangeStartId ?? ""} onChange={event => changeSelection(() => setRangeStartId(Number(event.target.value) || undefined))} className="mt-1 h-8 w-full rounded border bg-background px-2 text-xs">
                  {sortedPeriods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-muted-foreground">Through
                <select value={rangeEndId ?? ""} onChange={event => changeSelection(() => setRangeEndId(Number(event.target.value) || undefined))} className="mt-1 h-8 w-full rounded border bg-background px-2 text-xs">
                  {sortedPeriods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}
                </select>
              </label>
            </div>}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-[10px] text-muted-foreground">Quantity display: {unit}; FOC quantities remain stored in MC.</p>
            <Button type="button" disabled={busy || !targetSkuId || targetSkuId === sourceSkuId || (mode !== "all" && !selectedMonths?.length)}
              onClick={() => void runPreview()} className="gap-2">
              <ArrowRightLeft className="h-3.5 w-3.5" />{previewMutation.isPending ? "Checking move…" : "Preview move"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {confirming && preview && <FocImpactConfirmation
      open
      onOpenChange={value => {
        if (!value) {
          const saved = !!preview.versionId;
          setConfirming(false);
          setPreview(null);
          if (saved) onOpenChange(false);
        }
      }}
      title="Review FOC reassignment"
      description="Review the affected months, combined target totals and stock impact before confirming. No changes have been saved yet."
      impacts={preview.impact ?? []}
      warnings={preview.warnings ?? []}
      includeFoc={true}
      unit={unit}
      busy={commitMutation.isPending}
      canConfirm={!!preview.canSave}
      onConfirm={() => void save()}
      versionId={preview.versionId}
    >
      {move && <div className="space-y-3">
        <div className="grid gap-2 rounded border bg-muted/30 p-3 text-xs sm:grid-cols-2">
          <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Source</p><p className="font-semibold">{fullLabel(sourceSku, move.sourceSku)}</p>
            <p className="mt-1 text-muted-foreground">Total before → after: <strong className="text-foreground">{format(move.sourceTotalBefore)} → {format(move.sourceTotalAfter)}</strong></p></div>
          <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Target</p><p className="font-semibold">{fullLabel(skus.find(sku => sku.id === targetSkuId), move.targetSku)}</p>
            <p className="mt-1 text-muted-foreground">Total before → after: <strong className="text-foreground">{format(move.targetTotalBefore)} → {format(move.targetTotalAfter)}</strong></p></div>
        </div>
        <div className="max-h-56 overflow-auto rounded border">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-muted"><tr>
              <th className="p-2 text-left">Month</th><th className="p-2 text-right">Moving quantity ({unit})</th>
              <th className="p-2 text-right">Received ({unit})</th><th className="p-2 text-right">Source before → after ({unit})</th>
              <th className="p-2 text-right">Target before → after ({unit})</th><th className="p-2 text-right">Lines before → after</th>
            </tr></thead>
            <tbody>{move.months.map(month => <tr key={month.periodId} className="border-t">
              <td className="p-2">{monthLabel(month.periodId, month.month)}</td>
              <td className="p-2 text-right tabular-nums">{format(month.quantityMC)}</td>
              <td className="p-2 text-right tabular-nums">{format(month.receivedMC)}</td>
              <td className="p-2 text-right tabular-nums">{format(month.sourceBefore)} → <strong>{format(month.sourceAfter)}</strong></td>
              <td className="p-2 text-right tabular-nums">{format(month.targetBefore)} → <strong>{format(month.targetAfter)}</strong></td>
              <td className="p-2 text-right tabular-nums">{month.targetLineCount} → <strong>{month.resultLineCount}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground">Target totals include any existing FOC; the resulting quantity shows the combined amount after this move. Existing target lines may merge by SKU and month.</p>
      </div>}
    </FocImpactConfirmation>}
  </>;
}
