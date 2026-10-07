import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { auditTrail, focData, forecastData, shipmentData, skus, ssofVersions } from "../drizzle/schema";
import { loadFocReceiptData } from "./focReceiptService";
import { evaluateFocReceipts } from "../shared/performance/focReceipts";
import { type FocCountry } from "../shared/performance/foc";
import { invalidateCountryPerformanceCache } from "./analysis/countryPerformance";
import type { ForecastFocImportCell } from "./forecastFocWorkbook";
import { changeFocCell } from "../shared/focEntry";
import { randomUUID } from "node:crypto";

export async function applyForecastFocImport(country: FocCountry, actor: string,
  forecasts: { skuId: number; periodId: number; value: string }[], free: ForecastFocImportCell[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.transaction(async tx => {
    await tx.select().from(skus).where(eq(skus.country, country)).for("update");
    const ds = await loadFocReceiptData(country, tx as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
    const allowedSkus = new Set(ds.skus.map(s => s.id)), allowedPeriods = new Set(ds.periods.map(p => p.id));
    for (const cell of [...forecasts, ...free]) {
      if (!allowedSkus.has(cell.skuId) || !allowedPeriods.has(cell.periodId))
        throw new Error("Forecast/FOC import contains an inactive or foreign SKU/month");
    }
    const existing = allowedSkus.size ? await tx.select().from(forecastData).where(inArray(forecastData.skuId, [...allowedSkus])) : [];
    const forecastMap = new Map(existing.map(c => [`${c.skuId}-${c.periodId}`, c]));
    const focMap = new Map(ds.foc.map(c => [`${c.skuId}-${c.periodId}`, c]));
    const changedForecast = forecasts.filter(c => Number(forecastMap.get(`${c.skuId}-${c.periodId}`)?.value ?? 0) !== Number(c.value));
    const nextFree = free.map(c => {
      const old = focMap.get(`${c.skuId}-${c.periodId}`);
      if (c.receiptDecision && !["pending", "included", "separate"].includes(c.receiptDecision))
        throw new Error(`Invalid duplicate decision for SKU ${c.skuId}`);
      // Spreadsheet metadata can preserve an existing decision, never invent
      // a new duplicate approval. Changed evidence is rechecked by the ledger.
      const adjusted = old?.lines?.length ? changeFocCell(old, { value: c.value === null ? null : Number(c.value),
        ...(old.received !== c.received ? { received: c.received } : {}) }, actor, new Date().toISOString(), randomUUID()) : undefined;
      return { country, skuId: c.skuId, periodId: c.periodId, value: adjusted ? adjusted.value === null ? null : String(adjusted.value) : c.value,
        received: c.value !== null && c.received,
        ...(adjusted ? { lines: adjusted.lines, received: adjusted.received } : {}),
        receiptDecision: old?.receiptDecision ?? "pending", receiptReviewKey: old?.receiptReviewKey ?? null };
    });
    const changedFree = nextFree.filter(c => {
      const old = focMap.get(`${c.skuId}-${c.periodId}`);
      return (old?.value ?? null) !== c.value || (old?.received ?? false) !== c.received;
    });
    let versionId: number | null = null;
    if (changedForecast.length || changedFree.length) {
      const snapshot = await tx.execute(sql`SELECT json_build_object(
        'skus',(SELECT coalesce(json_agg(s),'[]') FROM skus s WHERE country=${country}),
        'periods',(SELECT coalesce(json_agg(p),'[]') FROM periods p WHERE country=${country}),
        'forecast',(SELECT coalesce(json_agg(f),'[]') FROM forecast_data f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country}),
        'foc',(SELECT coalesce(json_agg(f),'[]') FROM foc_data f WHERE country=${country}),
        'ims',(SELECT coalesce(json_agg(f),'[]') FROM ims_data f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country}),
        'shipment',(SELECT coalesce(json_agg(f),'[]') FROM shipment_data f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country}),
        'arrival',(SELECT coalesce(json_agg(f),'[]') FROM arrival_data f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country}),
        'actualProduction',(SELECT coalesce(json_agg(f),'[]') FROM actual_production_data f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country}),
        'clearanceEvents',(SELECT coalesce(json_agg(f),'[]') FROM clearance_events f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country}),
        'planningFg',(SELECT coalesce(json_agg(f),'[]') FROM planning_fg_data f JOIN skus s ON s.id=f."skuId" WHERE s.country=${country})
      ) AS snapshot`);
      const [version] = await tx.insert(ssofVersions).values({ country,
        name: "Before Forecast Production / FOC import", savedBy: actor,
        description: "Rollback snapshot before importing paired ordered/FOC quantities and receipt status.",
        snapshotData: snapshot.rows[0].snapshot,
        changesSummary: { orderedCells: changedForecast.length, focCells: changedFree.length } }).returning({ id: ssofVersions.id });
      versionId = version.id;
    }
    for (const c of changedForecast) {
      const old = forecastMap.get(`${c.skuId}-${c.periodId}`);
      await tx.insert(forecastData).values(c).onConflictDoUpdate({
        target: [forecastData.skuId, forecastData.periodId], set: { value: c.value, updatedAt: new Date() },
      });
      // Preserve the existing paid-forecast → production link, but never
      // overwrite manual production on an unchanged round-trip.
      const weeks = { week1: "0", week2: "0", week3: "0", week4: "0" };
      const targetWeek = old?.targetWeek;
      weeks[targetWeek && targetWeek in weeks ? targetWeek as keyof typeof weeks : "week1"] = c.value;
      await tx.insert(shipmentData).values({ skuId: c.skuId, periodId: c.periodId, ...weeks })
        .onConflictDoUpdate({ target: [shipmentData.skuId, shipmentData.periodId],
          set: { ...weeks, updatedAt: new Date() } });
      const s = ds.skus.find(s => s.id === c.skuId)!, p = ds.periods.find(p => p.id === c.periodId)!;
      await tx.insert(auditTrail).values({ country, username: actor, action: "import", sheet: "Forecast",
        skuName: `${s.name} ${s.weight} (${s.packagingType})`, periodLabel: p.label, field: "Ordered MC",
        oldValue: old?.value ?? "0", newValue: c.value, details: "Paired Forecast Production Excel import; paid forecast only" });
    }
    for (const c of changedFree) {
      const old = focMap.get(`${c.skuId}-${c.periodId}`);
      await tx.insert(focData).values(c).onConflictDoUpdate({
        target: [focData.country, focData.skuId, focData.periodId], set: { ...c, updatedAt: new Date() },
      });
      const s = ds.skus.find(s => s.id === c.skuId)!, p = ds.periods.find(p => p.id === c.periodId)!;
      await tx.insert(auditTrail).values({ country, username: actor, action: "import", sheet: "FOC",
        skuName: `${s.name} ${s.weight} (${s.packagingType})`, periodLabel: p.label, field: "FOC quantity / receipt",
        oldValue: JSON.stringify({ value: old?.value ?? null, received: old?.received ?? false }),
        newValue: JSON.stringify({ value: c.value, received: c.received }),
        details: "Paired Forecast Production Excel import; receipt review retained and re-evaluated" });
    }
    const next = new Map(ds.foc.map(c => [`${c.skuId}-${c.periodId}`, c]));
    for (const c of nextFree) next.set(`${c.skuId}-${c.periodId}`, { ...next.get(`${c.skuId}-${c.periodId}`), ...c } as typeof ds.foc[number]);
    const warnings = evaluateFocReceipts({ ...ds, foc: [...next.values()] })
      .filter(e => e.needsReview && free.some(c => c.skuId === e.skuId && c.periodId === e.periodId))
      .map(e => `${e.sku} · ${e.receiptMonth} · ${e.quantity} MC: possible duplicate; FOC not added until admin review.`);
    return { updated: changedForecast.length + changedFree.length, versionId, warnings };
  });
  invalidateCountryPerformanceCache(country);
  return result;
}
