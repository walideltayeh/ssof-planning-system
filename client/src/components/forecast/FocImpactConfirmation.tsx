import { exactDisplayValue } from "@/lib/forecastUnits";
import type { FocReceiptEntry } from "@shared/performance/focReceipts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReactNode } from "react";

type Impact = {
  sku: string; month: string; before: number; after: number;
  beforeArrivals: number; afterArrivals: number;
};

export function FocImpactConfirmation({ open, onOpenChange, title = "Review FOC change", description, impacts = [], warnings = [], includeFoc, unit: displayUnit = "MC", busy, canConfirm = true, onConfirm, versionId, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  impacts?: Impact[];
  warnings?: FocReceiptEntry[];
  includeFoc: boolean;
  unit?: "MC" | "KG" | "Tons";
  busy?: boolean;
  canConfirm?: boolean;
  onConfirm: () => void;
  versionId?: number;
  children?: ReactNode;
}) {
  const unit = displayUnit;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent overlayClassName="z-[60]" className="z-[60] sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{versionId ? "FOC saved" : title}</DialogTitle>
        <DialogDescription>{versionId ? `Recorded as version ${versionId}.` : description ?? "Review the exact stock effect before confirming. No changes have been saved yet."}</DialogDescription>
      </DialogHeader>
      {versionId ? <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">All entries were saved atomically. Version <strong>{versionId}</strong>.</div> : <>
        {!includeFoc && <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Include FOC is off. These entries will be recorded, but will not affect the displayed stock basis until FOC is included.</div>}
        {children}
        <div className="max-h-56 overflow-auto rounded border">
          {impacts.length ? <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="p-2 text-left">SKU · month</th><th className="p-2 text-right">Closing stock ({unit})</th><th className="p-2 text-right">Arrivals ({unit})</th></tr></thead>
            <tbody>{impacts.map((impact, i) => <tr key={`${impact.sku}-${impact.month}-${i}`} className="border-t">
              <td className="p-2">{impact.sku}<span className="ml-1 text-muted-foreground">{impact.month}</span></td>
              <td className="p-2 text-right tabular-nums" title={`${exactDisplayValue(impact.before, unit)} ${unit} → ${exactDisplayValue(impact.after, unit)} ${unit}`}>{exactDisplayValue(impact.before, unit)} → <strong>{exactDisplayValue(impact.after, unit)}</strong></td>
              <td className="p-2 text-right tabular-nums" title={`${exactDisplayValue(impact.beforeArrivals, unit)} ${unit} → ${exactDisplayValue(impact.afterArrivals, unit)} ${unit}`}>{exactDisplayValue(impact.beforeArrivals, unit)} → <strong>{exactDisplayValue(impact.afterArrivals, unit)}</strong></td>
            </tr>)}</tbody>
          </table> : <p className="p-3 text-xs text-muted-foreground">No change to closing stock.</p>}
        </div>
        {!!warnings.length && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <strong>Possible duplicate receipts are held out of stock until review.</strong>
          <ul className="mt-1 space-y-2">{warnings.map((warning, i) => <li key={`${warning.reviewKey}-${warning.lineId ?? i}`} className="border-t border-amber-200 pt-1">
            <div className="font-medium">{warning.sku} · {warning.receiptMonth} · {warning.quantity} MC{warning.lineId ? ` · line ${warning.lineId.slice(0, 8)}` : ""}</div>
            {warning.matches.map((match, index) => <div key={`${match.source}-${match.date}-${index}`} className="text-amber-900/80">{match.source} · {match.quantity} MC · {match.date}</div>)}
          </li>)}</ul>
        </div>}
      </>}
      <DialogFooter>
        {versionId ? <button className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={() => onOpenChange(false)}>Done</button> : <>
          <button disabled={busy} className="rounded border px-3 py-2 text-xs" onClick={() => onOpenChange(false)}>Back</button>
          <button disabled={busy || !canConfirm} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={onConfirm}>{busy ? "Saving…" : "Confirm and save"}</button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
