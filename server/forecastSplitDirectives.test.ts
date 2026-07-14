import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set the LLM env key BEFORE importing routers so the mutation's
// `process.env.BUILT_IN_FORGE_API_KEY` check evaluates true at call time.
process.env.BUILT_IN_FORGE_API_KEY = "test-llm-key";

// ────────────────────────────────────────────────────────────────────
// In-memory fixture (mirrors forecastSplitCoverage.test.ts).
// 4 active Lebanon SKUs, one period of IMS each, no shipment / no
// planning-FG rows. The directive-enforcement logic does not depend
// on the rest of the analytics, so this minimal offline fixture is
// enough to drive the recommend mutation end-to-end.
// ────────────────────────────────────────────────────────────────────
type TestSku = {
  id: number;
  country: string;
  name: string;
  weight: string;
  category: "Core" | "NPI";
  packagingType: "Old" | "New";
  sortOrder: number;
  isExcludedFromTotal: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const FIXTURE_SKUS: TestSku[] = [
  { id: 101, country: "Lebanon", name: "Double Apple", weight: "250g", category: "Core", packagingType: "New", sortOrder: 0, isExcludedFromTotal: false, isActive: true, createdAt: new Date(), updatedAt: new Date() },
  { id: 102, country: "Lebanon", name: "Mint",         weight: "250g", category: "Core", packagingType: "New", sortOrder: 1, isExcludedFromTotal: false, isActive: true, createdAt: new Date(), updatedAt: new Date() },
  { id: 103, country: "Lebanon", name: "Blueberry",    weight: "250g", category: "Core", packagingType: "New", sortOrder: 2, isExcludedFromTotal: false, isActive: true, createdAt: new Date(), updatedAt: new Date() },
  { id: 104, country: "Lebanon", name: "Watermelon",   weight: "250g", category: "Core", packagingType: "New", sortOrder: 3, isExcludedFromTotal: false, isActive: true, createdAt: new Date(), updatedAt: new Date() },
];

const FIXTURE_PERIOD = {
  id: 9101,
  country: "Lebanon",
  year: 2025,
  month: 5,
  label: "May 25",
  sortOrder: 0,
};

const FIXTURE_IMS = FIXTURE_SKUS.map((sku, idx) => ({
  id: 2000 + idx,
  skuId: sku.id,
  periodId: FIXTURE_PERIOD.id,
  value: String((idx + 1) * 100), // 100 / 200 / 300 / 400
  isActual: true,
  updatedAt: new Date(),
}));

vi.mock("./db", () => ({
  getSkusForCountry: vi.fn(async () => FIXTURE_SKUS),
  getPeriodsForCountry: vi.fn(async () => [FIXTURE_PERIOD]),
  getImsDataForCountry: vi.fn(async () => FIXTURE_IMS),
  getShipmentDataForCountry: vi.fn(async () => []),
  getFullPlanningDataForCountry: vi.fn(async () => ({
    skus: FIXTURE_SKUS,
    periods: [FIXTURE_PERIOD],
    forecast: [],
    ims: FIXTURE_IMS,
    shipment: [],
    arrival: [],
    planningFg: [],
  })),
  getStockLevelAnalysis: vi.fn(async () => null),
}));

// LLM mock — `invokeLLM` is queued per-test via `setLlmResponses`.
const llmCalls: Array<{ messages: any[] }> = [];
let llmQueue: Array<any | Error> = [];

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async (params: any) => {
    llmCalls.push({ messages: params.messages });
    if (llmQueue.length === 0) {
      throw new Error("test: invokeLLM called more times than expected");
    }
    const next = llmQueue.shift();
    if (next instanceof Error) throw next;
    return next;
  }),
}));

function setLlmResponses(responses: Array<any | Error>) {
  llmQueue = [...responses];
}

function makeLlmJsonResponse(payload: unknown) {
  return {
    id: "test",
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: JSON.stringify(payload) },
        finish_reason: "stop",
      },
    ],
  };
}

// Imported AFTER vi.mock declarations so the mocked modules are wired in.
const { appRouter } = await import("./routers");

// `forecastSplit.recommend` is a `protectedProcedure`, so it requires a
// non-null user on the context — a plain authenticated user is enough.
function makeAuthCtx(): any {
  return {
    user: {
      id: 1,
      openId: "test-planner",
      email: "planner@example.com",
      name: "Test Planner",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: vi.fn() },
  };
}

