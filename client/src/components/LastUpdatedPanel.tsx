/**
 * Sidebar panel: when each accessible country's planning data was last
 * changed and by whom. The selected country is highlighted and shows the
 * full detail line; other countries show how long ago.
 */
import type { Country } from "@/contexts/CountryContext";
import { COUNTRY_CONFIG } from "@/contexts/CountryContext";
import { formatUpdateTime, updateActor, useLastUpdates } from "@/hooks/useLastUpdates";
import { describeUpdate, relativeTime } from "../../../shared/audit/lastUpdate";

export default function LastUpdatedPanel({ country }: { country: Country | null }) {
  const query = useLastUpdates();
  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/30 px-2 py-1.5" data-testid="last-updated-panel">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Last Updated</p>
      <div className="space-y-1">
        {rows.map((row) => {
          const isCurrent = row.country === country;
          const cfg = COUNTRY_CONFIG[row.country as Country];
          const tooltip = row.at
            ? `${formatUpdateTime(row.at)} by ${updateActor(row)} — ${describeUpdate(row.action ?? "", row.sheet)}`
            : "No edits, uploads or imports recorded";
          return (
            <div key={row.country} title={tooltip}>
              <div className="flex items-center gap-1.5">
                <span className={`text-[11px] truncate flex-1 ${isCurrent ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                  {cfg ? `${cfg.flag} ` : ""}{row.country}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{row.at ? relativeTime(row.at) : "no update"}</span>
              </div>
              {isCurrent && (
                <p className="text-[10px] text-muted-foreground truncate pl-0.5">
                  {row.at ? `${formatUpdateTime(row.at)} · ${updateActor(row)}` : "No edits, uploads or imports recorded"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
