/**
 * One card per country the user can see: when its planning data last changed
 * and who changed it. Comes from the audit trail, so it reflects real edits,
 * uploads and imports — not page views or sign-ins.
 */
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUpdateTime, lastUpdateSentence, useLastUpdates } from "@/hooks/useLastUpdates";
import { describeUpdate, relativeTime } from "../../../../shared/audit/lastUpdate";
import type { PerformanceCountry } from "./types";

export { formatUpdateTime, lastUpdateSentence, useLastUpdates };

interface LastUpdatesStripProps {
  selected: PerformanceCountry;
  onSelect?: (country: PerformanceCountry) => void;
  className?: string;
}

export default function LastUpdatesStrip({ selected, onSelect, className }: LastUpdatesStripProps) {
  const query = useLastUpdates();
  const rows = query.data ?? [];
  if (query.isLoading) return <div className={cn("h-16 animate-pulse rounded-lg bg-muted/60", className)} aria-hidden />;
  if (query.error) return <p className={cn("text-xs text-red-700", className)}>Last-update information could not be loaded: {query.error.message}</p>;
  if (rows.length === 0) return null;

  return (
    <section className={cn("perf-no-print", className)} aria-label="Last data update by country">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Clock className="h-3.5 w-3.5" />Last data update by country</h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => {
          const isSelected = row.country === selected;
          const who = row.displayName ?? row.username;
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("font-semibold", isSelected && "text-[#7f1d1d]")}>{row.country}</span>
                <span className="text-xs text-muted-foreground">{row.at ? relativeTime(row.at) : "no update recorded"}</span>
              </div>
              {row.at ? (
                <>
                  <div className="mt-1 text-sm">{formatUpdateTime(row.at)} by <span className="font-medium">{who}</span></div>
                  <div className="truncate text-xs text-muted-foreground" title={row.details ?? undefined}>{describeUpdate(row.action ?? "", row.sheet)}</div>
                </>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">No edits, uploads or imports have been recorded for this country</div>
              )}
            </>
          );
          const cardClass = cn("rounded-lg border px-3 py-2 text-left", isSelected ? "border-[#7f1d1d]/50 bg-[#7f1d1d]/5" : "bg-card", onSelect && "transition hover:border-[#7f1d1d]/50");
          return onSelect ? (
            <button key={row.country} type="button" className={cardClass} onClick={() => onSelect(row.country as PerformanceCountry)} aria-pressed={isSelected}>{body}</button>
          ) : (
            <div key={row.country} className={cardClass}>{body}</div>
          );
        })}
      </div>
    </section>
  );
}