const BASE_INPUT = {
  country: "Lebanon",
  totalTons: 6,
  mastercaseKg: 6, // 6 tons / 6 kg per MC = 1000 MC total
  targetMonth: 5, // May 2026 — non-Ramadan, non-year-end
  targetYear: 2026,
  includeNpi: true,
};
const EXPECTED_TOTAL_MC = Math.floor((6 * 1000) / 6); // 1000

// LLM response row helper.
function makeLlmRec(sku: TestSku, mc: number) {
  return {
    skuId: sku.id,
    skuName: sku.name,
    weight: sku.weight,
    category: sku.category,
    packagingType: sku.packagingType,
    recommendedMastercases: mc,
    sharePercent: 0,
    reasoning: `LLM rec for ${sku.name}`,
    trend: "stable",
    seasonalityNote: "n/a",
    stockAlert: "unknown",
    confidenceScore: 70,
    primaryDriver: "historical_share",
    marketIntelligenceNote: "n/a",
  };
}

// Returns a single LLM response covering ALL 4 fixture SKUs at the chosen
// pre-directive MC mix (100 / 200 / 300 / 400 → sums to 1000). Using full
// coverage avoids the algorithmic-fallback path so the directive math we
// assert against is the math we authored above.
function fullCoverageResponse() {
  return makeLlmJsonResponse({
    recommendations: [
      makeLlmRec(FIXTURE_SKUS[0], 100),
      makeLlmRec(FIXTURE_SKUS[1], 200),
      makeLlmRec(FIXTURE_SKUS[2], 300),
      makeLlmRec(FIXTURE_SKUS[3], 400),
    ],
    overallInsight: "test",
    warnings: [],
    marketSummary: "test",
  });
}

function getRec(recs: any[], skuId: number) {
  return recs.find((r: any) => r.skuId === skuId);
}

function sumMc(recs: any[]): number {
  return recs.reduce(
    (s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)),
    0,
  );
}

