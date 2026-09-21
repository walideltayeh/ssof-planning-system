/**
 * "When was this country's data last changed, and by whom?" — shared by the
 * sidebar panel and the Country Performance page.
 */
import { trpc } from "@/lib/trpc";
import { relativeTime, type CountryLastUpdate } from "../../../shared/audit/lastUpdate";

export function useLastUpdates() {
  return trpc.country.lastUpdates.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // Imports go through plain HTTP uploads rather than tRPC mutations, so a
    // periodic refresh keeps the indicator honest without a manual reload.
    refetchInterval: 120_000,
  });
}

export function formatUpdateTime(at: string) {
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function updateActor(update: CountryLastUpdate): string {
  return update.displayName ?? update.username ?? "unknown user";
}

/** Short sentence for one country, e.g. "Last update 17 Sep 2026, 09:40 by Walid El Tayeh (5 days ago)". */
export function lastUpdateSentence(update: CountryLastUpdate | undefined): string {
  if (!update || !update.at) return "No data update recorded";
  return `Last update ${formatUpdateTime(update.at)} by ${updateActor(update)} (${relativeTime(update.at)})`;
}
