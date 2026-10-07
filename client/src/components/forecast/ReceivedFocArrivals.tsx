import { useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useUnit } from "@/contexts/UnitContext";
import { displayValue, exactDisplayValue } from "@/lib/forecastUnits";
import { mcPrecision, type FocCountry } from "@shared/performance/foc";

/** A read-only component of operational arrivals, never a clearance event. */
export function ReceivedFocArrivals({ country }: { country: FocCountry }) {
  const query = trpc.focPlanning.list.useQuery({ country, includeFoc: true }, { staleTime: 0, refetchOnWindowFocus: true });
  const { unit } = useUnit();
  const arrivals = useMemo(() => {
    const rows = new Map<string, { sku: string; month: string; received: number; added: number }>();
    for (const entry of query.data?.receipts.entries ?? []) {
      if (entry.receivedQuantity <= 0 || entry.receiptPeriodId === null) continue;
      const sku = query.data?.skus.find(s => s.id === entry.skuId);
      const key = `${entry.skuId}-${entry.receiptPeriodId}`;
      const row = rows.get(key) ?? {
        sku: sku ? `${sku.name} · ${sku.weight} · ${sku.packagingType ?? "New"}` : entry.sku,
        month: entry.receiptMonth, received: 0, added: 0,
      };
      row.received = mcPrecision(row.received + entry.receivedQuantity);
      row.added = mcPrecision(row.added + entry.added);
      rows.set(key, row);
    }
    return [...rows.entries()];
  }, [query.data]);
  const warnings = query.data?.receipts.entries.filter(e => e.received && e.needsReview) ?? [];
  if (query.error) return <p role="alert" className="text-xs text-destructive">FOC arrivals could not be loaded. Refresh before using the arrival totals.</p>;
  if (!arrivals.length && !warnings.length) return null;
  const total = mcPrecision(arrivals.reduce((sum, [, row]) => sum + row.added, 0));
  return <section aria-label="Received FOC arrivals" className="rounded border border-border bg-background">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
      <strong>FOC arrivals</strong>
      <span data-testid="foc-arrival-total" title={`${total} MC`}>Added to arrivals: {exactDisplayValue(total, unit)} {unit}</span>
      <Link href="/foc" className="text-primary underline">Open FOC Record</Link>
    </div>
    {!!warnings.length && <p role="alert" className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {warnings.length} possible duplicate FOC receipt{warnings.length === 1 ? "" : "s"} held out of arrivals. Review on FOC Record before including them.
    </p>}
    {!!arrivals.length && <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead className="bg-muted text-left"><tr><th className="px-3 py-1">SKU</th><th className="px-3 py-1">Month</th><th className="px-3 py-1 text-right">Received FOC ({unit})</th><th className="px-3 py-1 text-right">Added to arrivals ({unit})</th><th className="px-3 py-1">Source</th></tr></thead>
      <tbody>{arrivals.map(([key, row]) => <tr key={key} className="h-7 border-t" aria-label={`FOC arrival ${row.sku} ${row.month}`}>
        <td className="px-3 py-1">{row.sku}</td><td className="px-3 py-1">{row.month}</td>
        <td className="px-3 py-1 text-right tabular-nums" title={`${row.received} MC`}>{displayValue(row.received, unit)}</td>
        <td className="px-3 py-1 text-right tabular-nums" title={`${row.added} MC`}>{exactDisplayValue(row.added, unit)}</td>
        <td className="px-3 py-1 text-muted-foreground">{row.added === row.received ? "FOC Record" : "FOC Record; remainder already included in an existing arrival"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