beforeEach(() => {
  llmCalls.length = 0;
  llmQueue = [];
  process.env.BUILT_IN_FORGE_API_KEY = "test-llm-key";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("forecastSplit.recommend — planner directives (UI panel)", () => {
  it("'zero' directive forces target SKU to 0 MC and rebalance preserves total", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        { skuId: FIXTURE_SKUS[0].id, action: "zero" },
      ],
    });

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);

    // Locked SKU honors directive math exactly.
    const zeroed = getRec(result.recommendations, FIXTURE_SKUS[0].id);
    expect(zeroed).toBeDefined();
    expect(zeroed.recommendedMastercases).toBe(0);

    // Total preserved after rebalance.
    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // Non-locked SKUs absorbed the redistributed 100 MC.
    const nonLockedSum = result.recommendations
      .filter((r: any) => r.skuId !== FIXTURE_SKUS[0].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(nonLockedSum).toBe(EXPECTED_TOTAL_MC);

    // Reasoning records the planner directive trace so the UI/audit can show it.
    expect(zeroed.reasoning).toMatch(/Planner directive: zero/);
  });

  it("'reduce' directive cuts target SKU by the requested percentage and rebalance preserves total", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        // SKU 102 starts at 200 MC; reduce 50% → 100 MC.
        { skuId: FIXTURE_SKUS[1].id, action: "reduce", valuePct: 50 },
      ],
    });

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);

    const reduced = getRec(result.recommendations, FIXTURE_SKUS[1].id);
    expect(reduced).toBeDefined();
    // Math: round(200 * (1 - 50/100)) = 100.
    expect(reduced.recommendedMastercases).toBe(100);

    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // Locked SKU value did not drift during the rebalance pass.
    const nonLockedSum = result.recommendations
      .filter((r: any) => r.skuId !== FIXTURE_SKUS[1].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(nonLockedSum).toBe(EXPECTED_TOTAL_MC - 100);

    expect(reduced.reasoning).toMatch(/Planner directive: reduce 50%/);
  });

  it("'increase' directive boosts target SKU by the requested percentage and rebalance preserves total", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        // SKU 103 starts at 300 MC; increase 50% → max(301, round(300*1.5)) = 450 MC.
        { skuId: FIXTURE_SKUS[2].id, action: "increase", valuePct: 50 },
      ],
    });

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);

    const increased = getRec(result.recommendations, FIXTURE_SKUS[2].id);
    expect(increased).toBeDefined();
    expect(increased.recommendedMastercases).toBe(450);

    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // The 150 MC boost was donated by non-locked SKUs.
    const nonLockedSum = result.recommendations
      .filter((r: any) => r.skuId !== FIXTURE_SKUS[2].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(nonLockedSum).toBe(EXPECTED_TOTAL_MC - 450);

    expect(increased.reasoning).toMatch(/Planner directive: increase 50%/);
  });

  it("'cap' directive clamps target SKU at the requested MC ceiling and rebalance preserves total", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        // SKU 104 starts at 400 MC; cap at 50 → min(400, 50) = 50 MC.
        { skuId: FIXTURE_SKUS[3].id, action: "cap", valueMC: 50 },
      ],
    });

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);

    const capped = getRec(result.recommendations, FIXTURE_SKUS[3].id);
    expect(capped).toBeDefined();
    expect(capped.recommendedMastercases).toBe(50);

    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // The 350 MC the cap freed up was absorbed by non-locked SKUs.
    const nonLockedSum = result.recommendations
      .filter((r: any) => r.skuId !== FIXTURE_SKUS[3].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(nonLockedSum).toBe(EXPECTED_TOTAL_MC - 50);

    expect(capped.reasoning).toMatch(/Planner directive: cap/);
  });

  it("'set' directive forces target SKU to an exact MC value (can RAISE above the base, unlike cap)", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        // SKU 101 starts at 100 MC; set to 600 → forced exactly to 600 MC.
        // A "cap" could never raise it; "set" can.
        { skuId: FIXTURE_SKUS[0].id, action: "set", valueMC: 600 },
      ],
    });

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);

    const setRec = getRec(result.recommendations, FIXTURE_SKUS[0].id);
    expect(setRec).toBeDefined();
    expect(setRec.recommendedMastercases).toBe(600);

    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // The extra 500 MC was taken from non-locked SKUs.
    const nonLockedSum = result.recommendations
      .filter((r: any) => r.skuId !== FIXTURE_SKUS[0].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(nonLockedSum).toBe(EXPECTED_TOTAL_MC - 600);

    expect(setRec.reasoning).toMatch(/Planner directive: set/);
  });

  it("'set' to 0 is protected from rebalance refill (treated like zero)", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        // SKU 104 starts at 400 MC; set to 0 → forced to 0 and NOT refilled by rebalance.
        { skuId: FIXTURE_SKUS[3].id, action: "set", valueMC: 0 },
      ],
    });

    const setZero = getRec(result.recommendations, FIXTURE_SKUS[3].id);
    expect(setZero).toBeDefined();
    expect(setZero.recommendedMastercases).toBe(0);

    // Total still preserved; the freed 400 MC went to other SKUs, never back to 104.
    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    const nonLockedSum = result.recommendations
      .filter((r: any) => r.skuId !== FIXTURE_SKUS[3].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(nonLockedSum).toBe(EXPECTED_TOTAL_MC);
  });

  it("multiple directives lock multiple SKUs — rebalance never mutates a locked row", async () => {
    setLlmResponses([fullCoverageResponse()]);

    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.forecastSplit.recommend({
      ...BASE_INPUT,
      skuDirectives: [
        // SKU 101: zeroed (was 100 → 0).
        { skuId: FIXTURE_SKUS[0].id, action: "zero" },
        // SKU 104: capped at 100 (was 400 → 100).
        { skuId: FIXTURE_SKUS[3].id, action: "cap", valueMC: 100 },
      ],
    });

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);

    // Both locked SKUs honor their directive math exactly post-rebalance.
    const zeroed = getRec(result.recommendations, FIXTURE_SKUS[0].id);
    const capped = getRec(result.recommendations, FIXTURE_SKUS[3].id);
    expect(zeroed.recommendedMastercases).toBe(0);
    expect(capped.recommendedMastercases).toBe(100);

    // Total still matches requested totalMastercases exactly.
    expect(sumMc(result.recommendations)).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // Two flexible SKUs (102, 103) absorbed the +400 MC redistribution.
    const flexibleSum = result.recommendations
      .filter((r: any) => r.skuId === FIXTURE_SKUS[1].id || r.skuId === FIXTURE_SKUS[2].id)
      .reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
    expect(flexibleSum).toBe(EXPECTED_TOTAL_MC - 0 - 100);
  });
});
