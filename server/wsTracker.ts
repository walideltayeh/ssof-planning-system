/**
 * WS Tracker → SSOF, Syria only.
 *
 * The WS Tracker (wholesaler stock counts plus the movements the accountant
 * enters) publishes a Syria feed:
 *   IMS      – what wholesalers were sold
 *   Arrivals – what was received into the Lattakia warehouse
 * Both per flavour, per format, per month, in mastercases, with the
 * Lebanon-warning pack merged into its parent product.
 *
 * We only READ that feed. The tracker never writes into SSOF, and nothing here
 * touches a country other than Syria.
 *
 * The one thing SSOF sends the tracker is its list of active Syria SKUs
 * (pushSkusToTracker), so a new SKU can be entered in the tracker's Entry tab
 * before it exists in the warehouse ledger. Movements entered there for such a
 * SKU come back in the feed with its SSOF id (ssofSkuId) and are matched by id.
 *
 * Configuration (Replit secrets / env):
 *   WS_TRACKER_FEED_URL   e.g. https://ws-syria.higgsfield.app/api/ssof
 *   WS_TRACKER_FEED_KEY   the feed key, sent as the x-ssof-key header
 */
import * as db from "./db";
import type { Country } from "../drizzle/schema";
import { persistTrackerSync } from "./wsTrackerPersistence";
import { getFocPlanning } from "./focPlanning";
import { fgProductionMap } from "../shared/arrivalQuantities";

export const WS_TRACKER_COUNTRY: Country = "Syria";

/** ssofSkuId is set when the tracker product IS an SSOF SKU it was sent (not one of the SKU_MAP products). */
export type FeedLine = { flavour: string; format: string; month: string; week?: number; qty: number; ssofSkuId?: number };
export type Feed = {
  country: string;
  unit: string;
  generatedAt: string;
  period: { from: string; to: string; firstMovement: string; lastMovement: string };
  products: { flavour: string; format: string; trackerProducts: string[]; ssofSkuId?: number }[];
  ims: FeedLine[];
  arrivals: FeedLine[];
  arrivalMovements: { date: string; flavour: string; format: string; qty: number; ssofSkuId?: number }[];
  totals: { ims: number; arrivals: number };
};

/**
 * Tracker flavour + format → the Syria SKU it belongs to.
 * "Double Apple 50g Old" is the old red pack, which the tracker still calls Red;
 * the black pack (and its Lebanon-warning twin) is the New one.
 */
