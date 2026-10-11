import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlan, pushSkusToTracker, type Feed } from "./wsTracker";

const data = vi.hoisted(() => ({ skus: [] as any[], periods: [] as any[], ims: [] as any[],
  arrival: [] as any[], shipment: [] as any[], events: [] as any[], forecast: [] as any[], actual: [] as any[], foc: [] as any[] }));
vi.mock("./focPlanning", () => ({ getFocPlanning: vi.fn(async () => ({ cells: data.foc })) }));
vi.mock("./db", () => ({
  getSkusForCountry: vi.fn(async () => data.skus), getPeriodsForCountry: vi.fn(async () => data.periods),
  getImsDataForCountry: vi.fn(async () => data.ims), getArrivalDataForCountry: vi.fn(async () => data.arrival),
  getShipmentDataForCountry: vi.fn(async () => data.shipment), getClearanceEventsForCountry: vi.fn(async () => data.events),
  getForecastDataForCountry: vi.fn(async () => data.forecast), getActualProductionDataForCountry: vi.fn(async () => data.actual),
  getPool: vi.fn(),
}));

const sku = (id: number, name: string, weight: string, packagingType: "Old" | "New" = "New") =>
  ({ id, country: "Syria", name, weight, packagingType, category: "Core", sortOrder: id, isActive: true });

beforeEach(() => {
  vi.clearAllMocks();
  data.skus = [
    sku(1, "Double Apple", "50g", "Old"), sku(2, "Double Apple", "50g", "New"), sku(6, "Grape", "50g"),
    sku(40, "Mint", "50g"), // SSOF has it; the tracker has no such product
  ];
  data.periods = [
    { id: 9, country: "Syria", year: 2026, month: 9, label: "Sep 26", sortOrder: 0 },
    { id: 10, country: "Syria", year: 2026, month: 10, label: "Oct 26", sortOrder: 1 },
    { id: 11, country: "Syria", year: 2026, month: 11, label: "Nov 26", sortOrder: 2 },
  ];
  // SSOF already holds a manual IMS value for Mint in September, before the tracker handles it
  data.ims = [{ skuId: 40, periodId: 9, value: "77" }];
  data.arrival = []; data.shipment = []; data.events = []; data.forecast = []; data.actual = []; data.foc = [];
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.WS_TRACKER_FEED_URL; delete process.env.WS_TRACKER_FEED_KEY; });

describe("the Syria SKU list SSOF sends the WS Tracker", () => {
  it("sends the active SKUs with the tracker product each one already is, by exact packaging", async () => {
    process.env.WS_TRACKER_FEED_URL = "https://tracker.example/api/ssof";
    process.env.WS_TRACKER_FEED_KEY = "k";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, new: ["Mint 50g"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await pushSkusToTracker()).toEqual({ sent: 4, added: ["Mint 50g"] });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tracker.example/api/ssof");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-ssof-key"]).toBe("k");
    const body = JSON.parse(String(init.body));
    expect(body.country).toBe("Syria");
    expect(body.source).toBe("published");
    const tracker = (id: number) => body.skus.find((s: { id: number }) => s.id === id).tracker;
    expect(tracker(1)).toEqual({ flavour: "Red", format: "50g" });
    expect(tracker(2)).toEqual({ flavour: "Two Apples Black", format: "50g" });
    expect(tracker(6)).toEqual({ flavour: "Grape", format: "50g" });
    expect(tracker(40)).toBeNull();
  });

  it("sends nothing from a development workspace", async () => {
    process.env.WS_TRACKER_FEED_URL = "https://tracker.example/api/ssof";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NODE_ENV", "development");
    try {
      const res = await pushSkusToTracker();
      expect(res.sent).toBe(0);
      expect(res.skipped).toContain("development workspace");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("never sends an empty list, and reports a refusal", async () => {
    process.env.WS_TRACKER_FEED_URL = "https://tracker.example/api/ssof";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pushSkusToTracker()).rejects.toThrow("401");
    data.skus = [];
    fetchMock.mockClear();
    expect(await pushSkusToTracker()).toEqual({ sent: 0, added: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("movements the tracker enters for a SKU SSOF sent it", () => {
  const mint = { flavour: "Mint", format: "50g", ssofSkuId: 40 };
  function feed(): Feed {
    return { country: "Syria", unit: "MC", generatedAt: "2026-11-05",
      period: { from: "2026-09", to: "2026-11", firstMovement: "2026-09-01", lastMovement: "2026-11-05" },
      products: [{ flavour: "Grape", format: "50g", trackerProducts: [] }, { ...mint, trackerProducts: ["Mint 50g"] }],
      ims: [{ flavour: "Grape", format: "50g", month: "2026-10", qty: 50 }, { ...mint, month: "2026-10", qty: 30 }],
      arrivals: [{ ...mint, month: "2026-10", week: 2, qty: 100 }],
      arrivalMovements: [{ ...mint, date: "2026-10-11", qty: 100 }],
      totals: { ims: 80, arrivals: 100 } };
  }

  it("are matched by SSOF id and written like any other product", async () => {
    const plan = await buildPlan(feed());
    const rows = plan.rows.filter(r => r.skuId === 40);
    expect(rows.find(r => r.section === "IMS" && r.month === "2026-10")).toMatchObject({ next: 30, current: 0 });
    expect(rows.find(r => r.section === "Arrival" && r.month === "2026-10")).toMatchObject({ week: 2, next: 100 });
    expect(plan.clearance.events.find(e => e.skuId === 40)).toMatchObject({ date: "2026-10-11", qty: 100 });
    expect(plan.managedSkuIds).toContain(40); // inside the transaction's Syria scope
    expect(plan.unmatchedProducts).toEqual([]);
    // the mapped product still resolves by name
    expect(plan.rows.find(r => r.skuId === 6 && r.section === "IMS" && r.month === "2026-10")).toMatchObject({ next: 50 });
  });

  it("leave that SKU's months before its first tracker movement as SSOF has them", async () => {
    const rows = (await buildPlan(feed())).rows.filter(r => r.skuId === 40);
    // September holds a manual 77: no row touches it
    expect(rows.some(r => r.month === "2026-09")).toBe(false);
    // from October on the tracker is the source: November with no Mint sales is 0
    expect(rows.find(r => r.section === "IMS" && r.month === "2026-11")).toMatchObject({ next: 0 });
  });

  it("report an id that is not an active Syria SKU instead of writing it", async () => {
    const f = feed();
    f.ims.push({ flavour: "Gone", format: "50g", month: "2026-10", qty: 5, ssofSkuId: 99 });
    f.totals.ims += 5;
    const plan = await buildPlan(f);
    expect(plan.unmatchedProducts.map(u => u.flavour)).toEqual(["Gone"]);
    expect(plan.rows.some(r => r.skuId === 99)).toBe(false);
    expect(plan.managedSkuIds).not.toContain(99);
  });
});
