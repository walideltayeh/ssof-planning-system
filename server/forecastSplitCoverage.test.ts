import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set the LLM env key BEFORE importing routers so the mutation's
// `process.env.BUILT_IN_FORGE_API_KEY` check evaluates true at call time.
// Individual tests delete/restore it to exercise the no-LLM path.
process.env.BUILT_IN_FORGE_API_KEY = "test-llm-key";

// ────────────────────────────────────────────────────────────────────
// In-memory test fixture: 4 active Lebanon SKUs with one period of IMS
// each, no shipment / no planning-FG rows. The coverage validator does
// not depend on the rest of the analytics, so this minimal fixture is
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

// One period in the past (Apr 2026 input → use 2025 data so trend math has
// something to chew on, but the coverage validator is independent of trend).
const FIXTURE_PERIOD = {
  id: 9001,
  country: "Lebanon",
  year: 2025,
  month: 5,
  label: "May 25",
  sortOrder: 0,
};

const FIXTURE_IMS = FIXTURE_SKUS.map((sku, idx) => ({
  id: 1000 + idx,
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

function makeCtx(): any {
  return {
    user: null,
    req: { protocol: "https", headers: {} },
    res: {},
  };
}

const RECOMMEND_INPUT = {
  country: "Lebanon",
  totalTons: 6,
  mastercaseKg: 6, // 6 tons / 6 kg per MC = 1000 MC total
  targetMonth: 5,  // May 2026 — non-Ramadan, non-year-end
  targetYear: 2026,
  includeNpi: true,
};
const EXPECTED_TOTAL_MC = Math.floor((6 * 1000) / 6); // 1000

// Helper: build an LLM recommendation row for the given SKU id and MC count.
function makeLlmRec(sku: TestSku, mc: number) {
  return {
    skuId: sku.id,
    skuName: sku.name,
    weight: sku.weight,
    category: sku.category,
    packagingType: sku.packagingType,
    recommendedMastercases: mc,
    sharePercent: 0, // re-computed by the mutation
    reasoning: `LLM rec for ${sku.name}`,
    trend: "stable",
    seasonalityNote: "n/a",
    stockAlert: "unknown",
    confidenceScore: 70,
    primaryDriver: "historical_share",
    marketIntelligenceNote: "n/a",
  };
}

beforeEach(() => {
  llmCalls.length = 0;
  llmQueue = [];
  process.env.BUILT_IN_FORGE_API_KEY = "test-llm-key";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("forecastSplit.recommend — coverage validator", () => {
  it("fills missing SKUs with the algorithmic generator when the LLM returns a partial array", async () => {
    // Step 1 LLM call: returns ONLY 2 of the 4 active SKUs.
    // Step 2 retry LLM call: returns nothing useful (empty recommendations),
    //   forcing the algorithmic fallback to handle the remaining 2 SKUs.
    setLlmResponses([
      makeLlmJsonResponse({
        recommendations: [
          makeLlmRec(FIXTURE_SKUS[0], 600),
          makeLlmRec(FIXTURE_SKUS[1], 400),
        ],
        overallInsight: "partial",
        warnings: [],
        marketSummary: "test",
      }),
      makeLlmJsonResponse({ recommendations: [] }),
    ]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.forecastSplit.recommend(RECOMMEND_INPUT);

    // One row per active SKU, in any order.
    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);
    const coveredIds = result.recommendations
      .map((r: any) => r.skuId)
      .sort((a: number, b: number) => a - b);
    expect(coveredIds).toEqual(FIXTURE_SKUS.map(s => s.id).sort((a, b) => a - b));
    // No SKU id appears more than once.
    expect(new Set(coveredIds).size).toBe(FIXTURE_SKUS.length);

    // Mastercases sum is preserved exactly through fill + rebalance.
    const sumMc = result.recommendations.reduce(
      (s: number, r: any) => s + r.recommendedMastercases,
      0,
    );
    expect(sumMc).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);

    // The 2 SKUs the LLM omitted should be tagged as algorithmic-fallback rows.
    const fallbackRows = result.recommendations.filter(
      (r: any) => typeof r.reasoning === "string" && r.reasoning.includes("Algorithmic fallback"),
    );
    expect(fallbackRows).toHaveLength(2);
    const fallbackIds = fallbackRows.map((r: any) => r.skuId).sort((a: number, b: number) => a - b);
    expect(fallbackIds).toEqual([FIXTURE_SKUS[2].id, FIXTURE_SKUS[3].id]);
  });

  it("uses the LLM retry response to cover the missing SKUs (no algorithmic fallback needed)", async () => {
    // Step 1: LLM returns 2 of 4. Step 2 retry: LLM returns the OTHER 2.
    setLlmResponses([
      makeLlmJsonResponse({
        recommendations: [
          makeLlmRec(FIXTURE_SKUS[0], 500),
          makeLlmRec(FIXTURE_SKUS[1], 500),
        ],
        overallInsight: "first pass",
        warnings: [],
        marketSummary: "test",
      }),
      makeLlmJsonResponse({
        recommendations: [
          makeLlmRec(FIXTURE_SKUS[2], 200),
          makeLlmRec(FIXTURE_SKUS[3], 200),
        ],
      }),
    ]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.forecastSplit.recommend(RECOMMEND_INPUT);

    // Coverage retry must have been invoked (2 LLM calls total).
    expect(llmCalls).toHaveLength(2);
    // The retry call's prompt should reference the still-missing SKU ids so
    // the LLM can target them — checked by behavior (ids appear somewhere in
    // any user-role message) rather than exact prompt wording.
    const missingSkuIds = [FIXTURE_SKUS[2].id, FIXTURE_SKUS[3].id];
    const retryUserContent = llmCalls[1].messages
      .filter((m: any) => m.role === "user")
      .map((m: any) => String(m.content ?? ""))
      .join("\n");
    for (const id of missingSkuIds) {
      expect(retryUserContent).toContain(String(id));
    }

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);
    const coveredIds = result.recommendations
      .map((r: any) => r.skuId)
      .sort((a: number, b: number) => a - b);
    expect(coveredIds).toEqual(FIXTURE_SKUS.map(s => s.id).sort((a, b) => a - b));
    expect(new Set(coveredIds).size).toBe(FIXTURE_SKUS.length);

    const sumMc = result.recommendations.reduce(
      (s: number, r: any) => s + r.recommendedMastercases,
      0,
    );
    expect(sumMc).toBe(EXPECTED_TOTAL_MC);

    // No row should be tagged with the algorithmic-fallback prefix when the
    // retry covered everything. (Reasoning content comes straight from the
    // LLM mock above, which never includes that phrase.)
    for (const rec of result.recommendations) {
      expect(rec.reasoning ?? "").not.toMatch(/Algorithmic fallback/);
    }
  });

  it("drops a hallucinated SKU row that does not match any active SKU", async () => {
    // LLM returns valid rows for all 4 active SKUs PLUS a hallucinated 5th row
    // whose name/weight/packaging do not match anything in the catalog and
    // whose skuId is invalid. Step 1a must DROP the hallucinated row entirely
    // so the final response only contains the 4 real SKUs and the total still
    // equals totalMastercases.
    const hallucinatedRow = {
      skuId: 9999, // not in catalog
      skuName: "Dragonfruit Surprise", // no fuzzy match either
      weight: "999g",
      category: "Core" as const,
      packagingType: "New" as const,
      recommendedMastercases: 100,
      sharePercent: 0,
      reasoning: "LLM hallucinated this SKU",
      trend: "stable",
      seasonalityNote: "n/a",
      stockAlert: "unknown",
      confidenceScore: 70,
      primaryDriver: "historical_share",
      marketIntelligenceNote: "n/a",
    };
    setLlmResponses([
      makeLlmJsonResponse({
        recommendations: [
          makeLlmRec(FIXTURE_SKUS[0], 250),
          makeLlmRec(FIXTURE_SKUS[1], 250),
          makeLlmRec(FIXTURE_SKUS[2], 250),
          makeLlmRec(FIXTURE_SKUS[3], 250),
          hallucinatedRow,
        ],
        overallInsight: "with hallucinated row",
        warnings: [],
        marketSummary: "test",
      }),
    ]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.forecastSplit.recommend(RECOMMEND_INPUT);

    // No retry should be needed (all 4 active SKUs are covered by valid rows).
    expect(llmCalls).toHaveLength(1);

    // Exactly one row per active SKU, hallucinated row is gone.
    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);
    const coveredIds = result.recommendations
      .map((r: any) => r.skuId)
      .sort((a: number, b: number) => a - b);
    expect(coveredIds).toEqual(FIXTURE_SKUS.map(s => s.id).sort((a, b) => a - b));
    expect(new Set(coveredIds).size).toBe(FIXTURE_SKUS.length);

    // No row carries the hallucinated SKU's signature.
    for (const rec of result.recommendations) {
      expect(rec.skuId).not.toBe(9999);
      expect(String(rec.skuName ?? "").toLowerCase()).not.toContain("dragonfruit");
      expect(String(rec.reasoning ?? "")).not.toContain("hallucinated");
    }

    // Total mastercases preserved exactly.
    const sumMc = result.recommendations.reduce(
      (s: number, r: any) => s + r.recommendedMastercases,
      0,
    );
    expect(sumMc).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);
  });

  it("collapses duplicate rows for the same SKU and keeps the higher-MC one", async () => {
    // LLM returns TWO rows that both resolve to FIXTURE_SKUS[0] (skuId 101) with
    // different MC values, plus one row each for the other 3 SKUs. Step 1a must
    // collapse the duplicates to a single row for SKU 101, and the survivor must
    // be the higher-MC duplicate.
    const highDup = {
      ...makeLlmRec(FIXTURE_SKUS[0], 600),
      reasoning: "HIGH-MC duplicate for SKU 101",
    };
    const lowDup = {
      ...makeLlmRec(FIXTURE_SKUS[0], 100),
      reasoning: "LOW-MC duplicate for SKU 101",
    };
    setLlmResponses([
      makeLlmJsonResponse({
        recommendations: [
          highDup,
          lowDup,
          makeLlmRec(FIXTURE_SKUS[1], 200),
          makeLlmRec(FIXTURE_SKUS[2], 100),
          makeLlmRec(FIXTURE_SKUS[3], 100),
        ],
        overallInsight: "with duplicates",
        warnings: [],
        marketSummary: "test",
      }),
    ]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.forecastSplit.recommend(RECOMMEND_INPUT);

    // No retry should be needed (after collapse, all 4 active SKUs are covered).
    expect(llmCalls).toHaveLength(1);

    // Exactly one row per active SKU, no duplicates.
    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);
    const coveredIds = result.recommendations
      .map((r: any) => r.skuId)
      .sort((a: number, b: number) => a - b);
    expect(coveredIds).toEqual(FIXTURE_SKUS.map(s => s.id).sort((a, b) => a - b));
    expect(new Set(coveredIds).size).toBe(FIXTURE_SKUS.length);

    // The single surviving row for SKU 101 must be the HIGH-MC duplicate, not
    // the LOW-MC one. Verified via the distinct reasoning string we attached.
    const sku101Rows = result.recommendations.filter((r: any) => r.skuId === FIXTURE_SKUS[0].id);
    expect(sku101Rows).toHaveLength(1);
    expect(sku101Rows[0].reasoning).toBe("HIGH-MC duplicate for SKU 101");

    // Total mastercases preserved exactly.
    const sumMc = result.recommendations.reduce(
      (s: number, r: any) => s + r.recommendedMastercases,
      0,
    );
    expect(sumMc).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);
  });

  it("uses the pure algorithmic generator when no LLM key is configured", async () => {
    // No env key → mutation never calls invokeLLM and the algorithmic
    // generator builds the whole recommendation array.
    delete process.env.BUILT_IN_FORGE_API_KEY;
    setLlmResponses([]); // any invokeLLM call would now throw.

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.forecastSplit.recommend(RECOMMEND_INPUT);

    expect(llmCalls).toHaveLength(0);

    expect(result.recommendations).toHaveLength(FIXTURE_SKUS.length);
    const coveredIds = result.recommendations
      .map((r: any) => r.skuId)
      .sort((a: number, b: number) => a - b);
    expect(coveredIds).toEqual(FIXTURE_SKUS.map(s => s.id).sort((a, b) => a - b));
    expect(new Set(coveredIds).size).toBe(FIXTURE_SKUS.length);

    const sumMc = result.recommendations.reduce(
      (s: number, r: any) => s + r.recommendedMastercases,
      0,
    );
    expect(sumMc).toBe(EXPECTED_TOTAL_MC);
    expect(result.totalMastercases).toBe(EXPECTED_TOTAL_MC);
  });
});
