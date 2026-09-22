/**
 * Sidebar panel: when the selected country's planning data was last changed
 * and by whom. Strictly one country — the one chosen in the sidebar.
 */
import type { Country } from "@/contexts/CountryContext";
import { COUNTRY_CONFIG } from "@/contexts/CountryContext";
import { formatUpdateTime, updateActor, useLastUpdates } from "@/hooks/useLastUpdates";
import { describeUpdate, relativeTime } from "../../../shared/audit/lastUpdate";

export default function LastUpdatedPanel({ country }: { country: Country | null }) {
  const query = useLastUpdates();
  const row = country ? query.data?.find((r) => r.country === country) : undefined;
  if (!country || !row) return null;

  const cfg = COUNTRY_CONFIG[country];
  const tooltip = row.at
    ? `${formatUpdateTime(row.at)} by ${updateActor(row)} — ${describeUpdate(row.action ?? "", row.sheet)}`
    : "No edits, uploads or imports recorded";

  return (
    <div className="rounded-lg border bg-muted/30 px-2 py-1.5" data-testid="last-updated-panel" title={tooltip}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Last Updated</p>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold truncate flex-1">{cfg ? `${cfg.flag} ` : ""}{country}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{row.at ? relativeTime(row.at) : "no update"}</span>
      </div>
      <p className="text-[10px] text-muted-foreground truncate">
        {row.at ? `${formatUpdateTime(row.at)} · ${updateActor(row)}` : "No edits, uploads or imports recorded"}
      </p>
    </div>
  );
}