export const SKU_MAP: { flavour: string; format: string; name: string; weight: string; packagingType?: "New" | "Old" }[] = [
  { flavour: "Two Apples Black", format: "50g", name: "Double Apple", weight: "50g", packagingType: "New" },
  { flavour: "Red", format: "50g", name: "Double Apple", weight: "50g", packagingType: "Old" },
  { flavour: "Two Apples", format: "250g", name: "Double Apple", weight: "250g", packagingType: "New" },
  { flavour: "Two Apples", format: "Kg", name: "Double Apple", weight: "1kg", packagingType: "New" },
  { flavour: "Two Apples Frosty", format: "50g", name: "Double Apple Frosty", weight: "50g" },
  // the tracker called this flavour "Two Apples Iced" until 24 Sep 2026; keep reading the old name
  { flavour: "Two Apples Iced", format: "50g", name: "Double Apple Frosty", weight: "50g" },
  { flavour: "Grape", format: "50g", name: "Grape", weight: "50g" },
  { flavour: "Grape", format: "250g", name: "Grape", weight: "250g" },
  { flavour: "Grape", format: "Kg", name: "Grape", weight: "1kg" },
  { flavour: "Grape & Mint", format: "50g", name: "Grape and Mint", weight: "50g" },
  { flavour: "Love", format: "50g", name: "Magic Love", weight: "50g" },
  { flavour: "Blueberry", format: "50g", name: "Blueberry", weight: "50g" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const weightKey = (w: string) => norm(w).replace(/^1kg$/, "kg");

/** Never choose a near match or whichever packaging happens to be first. */
export function resolveTrackerSku<T extends { name: string; weight: string; packagingType?: string | null }>(
  product: { flavour: string; format: string }, skus: T[],
): T | undefined {
  const mapping = SKU_MAP.find(m => norm(m.flavour) === norm(product.flavour) && weightKey(m.format) === weightKey(product.format));
  if (!mapping) return undefined;
  const matches = skus.filter(s => norm(s.name) === norm(mapping.name) && weightKey(s.weight) === weightKey(mapping.weight)
    && norm(s.packagingType ?? "") === norm(mapping.packagingType ?? "New"));
  return matches.length === 1 ? matches[0] : undefined;
}

export function isTrackerClearance(event: { country?: string; notes?: string | null; containerRef?: string | null }) {
  return event.country === "Syria" && event.notes === "WS Tracker" && event.containerRef === "WST";
}
export const trackerBusinessDate = (value: string | Date | null | undefined) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);

export function validateTrackerFeed(f: Feed) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!f?.period || !f.totals || !Array.isArray(f.products) || !Array.isArray(f.ims)
    || !Array.isArray(f.arrivals) || !Array.isArray(f.arrivalMovements)
    || !Number.isFinite(f.totals.ims) || !Number.isFinite(f.totals.arrivals))
    throw new Error("Tracker feed is missing required arrays or finite MC totals");
  if (f.country !== "Syria" || f.unit !== "MC" || !month.test(f.period.from) || !month.test(f.period.to) || f.period.from > f.period.to)
    throw new Error("Invalid Syria tracker country, units or date range");
  const totals = { ims: 0, arrivals: 0 };
  const weekly = new Map<string, number>(), dated = new Map<string, number>();
  const key = (l: { flavour: string; format: string }, m: string) => `${norm(l.flavour)}|${weightKey(l.format)}|${m}`;
  for (const section of ["ims", "arrivals"] as const) for (const l of f[section]) {
    if (!month.test(l.month) || l.month < f.period.from || l.month > f.period.to || !Number.isFinite(l.qty) || l.qty < 0)
      throw new Error("Invalid tracker quantity or month; no sync was applied");
    if (l.week !== undefined && (!Number.isInteger(l.week) || l.week < 1 || l.week > 5))
      throw new Error("Invalid tracker week; expected 1–5, with weeks 4–5 in the final SSOF bucket");
    totals[section] += l.qty;
    if (section === "arrivals") weekly.set(key(l, l.month), (weekly.get(key(l, l.month)) ?? 0) + l.qty);
  }
  for (const l of f.arrivalMovements ?? []) {
    const d = new Date(`${l.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== l.date
      || l.date.slice(0, 7) < f.period.from || l.date.slice(0, 7) > f.period.to || !Number.isFinite(l.qty) || l.qty < 0)
      throw new Error("Invalid tracker delivery date or quantity");
    dated.set(key(l, l.date.slice(0, 7)), (dated.get(key(l, l.date.slice(0, 7))) ?? 0) + l.qty);
  }
  for (const section of ["ims", "arrivals"] as const) if (Math.abs(totals[section] - f.totals[section]) > 0.005)
    throw new Error(`Tracker ${section} line totals do not match its declared total`);
  for (const k of new Set([...weekly.keys(), ...dated.keys()])) if (Math.abs((weekly.get(k) ?? 0) - (dated.get(k) ?? 0)) > 0.005)
    throw new Error(`Tracker weekly inbound and dated deliveries disagree for ${k}; sync blocked`);
}

export type SyncRow = {
  section: "IMS" | "Arrival";
  flavour: string;
  format: string;
  month: string;
  week?: number;
  skuId: number;
  skuLabel: string;
  periodId: number;
  periodLabel: string;
  current: number;
  next: number;
};

export type SyncPlan = {
  managedSkuIds?: number[];
  feed: { generatedAt: string; from: string; to: string; totals: { ims: number; arrivals: number } };
  rows: SyncRow[];
  changed: SyncRow[];
  unmatchedProducts: { flavour: string; format: string; qty: number; expected: string }[];
  unmatchedMonths: string[];
  syriaSkus: string[];
  clearance: {
    events: { skuId: number; skuLabel: string; periodId: number; periodLabel: string; date: string; qty: number }[];
    overflow: { skuLabel: string; date: string; qty: number }[];
    replacing: number;
    replacingQty: number;
    newQty: number;
    preserved?: number;
    preservedQty?: number;
    beforeProduction?: { skuLabel: string; date: string; qty: number }[];
    conflicts?: { skuLabel: string; date: string; qty: number; eventId: number }[];
  };
};

export async function fetchFeed(signal?: AbortSignal): Promise<Feed> {
  const url = process.env.WS_TRACKER_FEED_URL;
  if (!url) throw new Error("WS_TRACKER_FEED_URL is not set");
  const res = await fetch(url, { headers: { "x-ssof-key": process.env.WS_TRACKER_FEED_KEY ?? "" }, signal });
  if (!res.ok) throw new Error(`WS Tracker feed returned ${res.status}`);
  const feed = (await res.json()) as Feed;
  if (feed.unit !== "MC") throw new Error(`WS Tracker feed is in ${feed.unit}; SSOF expects MC`);
  if (feed.country !== "Syria") throw new Error(`WS Tracker feed is for ${feed.country}, not Syria`);
  return feed;
}

/**
 * Which production month each delivery of one SKU belongs to. The deliveries (in date order, each
 * kept whole) are split into consecutive groups, each under a later production month than the one
 * before and never under a month after its first delivery, so that they best add up to each month's
 * production: a month the deliveries have moved past should be fully cleared, the last month used
 * may be partly cleared (only over-delivery counts), and a month skipped before it never arrived.
 * Returns the month index for each delivery, or null when no month can take them.
 */
export function matchDeliveriesToProduction(deliveries: { date: string; qty: number }[], months: { month: string; size: number }[]): number[] | null {
  const n = deliveries.length, k = months.length;
  const pre = [0];
  for (const d of deliveries) pre.push(pre[pre.length - 1] + d.qty);
  const skipped = (a: number, b: number) => { let c = 0; for (let x = a; x < b; x += 1) c += months[x].size; return c; };
  // closed[i][j]: least cost with the first i deliveries placed, the last group closed on month j
  const closed = Array.from({ length: n + 1 }, () => new Array<number>(k).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => new Array<[number, number] | null>(k).fill(null));
  const best = { cost: Infinity, s: -1, j: -1, jp: -1 };
  for (let i = 1; i <= n; i += 1) for (let j = 0; j < k; j += 1) for (let s = 0; s < i; s += 1) {
    if (months[j].month > deliveries[s].date.slice(0, 7)) continue;
    const got = pre[i] - pre[s];
    const prevs: [number, number][] = s === 0
      ? [[-1, skipped(0, j)]]
      : months.map((_, jp): [number, number] => [jp, jp < j ? closed[s][jp] + skipped(jp + 1, j) : Infinity]);
    for (const [jp, base] of prevs) {
      if (!Number.isFinite(base)) continue;
      const c = base + Math.abs(months[j].size - got);
      if (c < closed[i][j]) { closed[i][j] = c; from[i][j] = [s, jp]; }
      if (i === n) {
        const open = base + Math.max(0, got - months[j].size);
        if (open < best.cost) Object.assign(best, { cost: open, s, j, jp });
      }
    }
  }
  if (!Number.isFinite(best.cost)) return null;
  const out = new Array<number>(n).fill(-1);
  let i = n, j = best.j, s = best.s, jp = best.jp;
  for (;;) {
    for (let x = s; x < i; x += 1) out[x] = j;
    if (jp === -1) break;
    const prev = from[s][jp];
    if (!prev) return null;
    i = s; j = jp; [s, jp] = prev;
  }
  return out;
}

/** A development workspace (pnpm dev sets NODE_ENV=development) has its own database. */
const isDevWorkspace = () => process.env.NODE_ENV === "development";

/**
 * Tell the WS Tracker which Syria SKUs are active, so a new SKU can be entered in its Entry tab
 * before it exists in the warehouse ledger. Posted to the feed URL with the feed key. Each SKU
 * says which tracker product it already is (SKU_MAP, exact packaging match), or null when the
 * tracker has none: those are the ones its Entry tab offers as new.
 *
 * Only the published app sends it. A development workspace has its own database, and its SKUs
 * and ids must not replace the published app's list in the tracker; there the call does nothing
 * and says so. The tracker also refuses a list that is not marked as published.
 */
export async function pushSkusToTracker(): Promise<{ sent: number; added: string[]; skipped?: string }> {
  const url = process.env.WS_TRACKER_FEED_URL;
  if (!url) throw new Error("WS_TRACKER_FEED_URL is not set");
  if (isDevWorkspace()) return { sent: 0, added: [], skipped: "this is the development workspace; only the published app sends the SKU list" };
  const skus = await db.getSkusForCountry(WS_TRACKER_COUNTRY);
  if (!skus.length) return { sent: 0, added: [] }; // never send an empty list: it would hide every SKU there
  const trackerOf = new Map<number, { flavour: string; format: string }>();
  for (const m of SKU_MAP) {
    const sku = resolveTrackerSku({ flavour: m.flavour, format: m.format }, skus);
    if (sku && !trackerOf.has(sku.id)) trackerOf.set(sku.id, { flavour: m.flavour, format: m.format });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ssof-key": process.env.WS_TRACKER_FEED_KEY ?? "" },
    body: JSON.stringify({
      country: WS_TRACKER_COUNTRY,
      source: "published",
      sentAt: new Date().toISOString(),
      skus: skus.map(s => ({
        id: s.id, name: s.name, weight: s.weight, packagingType: s.packagingType ?? null,
        category: s.category, sortOrder: s.sortOrder, tracker: trackerOf.get(s.id) ?? null,
      })),
    }),
  });
  if (!res.ok) throw new Error(`WS Tracker did not accept the SKU list (${res.status})`);
  const out = (await res.json().catch(() => ({}))) as { new?: unknown };
  return { sent: skus.length, added: Array.isArray(out.new) ? out.new.map(String) : [] };
}

const pushOff = () => !process.env.WS_TRACKER_FEED_URL || !!process.env.VITEST || process.env.NODE_ENV === "test" || isDevWorkspace();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Send the SKU list a few seconds from now; calls close together become one send. Never throws:
 * a tracker outage must not break a SKU change in SSOF.
 */
export function pushSkusToTrackerSoon(reason: string, delayMs = 4000) {
  if (pushOff()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushSkusToTracker().then(
      r => console.log(`[wsTracker] SKU list sent (${reason}): ${r.sent} SKUs${r.added.length ? `, new there: ${r.added.join(", ")}` : ""}`),
      e => console.warn(`[wsTracker] SKU list not sent (${reason}):`, e instanceof Error ? e.message : e),
    );
  }, delayMs);
  pushTimer.unref?.();
}
// After any SKU change, shortly after the server starts, and every six hours as a safety net.
// (The try/catch is for test doubles of ./db that do not define the hook.)
try { (db as { onSkuChange?: (fn: () => void) => void }).onSkuChange?.(() => pushSkusToTrackerSoon("SKU change")); } catch { /* no hook */ }
if (!pushOff()) {
  pushSkusToTrackerSoon("startup", 20_000);
  setInterval(() => pushSkusToTrackerSoon("every 6 hours", 0), 6 * 60 * 60 * 1000).unref?.();
}

/** Work out what the feed would change, without writing anything. */
export async function buildPlan(feed?: Feed): Promise<SyncPlan> {
  const f = feed ?? (await fetchFeed());
  validateTrackerFeed(f);
  const skus = await db.getSkusForCountry(WS_TRACKER_COUNTRY);
  const periods = await db.getPeriodsForCountry(WS_TRACKER_COUNTRY);
  const ims = await db.getImsDataForCountry(WS_TRACKER_COUNTRY);
  const arrivals = await db.getArrivalDataForCountry(WS_TRACKER_COUNTRY);

  const skuById = new Map(skus.map(s => [s.id, s]));
  const findSku = (flavour: string, format: string, ssofSkuId?: number) => {
    // A line that carries ssofSkuId is a SKU SSOF itself sent to the tracker: matched by id, never by name.
    if (ssofSkuId != null) return { sku: skuById.get(ssofSkuId), expected: `${flavour} ${format} (SSOF SKU #${ssofSkuId}) — not an active Syria SKU` };
    const m = SKU_MAP.find(x => norm(x.flavour) === norm(flavour) && weightKey(x.format) === weightKey(format));
    if (!m) return { sku: undefined, expected: `${flavour} ${format} — not in the mapping` };
    const sku = resolveTrackerSku({ flavour, format }, skus);
    return { sku, expected: `${m.name} ${m.weight} (${m.packagingType ?? "New"}) — exact, unique packaging match required` };
  };
  const periodBy = new Map(periods.map(p => [`${p.year}-${String(p.month).padStart(2, "0")}`, p]));
  const inFeedRange = (month: string) => month >= f.period.from && month <= f.period.to;
  const mapped = new Map<number, { flavour: string; format: string }>();
  // SKUs fed by SSOF id are the tracker's only from their first tracker month on: earlier months stay as SSOF has them.
  const fedById = new Map<number, { flavour: string; format: string; first: string }>();
  for (const m of [...f.products, ...f.ims, ...f.arrivals, ...(f.arrivalMovements ?? [])]) {
    const { sku } = findSku(m.flavour, m.format, m.ssofSkuId);
    if (!sku) continue;
    if (m.ssofSkuId != null) {
      const month = "month" in m ? m.month : "date" in m ? m.date.slice(0, 7) : "";
      const cur = fedById.get(sku.id) ?? { flavour: m.flavour, format: m.format, first: "" };
      if (month && (!cur.first || month < cur.first)) cur.first = month;
      fedById.set(sku.id, cur);
      continue;
    }
    if (!mapped.has(sku.id)) mapped.set(sku.id, { flavour: m.flavour, format: m.format });
  }
  for (const id of mapped.keys()) fedById.delete(id);
  const managed = new Set([...mapped.keys(), ...fedById.keys()]);

  const imsNow = new Map(ims.map(r => [`${r.skuId}-${r.periodId}`, Number(r.value ?? 0)]));
  const arrNow = new Map(
    arrivals.map(r => [
      `${r.skuId}-${r.periodId}`,
      [Number(r.week1 ?? 0), Number(r.week2 ?? 0), Number(r.week3 ?? 0), Number(r.week4 ?? 0)] as [number, number, number, number],
    ]),
  );

  const rows: SyncRow[] = [];
  const unmatchedProducts = new Map<string, { flavour: string; format: string; qty: number; expected: string }>();
  const unmatchedMonths = new Set<string>();
  // Include unmapped zero-quantity products as well as products with movements.
  for (const product of f.products) {
    const { sku, expected } = findSku(product.flavour, product.format, product.ssofSkuId);
    if (!sku) unmatchedProducts.set(`${product.flavour}|${product.format}`, { ...product, qty: 0, expected });
  }

  // IMS: one value per SKU and month.
  const imsByCell = new Map<string, { flavour: string; format: string; month: string; qty: number; ssofSkuId?: number }>();
  for (const l of f.ims) {
    const k = `${l.flavour}|${l.format}|${l.ssofSkuId ?? ""}|${l.month}`;
    const cur = imsByCell.get(k) ?? { flavour: l.flavour, format: l.format, month: l.month, qty: 0, ssofSkuId: l.ssofSkuId };
    cur.qty += l.qty;
    imsByCell.set(k, cur);
  }
  for (const cell of imsByCell.values()) {
    const { sku, expected } = findSku(cell.flavour, cell.format, cell.ssofSkuId);
    const period = periodBy.get(cell.month);
    if (!sku) {
      const k = `${cell.flavour}|${cell.format}`;
      const u = unmatchedProducts.get(k) ?? { flavour: cell.flavour, format: cell.format, qty: 0, expected };
      u.qty += cell.qty;
      unmatchedProducts.set(k, u);
      continue;
    }
    if (!period) { unmatchedMonths.add(cell.month); continue; }
    rows.push({
      section: "IMS", flavour: cell.flavour, format: cell.format, month: cell.month,
      skuId: sku.id, skuLabel: `${sku.name} ${sku.weight}${sku.packagingType ? ` (${sku.packagingType})` : ""}`,
      periodId: period.id, periodLabel: period.label,
      current: imsNow.get(`${sku.id}-${period.id}`) ?? 0, next: cell.qty,
    });
  }

  // Arrivals: four weekly buckets per SKU and month.
  const arrByCell = new Map<string, { flavour: string; format: string; month: string; weeks: [number, number, number, number]; ssofSkuId?: number }>();
  for (const l of f.arrivals) {
    const k = `${l.flavour}|${l.format}|${l.ssofSkuId ?? ""}|${l.month}`;
    const cur = arrByCell.get(k) ?? { flavour: l.flavour, format: l.format, month: l.month, weeks: [0, 0, 0, 0] as [number, number, number, number], ssofSkuId: l.ssofSkuId };
    const w = Math.min(4, Math.max(1, l.week ?? 1)) - 1;
    cur.weeks[w] += l.qty;
    arrByCell.set(k, cur);
  }
  for (const cell of arrByCell.values()) {
    const { sku, expected } = findSku(cell.flavour, cell.format, cell.ssofSkuId);
    const period = periodBy.get(cell.month);
    if (!sku) {
      const k = `${cell.flavour}|${cell.format}`;
      const u = unmatchedProducts.get(k) ?? { flavour: cell.flavour, format: cell.format, qty: 0, expected };
      u.qty += cell.weeks.reduce((a, b) => a + b, 0);
      unmatchedProducts.set(k, u);
      continue;
    }
    if (!period) { unmatchedMonths.add(cell.month); continue; }
    const now = arrNow.get(`${sku.id}-${period.id}`) ?? [0, 0, 0, 0];
    for (let w = 0; w < 4; w += 1) {
      if (cell.weeks[w] === 0 && now[w] === 0) continue;
      rows.push({
        section: "Arrival", flavour: cell.flavour, format: cell.format, month: cell.month, week: w + 1,
        skuId: sku.id, skuLabel: `${sku.name} ${sku.weight}${sku.packagingType ? ` (${sku.packagingType})` : ""}`,
        periodId: period.id, periodLabel: period.label,
        current: now[w], next: cell.weeks[w],
      });
    }
  }

  // Cells inside the feed's months that the tracker no longer has: set them to 0, so the two
  // systems agree. Products SSOF has but the tracker does not (Mint, Grape and Mint 1kg …) are
  // never touched — they simply are not in the mapping.
  // Historical flavour aliases may resolve to the same physical SKU. Sum them
  // once per destination cell rather than last-write-wins.
  const combined = new Map<string, SyncRow>();
  for (const row of rows) {
    const key = `${row.section}|${row.skuId}|${row.periodId}|${row.week ?? 0}`;
    const prior = combined.get(key);
    if (prior) prior.next += row.next;
    else combined.set(key, { ...row });
  }
  rows.splice(0, rows.length, ...combined.values());
  const seen = new Set(combined.keys());
  const zeroFill: [number, { flavour: string; format: string }, string][] = [...mapped].map(([id, who]) => [id, who, f.period.from]);
  for (const [id, who] of fedById) if (who.first) zeroFill.push([id, who, who.first]);
  for (const [skuId, who, since] of zeroFill) {
    const sku = skus.find(x => x.id === skuId)!;
    const label = `${sku.name} ${sku.weight}${sku.packagingType ? ` (${sku.packagingType})` : ""}`;
    for (const period of periods) {
      const month = `${period.year}-${String(period.month).padStart(2, "0")}`;
      if (!inFeedRange(month) || month < since) continue;
      const base = { flavour: who.flavour, format: who.format, month, skuId, skuLabel: label, periodId: period.id, periodLabel: period.label, next: 0 };
      const imsCurrent = imsNow.get(`${skuId}-${period.id}`) ?? 0;
      if (!seen.has(`IMS|${skuId}|${period.id}|0`)) rows.push({ section: "IMS", ...base, current: imsCurrent });
      const weeks = arrNow.get(`${skuId}-${period.id}`) ?? [0, 0, 0, 0];
      for (let w = 0; w < 4; w += 1) {
        if (weeks[w] !== 0 && !seen.has(`Arrival|${skuId}|${period.id}|${w + 1}`)) rows.push({ section: "Arrival", ...base, week: w + 1, current: weeks[w] });
      }
    }
  }

  rows.sort((a, b) => a.section.localeCompare(b.section) || a.month.localeCompare(b.month) || a.skuLabel.localeCompare(b.skuLabel) || (a.week ?? 0) - (b.week ?? 0));

  // ----- clearance: each tracker delivery becomes one clearance under a production month -----
  // The Arrival page lists production months (Forecast Production, or actual when entered); a
  // month is cleared later, by deliveries. Each tracker delivery keeps its full quantity and date
  // and goes under the production month it belongs to (matchDeliveriesToProduction). The tracker is
  // the source of truth, so nothing is capped or dropped.
  const shipment = await db.getShipmentDataForCountry(WS_TRACKER_COUNTRY);
  const existingClearance = await db.getClearanceEventsForCountry(WS_TRACKER_COUNTRY);
  const label = (sku: (typeof skus)[number]) => `${sku.name} ${sku.weight}${sku.packagingType ? ` (${sku.packagingType})` : ""}`;
  const periodById = new Map(periods.map(pp => [pp.id, pp]));
  // Production per SKU and month, sized exactly as the Arrival page sizes its batches: the actual
  // production when one was entered (weekly production, or a manual Actual Production value),
  // otherwise the Forecast Production for that month.
  const forecast = await db.getForecastDataForCountry(WS_TRACKER_COUNTRY);
  const actualOverride = await db.getActualProductionDataForCountry(WS_TRACKER_COUNTRY);
  const foc = await getFocPlanning("Syria");
  const production = fgProductionMap("Syria", forecast, actualOverride, foc.cells, shipment);
  const batchesBySku = new Map<number, { periodId: number; sortOrder: number; label: string; month: string; size: number }[]>();
  for (const [key, size] of production) {
    if (size <= 0) continue;
    const [skuId, periodId] = key.split("-").map(Number);
    const per = periodById.get(periodId); if (!per) continue;
    const list = batchesBySku.get(skuId) ?? [];
    list.push({ periodId, sortOrder: per.sortOrder, label: per.label, month: `${per.year}-${String(per.month).padStart(2, "0")}`, size });
    batchesBySku.set(skuId, list);
  }
  for (const list of batchesBySku.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const movesBySku = new Map<number, { date: string; qty: number }[]>();
  for (const mv of f.arrivalMovements ?? []) {
    const found = findSku(mv.flavour, mv.format, mv.ssofSkuId);
    if (!found.sku) {
      const k = `${mv.flavour}|${mv.format}`;
      const u = unmatchedProducts.get(k) ?? { flavour: mv.flavour, format: mv.format, qty: 0, expected: found.expected };
      // Weekly arrivals already report inbound; dated movements are another
      // representation of those deliveries, not an additional quantity.
      if (!unmatchedProducts.has(k)) u.qty += mv.qty;
      unmatchedProducts.set(k, u);
      continue;
    }
    const list = movesBySku.get(found.sku.id) ?? [];
    list.push({ date: mv.date, qty: mv.qty });
    movesBySku.set(found.sku.id, list);
  }
  const clearanceEvents: SyncPlan["clearance"]["events"] = [];
  const overflow: SyncPlan["clearance"]["overflow"] = [];
  const beforeProduction: NonNullable<SyncPlan["clearance"]["beforeProduction"]> = [];
  for (const [skuId, moves] of movesBySku) {
    const sku = skus.find(x => x.id === skuId)!;
    const batches = batchesBySku.get(skuId) ?? [];
    moves.sort((a, b) => a.date.localeCompare(b.date));
    // One clearance per delivery, full quantity and tracker date, under the production month it
    // belongs to. A delivery before any production month is logged on its own arrival month.
    const first = batches[0]?.month;
    for (const mv of moves) if (!first || mv.date.slice(0, 7) < first)
      beforeProduction.push({ skuLabel: label(sku), date: mv.date, qty: mv.qty });
    const matched = first ? moves.filter(mv => mv.date.slice(0, 7) >= first) : [];
    const pick = matched.length ? matchDeliveriesToProduction(matched, batches.map(x => ({ month: x.month, size: x.size }))) : null;
    const onArrivalMonth = pick ? moves.filter(mv => !matched.includes(mv)) : moves;
    matched.forEach((mv, x) => {
      if (!pick) return;
      if (!periodBy.has(mv.date.slice(0, 7))) {
        overflow.push({ skuLabel: label(sku), date: mv.date, qty: mv.qty }); return;
      }
      const bt = batches[pick[x]];
      clearanceEvents.push({ skuId, skuLabel: label(sku), periodId: bt.periodId, periodLabel: bt.label, date: mv.date, qty: mv.qty });
    });
    for (const mv of onArrivalMonth) {
      const per = periodBy.get(mv.date.slice(0, 7));
      if (per) clearanceEvents.push({ skuId, skuLabel: label(sku), periodId: per.id, periodLabel: per.label, date: mv.date, qty: mv.qty });
      else overflow.push({ skuLabel: label(sku), date: mv.date, qty: mv.qty });
    }
  }
  const replacing = existingClearance.filter(e => isTrackerClearance(e) && managed.has(e.skuId)
    && inFeedRange(trackerBusinessDate(e.clearedDate).slice(0, 7)));
  const preserved = existingClearance.filter(e => !replacing.some(r => r.id === e.id));
  const conflicts = preserved.filter(e => !isTrackerClearance(e) && Number(e.clearedQty) > 0
    && clearanceEvents.some(n => n.skuId === e.skuId && n.date === trackerBusinessDate(e.clearedDate)))
    .map(e => ({ skuLabel: label(skus.find(s => s.id === e.skuId)!), date: trackerBusinessDate(e.clearedDate), qty: Number(e.clearedQty), eventId: e.id }));



  return {
    managedSkuIds: [...managed],
    feed: { generatedAt: f.generatedAt, from: f.period.from, to: f.period.to, totals: f.totals },
    rows,
    changed: rows.filter(r => r.current !== r.next),
    unmatchedProducts: [...unmatchedProducts.values()],
    unmatchedMonths: [...unmatchedMonths].sort(),
    syriaSkus: skus.map(s => `${s.name} ${s.weight}${s.packagingType ? ` (${s.packagingType})` : ""}`),
    clearance: {
      events: clearanceEvents,
      overflow,
      replacing: replacing.length,
      replacingQty: replacing.reduce((a, e) => a + Number(e.clearedQty || 0), 0),
      newQty: clearanceEvents.reduce((a, e) => a + e.qty, 0),
      preserved: preserved.length,
      preservedQty: preserved.reduce((a, e) => a + Number(e.clearedQty || 0), 0),
      beforeProduction, conflicts,
    },
  };
}

/** Write the feed's numbers into Syria's IMS and Arrival tables. */
export async function applyPlan(plan?: SyncPlan, actor = "WS Tracker"): Promise<{ imsCells: number; arrivalCells: number; clearanceEvents: number; clearanceRemoved: number; plan: SyncPlan }> {
  const p = plan ?? (await buildPlan());
  if (p.clearance.overflow.length || p.unmatchedMonths.length) throw new Error("Sync blocked: tracker months or delivery dates have no Syria period. Review the reported MC first.");
  if (p.clearance.conflicts?.length) throw new Error("Sync blocked: a non-tracker clearance overlaps a tracker delivery date. Review it first; neither record has been deleted.");
  const now = new Date();
  const imsRecords = p.rows
    .filter(r => r.section === "IMS")
    .map(r => {
      const [year, month] = r.month.split("-").map(Number);
      const isActual = year < now.getFullYear() || (year === now.getFullYear() && month <= now.getMonth() + 1);
      return { skuId: r.skuId, periodId: r.periodId, value: String(r.next), isActual };
    });

  const weeksByCell = new Map<string, { skuId: number; periodId: number; weeks: [number, number, number, number] }>();
  for (const r of p.rows) {
    if (r.section !== "Arrival") continue;
    const k = `${r.skuId}-${r.periodId}`;
    const cur = weeksByCell.get(k) ?? { skuId: r.skuId, periodId: r.periodId, weeks: [0, 0, 0, 0] as [number, number, number, number] };
    cur.weeks[(r.week ?? 1) - 1] = r.next;
    weeksByCell.set(k, cur);
  }
  const arrivalRecords = [...weeksByCell.values()].map(c => ({
    skuId: c.skuId, periodId: c.periodId,
    week1: String(c.weeks[0]), week2: String(c.weeks[1]), week3: String(c.weeks[2]), week4: String(c.weeks[3]),
  }));

  const clearanceRemoved = await persistTrackerSync(p, imsRecords, arrivalRecords, actor);
  return { imsCells: imsRecords.length, arrivalCells: arrivalRecords.length, clearanceEvents: p.clearance.events.length, clearanceRemoved, plan: p };
}
