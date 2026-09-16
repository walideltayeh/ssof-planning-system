// ── Arrival page (Syria / Libya / KSA) — pure helpers ───────────────────────
// Extracted from ArrivalPage so the batch-surfacing rule can be unit-tested.
//
// Background (Sept 2026 incident): production for a month was moved to other
// months after clearance events had already been logged against it. The
// Arrival page only listed batches with production > 0, so those events
// vanished from the UI — but Planning FG still summed them by cleared date,
// double-counting arrivals once they were re-entered under the right batch.
// A batch that owns clearance events must therefore ALWAYS be listed, flagged
// as "orphaned" when it has no production, so the events can be corrected.

export interface BatchSurfaceInput {
  /** Actual production (weekly entries or manual actual) for the batch. */
  actualTotal: number;
  /** Planned (forecast) production for the batch. */
  plannedTotal: number;
  /** Number of clearance events logged against this batch. */
  eventCount: number;
}

export type BatchSurfaceDecision =
  | { surface: false }
  | { surface: true; isOrphan: boolean };

/**
 * Decide whether a (sku, period) pair shows up in the Arrival batch list.
 *  - production (actual or plan) > 0  → normal batch
 *  - no production but clearance events exist → orphaned batch (must stay
 *    visible so the events can be deleted / re-entered)
 *  - nothing at all → hidden
 */
export function decideBatchSurface(input: BatchSurfaceInput): BatchSurfaceDecision {
  const hasProduction = input.actualTotal > 0 || input.plannedTotal > 0;
  if (hasProduction) return { surface: true, isOrphan: false };
  if (input.eventCount > 0) return { surface: true, isOrphan: true };
  return { surface: false };
}

export interface OrphanEventLike {
  clearedQty: string | number | null | undefined;
}

export interface OrphanSummary {
  batchCount: number;
  eventCount: number;
  totalQty: number;
}

/** Roll up orphaned batches for the warning banner. */
export function summarizeOrphans(
  orphanBatches: Array<{ events: OrphanEventLike[] }>,
): OrphanSummary {
  let eventCount = 0;
  let totalQty = 0;
  for (const b of orphanBatches) {
    for (const ev of b.events) {
      eventCount += 1;
      const q = typeof ev.clearedQty === "number" ? ev.clearedQty : parseFloat(ev.clearedQty ?? "0");
      if (Number.isFinite(q)) totalQty += q;
    }
  }
  return { batchCount: orphanBatches.length, eventCount, totalQty };
}

export interface ClearanceEventRef extends OrphanEventLike {
  skuId: number;
  periodId: number;
}

export interface OrphanClearanceReport {
  eventCount: number;
  batchCount: number;
  totalQty: number;
  /** Labels of the production periods the orphaned events are attached to. */
  periodLabels: string[];
}

/**
 * From a flat list of clearance events, pick out those attached to a batch
 * with no production (same rule as `decideBatchSurface`). Used by Planning FG
 * to warn that part of its "Actual arrivals" row comes from such events.
 *
 *  - `includeSku`    limits the report to the SKUs shown on the page
 *  - `actualFor` / `plannedFor` return the batch's production figures
 *  - `periodLabel`   resolves a period id to its label (for the message)
 */
export function collectOrphanClearances(
  events: ClearanceEventRef[],
  opts: {
    includeSku: (skuId: number) => boolean;
    actualFor: (skuId: number, periodId: number) => number;
    plannedFor: (skuId: number, periodId: number) => number;
    periodLabel: (periodId: number) => string | undefined;
  },
): OrphanClearanceReport {
  let eventCount = 0;
  let totalQty = 0;
  const batches = new Set<string>();
  const labels = new Set<string>();
  for (const ev of events) {
    if (!opts.includeSku(ev.skuId)) continue;
    const decision = decideBatchSurface({
      actualTotal: opts.actualFor(ev.skuId, ev.periodId),
      plannedTotal: opts.plannedFor(ev.skuId, ev.periodId),
      eventCount: 1,
    });
    if (!decision.surface || !decision.isOrphan) continue;
    const q = typeof ev.clearedQty === "number" ? ev.clearedQty : parseFloat(ev.clearedQty ?? "0");
    if (!Number.isFinite(q) || q <= 0) continue;
    eventCount += 1;
    totalQty += q;
    batches.add(`${ev.skuId}-${ev.periodId}`);
    const label = opts.periodLabel(ev.periodId);
    if (label) labels.add(label);
  }
  return { eventCount, batchCount: batches.size, totalQty, periodLabels: Array.from(labels) };
}
