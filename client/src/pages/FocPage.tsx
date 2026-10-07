import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Eraser, LockKeyhole, RotateCw, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { trpc } from "@/lib/trpc";
import { supportsFoc, mcPrecision, type FocCountry } from "@shared/performance/foc";
import { useIncludeFoc } from "@/hooks/useIncludeFoc";
import { toast } from "sonner";

export function fromMastercases(value: number, unit: "MC" | "KG" | "Tons") {
  if (unit === "KG") return value * 6;
  if (unit === "Tons") return value * 0.006;
  return value;
}

export function toMastercases(value: number, unit: "MC" | "KG" | "Tons") {
  if (unit === "KG") return mcPrecision(value / 6);
  if (unit === "Tons") return mcPrecision(value / 0.006);
  return mcPrecision(value);
}

export const displayValue = (value: number, unit: "MC" | "KG" | "Tons") => {
  const converted = fromMastercases(value, unit);
  // Five decimal places preserve the two-decimal MC ledger granularity in Tons.
  return converted.toLocaleString("en-US", { maximumFractionDigits: unit === "Tons" ? 5 : 2 });
};

export default function FocPage() {
  const { country: selectedCountry } = useCountry();
  const { isAdminFor } = useAppAuth();
  const { unit } = useUnit();
  const country = selectedCountry;
  const supported = supportsFoc(country ?? "");
  const focCountry = (supported ? country : "Libya") as FocCountry;
  const canEdit = supported && isAdminFor(focCountry);
  const { includeFoc, setIncludeFoc } = useIncludeFoc(focCountry);
  const utils = trpc.useUtils();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState("");
  const [receiptScope, setReceiptScope] = useState<{ skuId?: number; periodId?: number; received: boolean; receivedDate?: string | null; country: FocCountry; unit: string } | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState("");
  const countryRef = useRef(country);
  countryRef.current = country;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const receiptRequestRef = useRef<{ country: string | null; unit: string } | null>(null);

  const query = trpc.focPlanning.list.useQuery(
    { country: focCountry, includeFoc },
    { enabled: supported, retry: false },
  );

  useEffect(() => {
    setEditKey(null);
    setDraft("");
    setSaveError("");
    setReceiptScope(null);
    setReceiptPreview(null);
    setPreviewError("");
    receiptRequestRef.current = null;
  }, [country, unit]);

  const update = trpc.focPlanning.update.useMutation({
    onSuccess: async () => {
      setSaveError("");
      setEditKey(null);
      toast.success("Planned FOC saved");
      await invalidateReceiptData(focCountry);
    },
    onError: (error) => {
      const message = error.data?.code === "FORBIDDEN"
        ? "You do not have permission to change FOC for this country."
        : `FOC could not be saved. Check your connection and retry. ${error.message}`;
      setSaveError(message);
      toast.error(message);
    },
  });
  const invalidateReceiptData = async (target: FocCountry) => Promise.all([
    utils.focPlanning.list.invalidate({ country: target }),
    utils.country.planningFg.invalidate(),
    utils.country.performance.invalidate(),
    utils.country.intlAnalysis.invalidate({ country: target }),
    utils.country.stockLevels.invalidate({ country: target }),
    utils.country.currentMonthClosingStock.invalidate({ country: target }),
  ]);
  const receiptUpdate = trpc.focPlanning.receiptUpdate.useMutation({
    onSuccess: async (_result, variables) => {
      await invalidateReceiptData(variables.country);
      if (countryRef.current === variables.country && unitRef.current === receiptRequestRef.current?.unit)
        toast.success("Receipt status saved");
    },
    onError: (error) => toast.error(`Receipt status could not be saved: ${error.message}`),
  });
  const previewMutation = trpc.focPlanning.receiptPreview.useMutation({
    onSuccess: (result, variables) => {
      if (countryRef.current !== variables.country || unitRef.current !== unit ||
          receiptRequestRef.current?.country !== variables.country || receiptRequestRef.current?.unit !== unit) return;
      setPreviewError("");
      setReceiptPreview({ ...result, country: variables.country, unit });
    },
    onError: (error, variables) => {
      if (countryRef.current !== variables.country || unitRef.current !== receiptRequestRef.current?.unit ||
          receiptRequestRef.current?.country !== variables.country) return;
      if (receiptRequestRef.current?.country !== variables.country) return;
      setReceiptScope(null);
      setReceiptPreview(null);
      setPreviewError(error.message);
      toast.error(`Preview could not be prepared: ${error.message}`);
    },
  });
  const commitMutation = trpc.focPlanning.receiptCommit.useMutation({
    onSuccess: async (_result, variables) => {
      await invalidateReceiptData(variables.country);
      if (countryRef.current !== variables.country || unitRef.current !== receiptRequestRef.current?.unit) return;
      setReceiptPreview(null);
      setReceiptScope(null);
      receiptRequestRef.current = null;
      toast.success("Receipt updates applied");
    },
    onError: (error) => toast.error(`Receipt updates were not applied: ${error.message}`),
  });
  const reviewMutation = trpc.focPlanning.receiptReview.useMutation({
    onSuccess: async (_result, variables) => {
      await invalidateReceiptData(variables.country);
      if (countryRef.current === variables.country && unitRef.current === receiptRequestRef.current?.unit)
        toast.success("Duplicate decision saved");
    },
    onError: (error) => toast.error(`Duplicate decision could not be saved: ${error.message}`),
  });

  const cellMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const cell of query.data?.cells ?? []) map.set(`${cell.skuId}:${cell.periodId}`, cell.value === null ? null : Number(cell.value));
    return map;
  }, [query.data?.cells]);
  const skus = (query.data?.skus ?? []).filter((sku) => sku.isActive !== false);
  const periods = query.data?.periods ?? [];
  const receiptMap = useMemo(() => new Map((query.data?.cells ?? []).map((cell) => [
    `${cell.skuId}:${cell.periodId}`, cell,
  ])), [query.data?.cells]);
  const receiptDetailMap = useMemo(() => new Map(((query.data as any)?.receipts?.entries ?? []).map((entry: any) => [
    `${entry.skuId}:${entry.periodId}`, entry,
  ])), [query.data]);
  const beginReceiptPreview = (scope: { skuId?: number; periodId?: number }, received: boolean) => {
    if (!canEdit) return;
    const snapshot = { ...scope, received, country: focCountry, unit };
    receiptRequestRef.current = { country: focCountry, unit };
    setReceiptScope(snapshot);
    setReceiptPreview(null);
    setPreviewError("");
    previewMutation.mutate({ country: focCountry, ...scope, received });
  };
  const saveReceipt = (skuId: number, periodId: number, next: { received?: boolean; receivedDate?: string | null }) => {
    if (!canEdit) return;
    receiptRequestRef.current = { country: focCountry, unit };
    receiptUpdate.mutate({ country: focCountry, skuId, periodId, ...next });
  };
  const saveReceiptReview = (skuId: number, periodId: number, decision: "separate" | "included", reviewKey: string) => {
    if (!canEdit) return;
    receiptRequestRef.current = { country: focCountry, unit };
    reviewMutation.mutate({ country: focCountry, skuId, periodId, decision, reviewKey });
  };

  const beginEdit = (skuId: number, periodId: number) => {
    if (!canEdit) return;
    const key = `${skuId}:${periodId}`;
    const value = cellMap.has(key) ? cellMap.get(key) : null;
    setEditKey(key);
    setDraft(value === null || value === undefined ? "" : displayValue(value, unit));
    setSaveError("");
  };

  const save = (skuId: number, periodId: number) => {
    const key = `${skuId}:${periodId}`;
    if (editKey !== key) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      update.mutate({ country: focCountry, skuId, periodId, value: null });
      return;
    }
    const shownValue = Number(trimmed.replace(/,/g, ""));
    if (!Number.isFinite(shownValue) || shownValue < 0) {
      setSaveError("Enter a valid non-negative quantity, or clear the cell to leave it not set.");
      return;
    }
    update.mutate({ country: focCountry, skuId, periodId, value: toMastercases(shownValue, unit) });
  };

  if (!supported) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-muted/30 px-6 py-14 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Planned free product</h1>
        <p className="mt-2 text-sm text-muted-foreground">FOC planning is available only for Libya and Syria.</p>
      </div>
    );
  }

  const forbidden = query.error?.data?.code === "FORBIDDEN";
  const networkError = !!query.error && !forbidden;

  return (
    <main className="min-h-[60dvh] space-y-5">
      <header className="relative overflow-hidden rounded-2xl border border-[#7f1d1d]/15 bg-gradient-to-br from-[#fbf6f1] via-background to-[#f2e8df] px-5 py-6 md:px-8 md:py-8">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(ellipse_at_top_right,rgba(127,29,29,.11),transparent_68%)]" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7f1d1d]">Country plan · {country}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Planned free product</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Trace each free quantity to its SKU and month. These are planned allocations, not sell-out, revenue or warehouse receipts.
            </p>
          </div>
          <div className="rounded-xl border border-[#7f1d1d]/15 bg-background/75 px-4 py-3 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Entered unit</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{unit}</span>
            <span className="block text-[10px] text-muted-foreground">API ledger remains in MC</span>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {canEdit ? <span className="h-2 w-2 rounded-full bg-emerald-600" /> : <LockKeyhole className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{canEdit ? "Administrator editing enabled" : "Read-only view"}</span>
          <span className="hidden text-muted-foreground sm:inline">· Changes save as you enter them</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching} className="gap-2">
          <RotateCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#7f1d1d]/15 bg-[#f8f2ed] px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Stock basis · {includeFoc ? "confirmed FOC included" : "FOC excluded"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Only confirmed receipts with duplicate checks can add stock; awaiting quantities never affect cover.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" role="switch" aria-label="Include FOC in stock" checked={includeFoc} onChange={(event) => setIncludeFoc(event.target.checked)} className="accent-[#7f1d1d]" />
          Include FOC
        </label>
      </div>

      {saveError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{saveError}</div>}
      {forbidden && (
        <div role="alert" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><strong>Country access denied.</strong><p className="mt-1">Your access to this country may have changed. Switch to a country you can access and retry.</p></div>
        </div>
      )}
      {networkError && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
          <span>FOC data could not be loaded. Check your connection and retry.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Retry</Button>
        </div>
      )}
      {query.isLoading ? (
        <Card><CardContent className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}</CardContent></Card>
      ) : query.data ? (
        <Card className="overflow-hidden border-[#7f1d1d]/15 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm" aria-label={`Planned FOC by SKU and month for ${country}`}>
                <thead className="sticky top-0 z-10 bg-[#f4eee8]">
                  <tr>
                    <th className="sticky left-0 z-20 min-w-[230px] border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active SKU</th>
                    {periods.map((period) => <th key={period.id} className="min-w-[150px] border-b px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span className="block">{period.label}</span>
                      {canEdit && <div className="mt-1 flex justify-end gap-1 normal-case tracking-normal">
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => beginReceiptPreview({ periodId: period.id }, true)}>Mark month received</Button>
                      </div>}
                    </th>)}
                  </tr>
                </thead>
                <tbody>
                  {skus.map((sku) => (
                    <tr key={sku.id} className="border-b last:border-0 hover:bg-[#7f1d1d]/[0.025]">
                      <th scope="row" className="sticky left-0 bg-card px-4 py-3 text-left">
                        <span className="block font-medium">{sku.name}</span>
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{sku.weight} · {(sku as { packagingType?: string | null }).packagingType ?? "New"}</span>
                        {canEdit && <Button size="sm" variant="ghost" className="mt-1 h-6 px-1.5 text-[10px]" onClick={() => beginReceiptPreview({ skuId: sku.id }, true)}>Mark all months received</Button>}
                      </th>
                      {periods.map((period) => {
                        const key = `${sku.id}:${period.id}`;
                        const isSet = cellMap.has(key) && cellMap.get(key) !== null;
                        const value = cellMap.get(key);
                        const isEditing = editKey === key;
                        return (
                          <td key={period.id} className="px-2 py-2 text-right">
                            {isEditing ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  aria-label={`${sku.name} ${period.label} FOC`}
                                  autoFocus
                                  inputMode="decimal"
                                  value={draft}
                                  onChange={(event) => setDraft(event.target.value)}
                                  onBlur={() => save(sku.id, period.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") { event.preventDefault(); save(sku.id, period.id); }
                                    if (event.key === "Escape") { event.preventDefault(); setEditKey(null); }
                                  }}
                                  disabled={update.isPending}
                                  className="h-9 w-24 rounded-md border border-[#7f1d1d]/40 bg-background px-2 text-right font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-[#7f1d1d]/20"
                                />
                                <button type="button" title="Clear to Not set" aria-label={`Clear ${sku.name} ${period.label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setDraft(""); update.mutate({ country: focCountry, skuId: sku.id, periodId: period.id, value: null }); }} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                                  <Eraser className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => beginEdit(sku.id, period.id)}
                                disabled={!canEdit}
                                aria-label={`${sku.name} ${period.label}: ${isSet ? displayValue(value as number, unit) : "Not set"}${canEdit ? ", edit" : ""}`}
                                className={`group inline-flex min-h-9 min-w-[84px] items-center justify-end gap-2 rounded-md px-2 font-mono tabular-nums transition-colors ${canEdit ? "hover:bg-[#7f1d1d]/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7f1d1d]" : "cursor-default"}`}
                              >
                                <span className={isSet ? "font-medium text-foreground" : "font-sans text-xs text-muted-foreground"}>{isSet ? displayValue(value as number, unit) : "Not set"}</span>
                                {isSet && value === 0 && <Check className="h-3 w-3 text-emerald-700" aria-label="Explicit zero" />}
                              </button>
                            )}
                            <div className="mt-1 flex min-h-7 items-center justify-end gap-1.5 text-[10px]">
                              <span className="text-muted-foreground">Received?</span>
                              <select
                                aria-label={`${sku.name} ${period.label} received status`}
                                value={receiptMap.get(key)?.received ? "yes" : "no"}
                                disabled={!canEdit || !isSet || Number(value) <= 0 || receiptUpdate.isPending}
                                onChange={(event) => saveReceipt(sku.id, period.id, { received: event.target.value === "yes" })}
                                className="h-6 rounded border bg-background px-1 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="no">No</option><option value="yes">Yes</option>
                              </select>
                              <input
                                type="date"
                                aria-label={`${sku.name} ${period.label} received date`}
                                value={receiptMap.get(key)?.receivedDate ?? ""}
                                disabled={!canEdit || !isSet || Number(value) <= 0 || receiptUpdate.isPending}
                                onChange={(event) => saveReceipt(sku.id, period.id, { receivedDate: event.target.value || null })}
                                className="h-6 w-[112px] rounded border bg-background px-1 text-[9px] tabular-nums disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </div>
                            {!!receiptMap.get(key)?.received && (() => {
                              const cell = receiptMap.get(key)!;
                              const detail: any = receiptDetailMap.get(key);
                              const latestReviewKey = detail?.reviewKey as string | undefined;
                              const needsReview = !!detail?.needsReview;
                              const matchingClearance = (detail?.matches ?? []).some((match: any) => /clearance/i.test(match.source));
                              if (!needsReview && !detail?.matches?.length) return null;
                              return needsReview ? <div className="mt-1 min-w-[180px] rounded-md border border-amber-300 bg-amber-50 p-2 text-left text-[10px] text-amber-950">
                                <span className="flex items-center gap-1 font-semibold"><ShieldAlert className="h-3 w-3" /> Possible duplicate — review required</span>
                                {(detail?.matches ?? []).map((match: any, index: number) => <span key={index} className="block py-0.5">{match.source} · {match.date} · {displayValue(Number(match.quantity), unit)} {unit}</span>)}
                                <span className="block py-1">Choose whether existing stock already includes this free shipment.</span>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="outline" className="h-6 px-1.5 text-[9px]" disabled={!canEdit || !latestReviewKey || !matchingClearance} onClick={() => saveReceiptReview(sku.id, period.id, "included", latestReviewKey!)}>Already counted</Button>
                                  <Button size="sm" variant="outline" className="h-6 px-1.5 text-[9px]" disabled={!canEdit || !latestReviewKey} onClick={() => saveReceiptReview(sku.id, period.id, "separate", latestReviewKey!)}>Separate shipment</Button>
                                </div>
                              </div> : cell.receiptDecision === "included" ? <span className="mt-1 block text-[10px] text-muted-foreground">Already counted · excluded from addition</span> : cell.receiptDecision === "separate" ? <span className="mt-1 block text-[10px] text-muted-foreground">Separate shipment · included if switch is on</span> : null;
                            })()}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {skus.length === 0 && <tr><td colSpan={periods.length + 1} className="p-10 text-center text-sm text-muted-foreground">No active SKUs are available for this country.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              Blank cells are not set; entering 0 records an explicit zero. Clear a saved cell to return it to Not set. All quantities are stored in mastercases to two decimal places. Received date is optional: with no date, landing stays in the plan month; a later date shifts arrival stock to that month.
            </div>
          </CardContent>
        </Card>
      ) : null}
      {previewError && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{previewError}</div>}
      <Dialog open={!!receiptScope} onOpenChange={(open) => { if (!open && !commitMutation.isPending) { setReceiptScope(null); setReceiptPreview(null); receiptRequestRef.current = null; } }}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Review receipt changes</DialogTitle>
            <DialogDescription>
              Server preview for {receiptScope?.country}. Nothing changes until you confirm. Landing dates can move a receipt into another month.
              {receiptScope?.skuId && " This SKU-wide action covers every entered plan month, including collapsed or otherwise hidden years."}
            </DialogDescription>
            <p className="text-xs text-muted-foreground">Receipt changes affect stock only when Include FOC is on. It is currently {includeFoc ? "on" : "off"}.</p>
          </DialogHeader>
          {!receiptPreview ? <div className="space-y-3 py-4"><div className="h-5 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted" /><Button variant="outline" onClick={() => { setReceiptScope(null); setReceiptPreview(null); }}>Cancel preview</Button></div> : (
            <>
              <div className="max-h-[50dvh] overflow-auto rounded-md border">
                <table className="w-full min-w-[680px] text-xs">
                <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">SKU / plan month</th><th className="p-2 text-right">Qty ({unit})</th><th className="p-2">Status</th><th className="p-2">Received date</th><th className="p-2">Destination month (old → new)</th><th className="p-2 text-left">Warnings</th></tr></thead>
                  <tbody>{(receiptPreview.changes ?? []).map((change: any, index: number) => <tr key={`${change.skuId}-${change.periodId}-${index}`} className="border-t">
                    <td className="p-2">{change.sku ?? change.skuName ?? `SKU ${change.skuId}`} · {change.planMonth ?? change.periodLabel ?? `Period ${change.periodId}`}</td>
                    <td className="p-2 text-right font-mono tabular-nums">{displayValue(Number(change.quantity ?? change.value ?? 0), unit)}</td>
                    <td className="p-2 text-center">{change.before?.received ? "Yes" : "No"} → {change.after?.received ? "Yes" : "No"}</td>
                    <td className="p-2 text-center">{change.before?.receivedDate || "—"} → {change.after?.receivedDate || "—"}</td>
                    <td className="p-2 text-center">{change.before?.receivedDate?.slice(0, 7) ?? change.planMonth ?? "Plan month"} → {change.after?.receivedDate?.slice(0, 7) ?? change.planMonth ?? "Plan month"}</td>
                    <td className="p-2">{(change.warnings ?? change.matches?.map((match: any) => `${match.source} · ${match.date} · ${displayValue(Number(match.quantity), unit)} ${unit}`) ?? []).join(", ") || "—"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              {(receiptPreview.warnings?.length ?? 0) > 0 && <p className="text-sm text-amber-800">{receiptPreview.warnings.length} duplicate or evidence warning(s) need review; receipt quantities remain excluded pending a decision.</p>}
              {(receiptPreview.skippedNotSet ?? 0) > 0 && <p className="text-xs text-muted-foreground">{receiptPreview.skippedNotSet} unset planning cells were skipped.</p>}
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => { setReceiptScope(null); setReceiptPreview(null); }}>Cancel</Button>
                <Button disabled={!canEdit || commitMutation.isPending || receiptScope?.country !== country || receiptScope?.unit !== unit} onClick={() => receiptScope && commitMutation.mutate({ country: receiptScope.country, skuId: receiptScope.skuId, periodId: receiptScope.periodId, received: receiptScope.received, receivedDate: receiptScope.receivedDate, token: receiptPreview.token })}>
                  {commitMutation.isPending ? "Applying…" : `Confirm ${receiptPreview.changes?.length ?? 0} entries${receiptScope?.skuId ? " for all months" : ""}`}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
