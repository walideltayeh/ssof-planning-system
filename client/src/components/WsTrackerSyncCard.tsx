import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCountry } from "@/contexts/CountryContext";
import { toast } from "sonner";

/**
 * Syria only. Pulls the WS Tracker's Syria feed and fills this page's numbers:
 *   IMS     – what wholesalers were sold
 *   Arrival – what was received into the Lattakia warehouse
 * Check first shows exactly which cells would change; Apply writes them.
 */
type Row = {
  section: "IMS" | "Arrival";
  flavour: string;
  format: string;
  month: string;
  week?: number;
  skuLabel: string;
  periodLabel: string;
  current: number;
  next: number;
};
type Plan = {
  feed: { generatedAt: string; from: string; to: string; totals: { ims: number; arrivals: number } };
  rows: Row[];
  changed: Row[];
  unmatchedProducts: { flavour: string; format: string; qty: number; expected: string }[];
  unmatchedMonths: string[];
  syriaSkus: string[];
  clearance: {
    events: { skuLabel: string; periodLabel: string; date: string; qty: number }[];
    overflow: { skuLabel: string; date: string; qty: number }[];
    replacing: number;
    replacingQty: number;
    newQty: number;
  };
};

const mc = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function WsTrackerSyncCard({ section }: { section: "IMS" | "Arrival" }) {
  const { country } = useCountry();
  const utils = trpc.useUtils();
  const [plan, setPlan] = useState<Plan | null>(null);

  const preview = trpc.country.wsTrackerPreview.useMutation({
    onSuccess: p => {
      setPlan(p as Plan);
      const changed = (p as Plan).changed.filter(r => r.section === section).length;
      toast.success(changed ? `${changed} ${section} cells would change` : `${section} already matches the WS Tracker`);
    },
    onError: e => toast.error(e.message),
  });
  const sync = trpc.country.wsTrackerSync.useMutation({
    onSuccess: r => {
      toast.success(`WS Tracker: ${r.imsCells} IMS and ${r.arrivalCells} arrival cells written`);
      setPlan(null);
      utils.country.data.invalidate();
      utils.country.planningFg.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  if (country !== "Syria") return null;
  const mine = plan?.changed.filter(r => r.section === section) ?? [];
  const busy = preview.isPending || sync.isPending;
  const byDate = (() => {
    const m = new Map<string, Map<string, number>>();
    for (const e of plan?.clearance?.events ?? []) {
      const d = m.get(e.date) ?? new Map<string, number>();
      d.set(e.skuLabel, (d.get(e.skuLabel) ?? 0) + e.qty);
      m.set(e.date, d);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, total: [...d.values()].reduce((a, v) => a + v, 0), lines: [...d.entries()].map(([sku, qty]) => ({ sku, qty })) }));
  })();

  return (
    <Card className="mb-4">
      <CardContent className="pt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium">WS Tracker — Syria</div>
            <div className="text-xs text-muted-foreground">
              {section === "IMS"
                ? "Sales to wholesalers, per flavour and format, in mastercases."
                : "Goods received into the Lattakia warehouse, per flavour and format, in mastercases."}
              {plan ? ` Feed ${plan.feed.from} → ${plan.feed.to}, IMS ${mc(plan.feed.totals.ims)} MC, arrivals ${mc(plan.feed.totals.arrivals)} MC.` : ""}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => preview.mutate()}>
              {preview.isPending ? "Checking…" : "Check WS Tracker"}
            </Button>
            <Button size="sm" disabled={busy || !plan} onClick={() => sync.mutate()}>
              {sync.isPending ? "Writing…" : "Apply to IMS + Arrival"}
            </Button>
          </div>
        </div>

        {plan && (
          <div className="space-y-2 text-xs">
            {plan.unmatchedProducts.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                <div className="font-medium">Not written — no matching Syria SKU:</div>
                {plan.unmatchedProducts.map(u => (
                  <div key={`${u.flavour}-${u.format}`}>
                    {u.flavour} {u.format} ({mc(u.qty)} MC) — looked for “{u.expected}”
                  </div>
                ))}
                <div className="mt-1 opacity-80">Syria SKUs: {plan.syriaSkus.join(" · ")}</div>
              </div>
            )}
            {plan.unmatchedMonths.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                Months missing from Syria's period list: {plan.unmatchedMonths.join(", ")}
              </div>
            )}
            {section === "Arrival" && plan.clearance && (
              <div className="rounded border bg-muted/40 p-2 space-y-1">
                <div className="font-medium">Arrivals from the WS Tracker → "Cleared" on this page</div>
                <div>Every warehouse inbound in the WS Tracker is written as a clearance on the same date as in the tracker.</div>
                <div>
                  SSOF holds <b>{mc(plan.clearance.replacingQty)} MC</b> in {plan.clearance.replacing} clearances now.
                  {" "}<b>Apply</b> replaces them with <b>{mc(plan.clearance.newQty)} MC</b> in {plan.clearance.events.length} clearances.
                </div>
                <div className="max-h-64 overflow-auto rounded border bg-background">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Cleared date</th>
                        <th className="px-2 py-1 text-left font-medium">SKU</th>
                        <th className="px-2 py-1 text-right font-medium">MC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byDate.map(g => [
                        ...g.lines.map((l, i) => (
                          <tr key={`${g.date}-${l.sku}`} className={i === 0 ? "border-t" : ""}>
                            <td className="px-2 py-0.5">{i === 0 ? g.date : ""}</td>
                            <td className="px-2 py-0.5">{l.sku}</td>
                            <td className="px-2 py-0.5 text-right">{mc(l.qty)}</td>
                          </tr>
                        )),
                        <tr key={`${g.date}-total`} className="text-muted-foreground">
                          <td />
                          <td className="px-2 py-0.5 text-right">Total {g.date}</td>
                          <td className="px-2 py-0.5 text-right font-medium">{mc(g.total)}</td>
                        </tr>,
                      ])}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {mine.length === 0 ? (
              <div className="text-muted-foreground">No {section} cell would change.</div>
            ) : (
              <div className="max-h-64 overflow-auto rounded border">
                <table className="w-full">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">SKU</th>
                      <th className="px-2 py-1 text-left font-medium">Month</th>
                      {section === "Arrival" && <th className="px-2 py-1 text-left font-medium">Week</th>}
                      <th className="px-2 py-1 text-right font-medium">Now</th>
                      <th className="px-2 py-1 text-right font-medium">WS Tracker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map(r => (
                      <tr key={`${r.section}-${r.skuLabel}-${r.month}-${r.week ?? 0}`} className="border-t">
                        <td className="px-2 py-1">{r.skuLabel}</td>
                        <td className="px-2 py-1">{r.periodLabel}</td>
                        {section === "Arrival" && <td className="px-2 py-1">W{r.week}</td>}
                        <td className="px-2 py-1 text-right text-muted-foreground">{mc(r.current)}</td>
                        <td className="px-2 py-1 text-right font-medium">{mc(r.next)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-muted-foreground">Apply writes both sections at once, and is recorded in the audit trail.</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
