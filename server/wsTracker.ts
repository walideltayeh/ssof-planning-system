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
 * Configuration (Replit secrets / env):
 *   WS_TRACKER_FEED_URL   e.g. https://ws-syria.higgsfield.app/api/ssof
 *   WS_TRACKER_FEED_KEY   the feed key, sent as the x-ssof-key header
 */
import * as db from "./db";
import type { Country } from "../drizzle/schema";

export const WS_TRACKER_COUNTRY: Country = "Syria";

export type FeedLine = { flavour: string; format: string; month: string; week?: number; qty: number };
export type Feed = {
  country: string;
  unit: string;
  generatedAt: string;
  period: { from: string; to: string; firstMovement: string; lastMovement: string };
  products: { flavour: string; format: string; trackerProducts: string[] }[];
  ims: FeedLine[];
  arrivals: FeedLine[];
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
  { flavour: "Two Apples Iced", format: "50g", name: "Double Apple Ice", weight: "50g" },
  { flavour: "Grape", format: "50g", name: "Grape", weight: "50g" },
  { flavour: "Grape", format: "250g", name: "Grape", weight: "250g" },
  { flavour: "Grape", format: "Kg", name: "Grape", weight: "1kg" },
  { flavour: "Grape & Mint", format: "50g", name: "Grape Mint", weight: "50g" },
  { flavour: "Love", format: "50g", name: "Love 66", weight: "50g" },
  { flavour: "Blueberry", format: "50g", name: "Blueberry", weight: "50g" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const weightKey = (w: string) => norm(w).replace(/^1kg$/, "kg");

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
  feed: { generatedAt: string; from: string; to: string; totals: { ims: number; arrivals: number } };
  rows: SyncRow[];
  changed: SyncRow[];
  unmatchedProducts: { flavour: string; format: string; qty: number; expected: string }[];
  unmatchedMonths: string[];
  syriaSkus: string[];
};

export async function fetchFeed(): Promise<Feed> {
  const url = process.env.WS_TRACKER_FEED_URL;
  if (!url) throw new Error("WS_TRACKER_FEED_URL is not set");
  const res = await fetch(url, { headers: { "x-ssof-key": process.env.WS_TRACKER_FEED_KEY ?? "" } });
  if (!res.ok) throw new Error(`WS Tracker feed returned ${res.status}`);
  const feed = (await res.json()) as Feed;
  if (feed.unit !== "MC") throw new Error(`WS Tracker feed is in ${feed.unit}; SSOF expects MC`);
  if (feed.country !== "Syria") throw new Error(`WS Tracker feed is for ${feed.country}, not Syria`);
  return feed;
}

/** Work out what the feed would change, without writing anything. */
export async function buildPlan(feed?: Feed): Promise<SyncPlan> {
  const f = feed ?? (await fetchFeed());
  const skus = await db.getSkusForCountry(WS_TRACKER_COUNTRY);
  const periods = await db.getPeriodsForCountry(WS_TRACKER_COUNTRY);
  const ims = await db.getImsDataForCountry(WS_TRACKER_COUNTRY);
  const arrivals = await db.getArrivalDataForCountry(WS_TRACKER_COUNTRY);

  const skuBy = new Map<string, (typeof skus)[number]>();
  for (const s of skus) {
    skuBy.set(`${norm(s.name)}|${weightKey(s.weight)}|${norm(s.packagingType ?? "")}`, s);
    const loose = `${norm(s.name)}|${weightKey(s.weight)}`;
    if (!skuBy.has(loose)) skuBy.set(loose, s);
  }
  const findSku = (flavour: string, format: string) => {
    const m = SKU_MAP.find(x => x.flavour === flavour && x.format === format);
    if (!m) return { sku: undefined, expected: `${flavour} ${format} — not in the mapping` };
    const key = `${norm(m.name)}|${weightKey(m.weight)}`;
    const sku = (m.packagingType ? skuBy.get(`${key}|${norm(m.packagingType)}`) : undefined) ?? skuBy.get(key);
    return { sku, expected: `${m.name} ${m.weight}${m.packagingType ? ` (${m.packagingType})` : ""}` };
  };
  const periodBy = new Map(periods.map(p => [`${p.year}-${String(p.month).padStart(2, "0")}`, p]));

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

  // IMS: one value per SKU and month.
  const imsByCell = new Map<string, { flavour: string; format: string; month: string; qty: number }>();
  for (const l of f.ims) {
    const k = `${l.flavour}|${l.format}|${l.month}`;
    const cur = imsByCell.get(k) ?? { flavour: l.flavour, format: l.format, month: l.month, qty: 0 };
    cur.qty += l.qty;
    imsByCell.set(k, cur);
  }
  for (const cell of imsByCell.values()) {
    const { sku, expected } = findSku(cell.flavour, cell.format);
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
  const arrByCell = new Map<string, { flavour: string; format: string; month: string; weeks: [number, number, number, number] }>();
  for (const l of f.arrivals) {
    const k = `${l.flavour}|${l.format}|${l.month}`;
    const cur = arrByCell.get(k) ?? { flavour: l.flavour, format: l.format, month: l.month, weeks: [0, 0, 0, 0] as [number, number, number, number] };
    const w = Math.min(4, Math.max(1, l.week ?? 1)) - 1;
    cur.weeks[w] += l.qty;
    arrByCell.set(k, cur);
  }
  for (const cell of arrByCell.values()) {
    const { sku, expected } = findSku(cell.flavour, cell.format);
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

  rows.sort((a, b) => a.section.localeCompare(b.section) || a.month.localeCompare(b.month) || a.skuLabel.localeCompare(b.skuLabel) || (a.week ?? 0) - (b.week ?? 0));
  return {
    feed: { generatedAt: f.generatedAt, from: f.period.from, to: f.period.to, totals: f.totals },
    rows,
    changed: rows.filter(r => r.current !== r.next),
    unmatchedProducts: [...unmatchedProducts.values()],
    unmatchedMonths: [...unmatchedMonths].sort(),
    syriaSkus: skus.map(s => `${s.name} ${s.weight}${s.packagingType ? ` (${s.packagingType})` : ""}`),
  };
}

/** Write the feed's numbers into Syria's IMS and Arrival tables. */
export async function applyPlan(plan?: SyncPlan): Promise<{ imsCells: number; arrivalCells: number; plan: SyncPlan }> {
  const p = plan ?? (await buildPlan());
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

  if (imsRecords.length > 0) await db.bulkUpsertIms(imsRecords);
  if (arrivalRecords.length > 0) await db.bulkUpsertArrival(arrivalRecords);
  return { imsCells: imsRecords.length, arrivalCells: arrivalRecords.length, plan: p };
}
