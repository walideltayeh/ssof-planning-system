import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getSkusForCountry: vi.fn(),
  getPeriodsForCountry: vi.fn(),
  getImsDataForCountry: vi.fn(),
  getArrivalDataForCountry: vi.fn(),
  getShipmentDataForCountry: vi.fn(),
  getClearanceEventsForCountry: vi.fn(),
  getForecastDataForCountry: vi.fn(),
  getActualProductionDataForCountry: vi.fn(),
  onSkuChange: vi.fn(),
}));

import * as db from "./db";
import { buildPlan, pushSkusToTracker, type Feed } from "./wsTracker";

const sku = (id: number, name: string, weight: string, packagingType: "Old" | "New" = "New") =>
  ({ id, country: "Syria", name, weight, packagingType, category: "Core", sortOrder: id, isActive: true }) as never;
const SKUS = [
  sku(1, "Double Apple", "50g", "New"),
  sku(2, "Double Apple", "50g", "Old"),
  sku(6, "Grape", "50g"),
  sku(40, "Mint", "50g"), // SSOF has it, the tracker does not
];
const period = (id: number, year: number, month: number) => ({ id, country: "Syria", year, month, label: `${year}-${month}`, sortOrder: id }) as never;

beforeEach(() => {
  vi.mocked(db.getSkusForCountry).mockResolvedValue(SKUS);
  vi.mocked(db.getPeriodsForCountry).mockResolvedValue([period(1, 2026, 9), period(2, 2026, 10)]);
  // SSOF already holds a manual IMS value for Mint in September; the tracker must not wipe it
  vi.mocked(db.getImsDataForCountry).mockResolvedValue([{ skuId: 40, periodId: 1, value: "77" }] as never);
  vi.mocked(db.getArrivalDataForCountry).mockResolvedValue([]);
  vi.mocked(db.getShipmentDataForCountry).mockResolvedValue([]);
  vi.mocked(db.getClearanceEventsForCountry).mockResolvedValue([]);
  vi.mocked(db.getForecastDataForCountry).mockResolvedValue([]);
  vi.mocked(db.getActualProductionDataForCountry).mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.WS_TRACKER_FEED_URL; delete process.env.WS_TRACKER_FEED_KEY; });

describe("WS Tracker SKU list", () => {
  it("sends Syria's active SKUs with the tracker product each one already is", async () => {
    process.env.WS_TRACKER_FEED_URL = "https://tracker.example/api/ssof";
    process.env.WS_TRACKER_FEED_KEY = "k";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, new: ["Mint 50g"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pushSkusToTracker();

    expect(res).toEqual({ sent: 4, added: ["Mint 50g"] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tracker.example/api/ssof");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-ssof-key"]).toBe("k");
    const body = JSON.parse(String(init.body));
    expect(body.country).toBe("Syria");
    const byId = new Map(body.skus.map((s: { id: number }) => [s.id, s]));
    expect((byId.get(1) as { tracker: unknown }).tracker).toEqual({ flavour: "Two Apples Black", format: "50g" });
    expect((byId.get(2) as { tracker: unknown }).tracker).toEqual({ flavour: "Red", format: "50g" });
    expect((byId.get(6) as { tracker: unknown }).tracker).toEqual({ flavour: "Grape", format: "50g" });
    expect((byId.get(40) as { tracker: unknown }).tracker).toBeNull();
  });

  it("never sends an empty list", async () => {
    process.env.WS_TRACKER_FEED_URL = "https://tracker.example/api/ssof";
    vi.mocked(db.getSkusForCountry).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await pushSkusToTracker()).toEqual({ sent: 0, added: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("feed lines for a SKU the tracker was sent", () => {
  const feed: Feed = {
    country: "Syria", unit: "MC", generatedAt: "2026-10-11T00:00:00Z",
    period: { from: "2026-09", to: "2026-10", firstMovement: "2026-09-01", lastMovement: "2026-10-11" },
    products: [],
    ims: [
      { flavour: "Grape", format: "50g", month: "2026-10", qty: 50 },
      { flavour: "Mint", format: "50g", month: "2026-10", qty: 30, ssofSkuId: 40 },
      { flavour: "Gone", format: "50g", month: "2026-10", qty: 5, ssofSkuId: 99 },
    ],
    arrivals: [{ flavour: "Mint", format: "50g", month: "2026-10", week: 2, qty: 100, ssofSkuId: 40 }],
    arrivalMovements: [{ date: "2026-10-11", flavour: "Mint", format: "50g", qty: 100, ssofSkuId: 40 }],
    totals: { ims: 85, arrivals: 100 },
  };

  it("matches them by SSOF id, and leaves that SKU's other months alone", async () => {
    const plan = await buildPlan(feed);
    const mint = plan.rows.filter(r => r.skuId === 40);
    expect(mint.find(r => r.section === "IMS")).toMatchObject({ month: "2026-10", next: 30, current: 0 });
    expect(mint.find(r => r.section === "Arrival")).toMatchObject({ month: "2026-10", week: 2, next: 100 });
    // the manual September IMS (77) for Mint is not touched: no row sets it to 0
    expect(mint.some(r => r.month === "2026-09")).toBe(false);
    // the mapped product still works by name
    expect(plan.rows.find(r => r.skuId === 6 && r.section === "IMS")).toMatchObject({ next: 50 });
    // an id that is not an active Syria SKU is reported, not written
    expect(plan.unmatchedProducts.map(u => u.flavour)).toContain("Gone");
    expect(plan.rows.some(r => r.skuId === 99)).toBe(false);
    // the inbound movement becomes a clearance for Mint on its real date
    expect(plan.clearance.events.find(e => e.skuId === 40)).toMatchObject({ date: "2026-10-11", qty: 100 });
  });
});
