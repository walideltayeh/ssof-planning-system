// ────────────────────────────────────────────────────────────────────────────
// Pack conversions — 1 MC = 6 KG, so: 50g → 120 packs, 250g → 24 pieces,
// 1kg → 6 pieces per mastercase.  Works for any custom weight string.
// Shared by the Trade Offers page and the SKU price list.
// ────────────────────────────────────────────────────────────────────────────

export function weightGrams(weight: string): number | null {
  const m = /([\d.]+)\s*(kg|g)/i.exec(weight);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].toLowerCase() === "kg" ? n * 1000 : n;
}

export function packsPerMc(weight: string): { count: number; unit: "packs" | "pieces" } | null {
  const g = weightGrams(weight);
  if (!g) return null;
  const count = Math.round(6000 / g);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { count, unit: g <= 100 ? "packs" : "pieces" };
}

// The four supply-chain price tiers stored on each SKU.
// Trade-tier prices are $/MC; rspPerPack is $/pack.  Null = not set.
export type TierPrices = {
  toWs: number | null;            // our selling price to Wholesale, $/MC
  wsToSemiWs: number | null;      // WS → Semi-WS / Tobacconists, $/MC
  semiWsToRetail: number | null;  // Semi-WS → Retail, $/MC
  rspPerPack: number | null;      // consumer shelf price, $/pack
};

function parsePrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Reads the tier prices off a raw SKU row from the server (numeric columns
// arrive as strings).  Safe on rows that don't carry the columns at all.
export function tierPricesOf(sku: {
  priceToWs?: unknown; priceWsToSemiWs?: unknown;
  priceSemiWsToRetail?: unknown; finalRspPerPack?: unknown;
}): TierPrices {
  return {
    toWs: parsePrice(sku.priceToWs),
    wsToSemiWs: parsePrice(sku.priceWsToSemiWs),
    semiWsToRetail: parsePrice(sku.priceSemiWsToRetail),
    rspPerPack: parsePrice(sku.finalRspPerPack),
  };
}

export function hasAnyTierPrice(tp: TierPrices): boolean {
  return tp.toWs !== null || tp.wsToSemiWs !== null || tp.semiWsToRetail !== null || tp.rspPerPack !== null;
}
