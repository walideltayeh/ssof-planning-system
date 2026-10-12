import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MonthlyAnalysis from "./MonthlyAnalysis";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  unit: "MC" as "MC" | "KG" | "Tons",
  writes: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({ trpc: { country: { monthlyAnalysis: { useQuery: mocks.useQuery } } } }));
vi.mock("@/contexts/UnitContext", () => ({
  useUnit: () => ({
    unit: mocks.unit, unitLabel: mocks.unit,
    convertVal: (v: number) => mocks.unit === "KG" ? v * 6 : mocks.unit === "Tons" ? v * .006 : v,
    formatVal: (v: number, decimals = mocks.unit === "Tons" ? 2 : 0) => ((mocks.unit === "KG" ? v * 6 : mocks.unit === "Tons" ? v * .006 : v).toLocaleString("en-US", { maximumFractionDigits: decimals })),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const month = { year: 2025, month: 1, label: "Jan 2025", key: "2025-01" };
function row(id: string, sku: string, last: number, stock: number) {
  return {
    id, sku, weight: "400g", category: "Biscuits", flavour: "Plain", total: false,
    rates: { avg3: last, avg6: last + 1, avg12: last + 2, last, lastMonth: "Jan 2025", trendPct: 12, direction: "Rising", sampleMonths: 12 },
    stock: { closing: stock, weeks: stock, zone: "Healthy" },
    ims: [last, last + 2], imsTotal: last * 2 + 2,
    volatility: { months: 12, mean: last, stdDev: 2, cvPct: 15, label: "Stable" },
    yoy: [{ month, current: last, prior: last - 1, growthPct: 10, cumulativeCurrent: last, cumulativePrior: last - 1, cumulativeGrowthPct: 10 }],
    comparison: [{ month, forecast: last + 1, actual: last, gap: -1, gapPct: -10 }],
    bias: { months: 6, gapPct: -5, label: "Under-forecast" },
    suggestions: [{ month, suggested: last + 3, current: last, differenceMc: 3, differencePct: 20, material: true, availablePeriod: true, currentClosing: stock, suggestedClosing: stock + 3, currentCover: 3, suggestedCover: 4, seasonalityYears: 4 }],
  };
}
const fixture = {
  country: "Lebanon", asOf: "2025-02-01", windowLabel: "Selected period",
  gridMonths: [month, { ...month, month: 2, label: "Feb 2025", key: "2025-02" }],
  selectedMonths: [month], forecastMonths: [month],
  rows: [row("a", "Alpha", 10, 3), row("b", "Bravo", 20, 8)],
  totals: [{ ...row("country-total", "Lebanon", 30, 11), weight: "All weights", total: true }],
  seasonality: [{ group: "Lebanon · 400g", months: [{ month: 1, index: 1.2, years: 4, ramadanYears: [2022, 2024], summer: false }] }],
  materialThresholdPct: 15, notes: ["History limited to four complete years."],
};

describe("MonthlyAnalysis planner", () => {
  beforeEach(() => {
    mocks.unit = "MC";
    mocks.writes.mockClear();
    mocks.toastError.mockClear();
    mocks.useQuery.mockReturnValue({ data: fixture, isLoading: false, error: null });
  });
  afterEach(cleanup);

  it("passes page input unchanged, renders all eight planner blocks in order and stays read-only", () => {
    const input = { country: "Lebanon", preset: "ytd", compare: "plan", filters: { weights: ["400g"] } } as any;
    render(<MonthlyAnalysis input={input} />);
    expect(mocks.useQuery).toHaveBeenCalledWith(input);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings.slice(1, 9)).toEqual([
      "01 · IMS Running Rate", "02 · Stock Levels", "03 · 24-month IMS matrix", "04 · Seasonality calendar",
      "05 · Year-on-year", "06 · Volatility", "07 · Forecast vs actual", "08 · Next 6 suggestions",
    ]);
    expect(screen.getAllByText("3 MC").length).toBeGreaterThan(0);
    expect(screen.getByText("2022, 2024")).toBeInTheDocument();
    ["IMS Running Rate", "Stock Levels", "24-month IMS matrix", "Year-on-year", "Volatility", "Forecast vs actual", "Next 6 suggestions"].forEach((name) => {
      expect(within(screen.getByRole("table", { name })).getAllByText(/Lebanon · All weights total/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: /apply|edit|save/i })).not.toBeInTheDocument();
    expect(mocks.writes).not.toHaveBeenCalled();
  });

  it("sorts values numerically with keyboard-accessible sort buttons", () => {
    render(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    const rateTable = screen.getByRole("table", { name: "IMS Running Rate" });
    const latestSort = within(rateTable).getByRole("button", { name: /Latest IMS/ });
    latestSort.focus();
    fireEvent.keyDown(latestSort, { key: "Enter" });
    fireEvent.click(latestSort);
    const rows = within(rateTable).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Alpha");
    expect(rows[2]).toHaveTextContent("Bravo");
    expect(within(rateTable).getByRole("columnheader", { name: /Latest IMS/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("sorts year/month columns chronologically and seasonality by month number", () => {
    const december = { year: 2024, month: 12, label: "Dec 2024", key: "2024-12" };
    const chronologicalFixture = {
      ...fixture,
      rows: fixture.rows.map((source) => ({
        ...source,
        yoy: [...source.yoy, { ...source.yoy[0], month: december }],
        comparison: [...source.comparison, { ...source.comparison[0], month: december }],
        suggestions: [...source.suggestions, { ...source.suggestions[0], month: december }],
      })),
      seasonality: [{ group: "Lebanon · 400g", months: [
        { month: 9, index: 1, years: 4, ramadanYears: [], summer: true },
        { month: 2, index: 1, years: 4, ramadanYears: [], summer: false },
      ] }],
    };
    mocks.useQuery.mockReturnValue({ data: chronologicalFixture, isLoading: false, error: null });
    render(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    const yoy = screen.getByRole("table", { name: "Year-on-year" });
    fireEvent.click(within(yoy).getByRole("button", { name: /^Month/ }));
    expect(within(yoy).getAllByRole("row")[1]).toHaveTextContent("Dec 2024");
    const comparison = screen.getByRole("table", { name: "Forecast vs actual" });
    fireEvent.click(within(comparison).getByRole("button", { name: /^Month/ }));
    expect(within(comparison).getAllByRole("row")[1]).toHaveTextContent("Dec 2024");
    const suggestions = screen.getByRole("table", { name: "Next 6 suggestions" });
    fireEvent.click(within(suggestions).getByRole("button", { name: /^Month/ }));
    expect(within(suggestions).getAllByRole("row")[1]).toHaveTextContent("Dec 2024");
    const seasonality = screen.getByRole("table", { name: "Seasonality calendar" });
    fireEvent.click(within(seasonality).getByRole("button", { name: /^Month/ }));
    expect(within(seasonality).getAllByRole("row")[1]).toHaveTextContent("Feb");
    expect(within(seasonality).getAllByRole("row")[2]).toHaveTextContent("Sep");
  });

  it("converts quantity display on unit switch while preserving MC suggestion difference and unconverted cover", () => {
    mocks.unit = "KG";
    render(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    expect(screen.getAllByText("60", { exact: true }).length).toBeGreaterThan(0);
    const suggestions = screen.getByRole("table", { name: "Next 6 suggestions" });
    expect(within(suggestions).getAllByText("3 MC").length).toBeGreaterThan(0);
    expect(within(suggestions).getAllByText("3 wks").length).toBeGreaterThan(0);
    expect(within(suggestions).getAllByText("18", { exact: true }).length).toBeGreaterThan(0);
  });

  it("exports a table and retains a materialized workbook download", async () => {
    const fullGrid = {
      ...fixture,
      gridMonths: Array.from({ length: 24 }, (_, i) => ({ ...month, key: `month-${i}`, label: `Month ${i + 1}` })),
      rows: fixture.rows.map(source => ({ ...source, ims: Array(24).fill(source.rates.last) })),
      totals: fixture.totals.map(source => ({ ...source, ims: Array(24).fill(source.rates.last) })),
    };
    mocks.useQuery.mockReturnValue({ data: fullGrid, isLoading: false, error: null });
    const create = vi.fn().mockReturnValue("blob:monthly-export");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    fireEvent.click(within(screen.getByRole("region", { name: "24-month IMS matrix" })).getByRole("button", { name: /Export Excel/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0][0] as Blob;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.getWorksheet("24-month IMS matrix")!;
    expect(sheet.views[0]).toMatchObject({ xSplit: 1, ySplit: 1, state: "frozen" });
    expect(sheet.columnCount).toBe(28);
    expect(sheet.autoFilter).toBe("A1:AB4");
    expect(sheet.getCell("D2").value).toBe(10);
    click.mockRestore();
  });

  it("reports download failures and marks material differences while null suggestion cover is unknown", async () => {
    const unknownCover = {
      ...fixture,
      rows: fixture.rows.map((source) => ({
        ...source,
        suggestions: source.suggestions.map((suggestion) => ({ ...suggestion, currentCover: null, suggestedCover: null, material: true })),
      })),
    };
    mocks.useQuery.mockReturnValue({ data: unknownCover, isLoading: false, error: null });
    render(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    expect(screen.getByText(/null cover means unknown/i)).toBeInTheDocument();
    const suggestions = screen.getByRole("table", { name: "Next 6 suggestions" });
    const dataRow = within(suggestions).getAllByRole("row")[1];
    const cells = within(dataRow).getAllByRole("cell");
    expect(cells[10]).toHaveTextContent("—");
    expect(cells[11]).toHaveTextContent("—");
    expect(cells[4]).toHaveClass("bg-amber-100");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => { throw new Error("disk unavailable"); } });
    fireEvent.click(within(screen.getByRole("region", { name: "Next 6 suggestions" })).getByRole("button", { name: /Export Excel/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining("Could not export Next 6 suggestions: disk unavailable")));
  });

  it("shows composed loading, error and no-data states", () => {
    mocks.useQuery.mockReturnValueOnce({ data: undefined, isLoading: true, error: null });
    const view = render(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    expect(screen.getByLabelText("Loading monthly analysis")).toBeInTheDocument();
    mocks.useQuery.mockReturnValueOnce({ data: undefined, isLoading: false, error: { message: "Access denied" } });
    view.rerender(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    mocks.useQuery.mockReturnValueOnce({ data: undefined, isLoading: false, error: null });
    view.rerender(<MonthlyAnalysis input={{ country: "Lebanon" } as any} />);
    expect(screen.getByText("No monthly analysis data")).toBeInTheDocument();
  });
});
