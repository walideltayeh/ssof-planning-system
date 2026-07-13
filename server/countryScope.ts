import * as db from "./db";

/**
 * Runtime guard against cross-country data corruption: before any bulkUpsert
 * write, verify that every skuId and periodId in the batch actually belongs
 * to the target country. The ID sets are fetched fresh from the country-scoped
 * getters (independently of however the ids were produced — Excel-import name
 * resolution or ids sent directly by the client), so even if the upstream
 * logic ever regresses to a global/country-mixing lookup or a stale client
 * posts another country's ids, the write aborts loudly here and writes
 * nothing instead of silently landing rows under another country.
 *
 * @param action Label for the error message, e.g. "Import" or "Save".
 */
export async function assertRecordsScopedToCountry(
  country: string,
  sheet: string,
  records: Array<{ skuId: number; periodId: number }>,
  action: string = "Import",
): Promise<void> {
  if (records.length === 0) return;
  const [skuList, periodList] = await Promise.all([
    db.getSkusForCountry(country as any, true),
    db.getPeriodsForCountry(country as any),
  ]);
  const validSkuIds = new Set(skuList.map((s: { id: number }) => s.id));
  const validPeriodIds = new Set(periodList.map((p: { id: number }) => p.id));
  for (const r of records) {
    if (!validSkuIds.has(r.skuId)) {
      throw new Error(
        `${action} aborted (${sheet}): resolved SKU id ${r.skuId} does not belong to ${country}. ` +
          `No data was written. This indicates a country-scoping bug — please report it.`,
      );
    }
    if (!validPeriodIds.has(r.periodId)) {
      throw new Error(
        `${action} aborted (${sheet}): resolved period id ${r.periodId} does not belong to ${country}. ` +
          `No data was written. This indicates a country-scoping bug — please report it.`,
      );
    }
  }
}
