import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const state = vi.hoisted(() => ({ countries: '["Syria"]', owner: false, load: vi.fn(async input => ({ country: input.country })) }));
vi.mock("./db", () => ({ getAppUserByUsername: vi.fn(async () => ({ isOwner: state.owner, countries: state.countries })) }));
vi.mock("./analysis/countryPerformance", () => ({ getMonthlyAnalysis: state.load }));
vi.mock("./countryVisibility", () => ({ assertCountryVisible: vi.fn(async () => {}), hiddenCountries: vi.fn(async () => new Set()) }));
const { appRouter } = await import("./routers");
const { assertCountryVisible } = await import("./countryVisibility");
const context = () => ({
  user: { id: 1, openId: "test", name: "Planner", role: "user" },
  req: { protocol: "https", headers: {} }, res: {},
}) as TrpcContext;
beforeEach(() => {
  vi.clearAllMocks(); state.countries = '["Syria"]'; state.owner = false;
});
describe("monthly analysis permissions and request forwarding", () => {
  it.each(["Lebanon", "Syria", "Libya", "KSA"] as const)("allows an assigned viewer to read %s with the exact header filters/basis", async country => {
    state.countries = JSON.stringify([country]);
    const input = { country, preset: "custom" as const, from: "2026-01", to: "2026-09", compare: "ly" as const,
      filters: { weights: ["50g"], categories: ["Core"], flavours: ["Mint"] }, includeFoc: false, refresh: true };
    await expect(appRouter.createCaller(context()).country.monthlyAnalysis(input)).resolves.toEqual({ country });
    expect(state.load).toHaveBeenCalledWith(input);
  });
  it("refuses another country before loading any planner data", async () => {
    await expect(appRouter.createCaller(context()).country.monthlyAnalysis({ country: "Libya", preset: "ytd", compare: "plan" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.load).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    await expect(appRouter.createCaller({ ...context(), user: null }).country.monthlyAnalysis({ country: "Syria", preset: "ytd", compare: "plan" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.load).not.toHaveBeenCalled();
  });
  it("refuses hidden countries even for an owner", async () => {
    state.owner = true;
    vi.mocked(assertCountryVisible).mockRejectedValueOnce(new Error("This country is hidden"));
    await expect(appRouter.createCaller(context()).country.monthlyAnalysis({ country: "Syria", preset: "ytd", compare: "plan" })).rejects.toThrow(/hidden/);
    expect(state.load).not.toHaveBeenCalled();
  });
});
