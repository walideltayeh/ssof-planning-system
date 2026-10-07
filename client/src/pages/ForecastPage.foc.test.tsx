import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ForecastPage from "./ForecastPage";
const m = vi.hoisted(() => ({
  country: "Libya", admin: true, unit: "MC" as "MC" | "KG" | "Tons",
  quantity: vi.fn(), receipt: vi.fn(), review: vi.fn(), paid: vi.fn(), production: vi.fn(),
  invalidate: vi.fn(), query: vi.fn(),
  value: "12.00" as string | null, received: false, entries: [] as any[],
}));
vi.mock("@/contexts/CountryContext", () => ({ useCountry: () => ({ country: m.country, config: { terms: { forecast: "Forecast Production" } } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAppAuth: () => ({ user: { role: "admin" }, isAdminFor: () => m.admin }) }));
vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({
  unit: m.unit, unitLabel: m.unit, formatVal: (q: number) => String(q * (m.unit === "KG" ? 6 : m.unit === "Tons" ? .006 : 1)),
}) }));
vi.mock("@/components/LibyaPoImport", () => ({ default: () => null }));
vi.mock("@/components/ExportSheetButton", () => ({ default: (p: any) => <button data-testid="export" data-include={String(p.includeFoc)} data-unit={p.unit}>Export Forecast</button> }));
vi.mock("@/components/ImportSheetButton", () => ({ default: () => <button>Import Forecast</button> }));
vi.mock("@/lib/trpc", () => {
  const skus = [
    { id: 1, name: "Mint", weight: "50g", packagingType: "New", isActive: true, category: "Core" },
    { id: 2, name: "Inactive", weight: "50g", packagingType: "New", isActive: false, category: "Core" },
  ], periods = [{ id: 9, label: "Sep 26", year: 2026, sortOrder: 1 }];
  const forecast = [{ skuId: 1, periodId: 9, value: "100.00" }];
  const useMutation = (spy: any) => ({ useMutation: (options: any) => ({
    isPending: false,
    mutate: (input: any) => { spy(input); options.onSuccess?.({ warnings: [] }, input); },
    mutateAsync: async (input: any) => { spy(input); await options.onSuccess?.({ warnings: [] }, input); return { success: true }; },
  }) });
  const invalidate = () => ({ invalidate: m.invalidate });
  return { trpc: {
    useUtils: () => ({ focPlanning: { list: invalidate() }, country: {
      data: invalidate(), planningFg: invalidate(), performance: invalidate(), intlAnalysis: invalidate(), stockLevels: invalidate(), currentMonthClosingStock: invalidate(),
    }, data: { forecast: invalidate(), imsVsForecast: invalidate(), planningFg: invalidate() } }),
    data: { forecast: { useQuery: () => ({ data: { skus, periods, data: forecast }, refetch: vi.fn() }) } },
    update: { forecastCell: useMutation(m.paid) },
    country: {
      data: { useQuery: () => ({ data: { skus, periods, forecast }, refetch: vi.fn() }) },
      updateForecast: useMutation(m.paid), updateProduction: useMutation(m.production), updateForecastWeek: useMutation(vi.fn()),
    },
    focPlanning: {
      list: { useQuery: (input: any, options: any) => { m.query(input, options); return {
        data: { cells: [{ skuId: 1, periodId: 9, value: m.value, received: m.received }], receipts: { entries: m.entries } },
        refetch: vi.fn(), error: null,
      }; } },
      update: useMutation(m.quantity), receiptUpdate: useMutation(m.receipt), receiptReview: useMutation(m.review),
    },
  } };
});
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); m.country = "Libya"; m.admin = true; m.unit = "MC"; m.value = "12.00"; m.received = false; m.entries = []; });
afterEach(cleanup);
describe("Forecast Production paired FOC surface", () => {
  it.each(["Libya", "Syria"])("pairs active SKU rows only in %s and shows monthly and SKU totals", country => {
    m.country = country; render(<ForecastPage />);
    const foc = screen.getByRole("row", { name: "FOC Mint 50g New" });
    expect(foc.previousElementSibling?.textContent).toContain("Ordered");
    expect(foc.previousElementSibling).toHaveClass("h-16", "text-base", "font-bold", "text-foreground");
    expect(foc).toHaveClass("text-[10px]", "font-normal", "text-muted-foreground");
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
    expect(within(foc).getByLabelText("Ordered, FOC and combined totals")).toHaveTextContent("Combined 112");
    const grand = screen.getByText("Grand Total").closest("tr")!;
    expect(within(grand).getAllByLabelText("Ordered, FOC and combined totals")[0]).toHaveTextContent("Ordered 100FOC 12Combined 112");
  });
  it("uses the shared switch for combined totals and the exported basis without changing receipt records", () => {
    render(<ForecastPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include FOC" }));
    expect(localStorage.getItem("ssof:include-foc:Libya")).toBe("false");
    expect(screen.getByTestId("export")).toHaveAttribute("data-include", "false");
    const foc = screen.getByRole("row", { name: "FOC Mint 50g New" });
    expect(within(foc).getByLabelText("Ordered, FOC and combined totals")).toHaveTextContent("Combined 100");
    expect(screen.getByText("Ordered only — FOC excluded")).toBeInTheDocument();
    expect(m.receipt).not.toHaveBeenCalled();
  });
  it.each(["MC", "KG", "Tons"] as const)("saves inline %s quantity to the same MC ledger and refreshes consumers", async unit => {
    m.unit = unit; render(<ForecastPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" }));
    const input = screen.getByRole("spinbutton", { name: `FOC quantity Mint 50g New Sep 26 (${unit})` });
    fireEvent.change(input, { target: { value: unit === "MC" ? "20" : unit === "KG" ? "120" : "0.12" } });
    fireEvent.blur(input);
    await waitFor(() => expect(m.quantity).toHaveBeenCalledWith({ country: "Libya", skuId: 1, periodId: 9, value: 20 }));
    expect(m.invalidate).toHaveBeenCalled();
    expect(m.paid).not.toHaveBeenCalled(); expect(m.production).not.toHaveBeenCalled();
  });
  it("saves only Received Yes/No in place, with no receipt date field", () => {
    render(<ForecastPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Received FOC Mint 50g New Sep 26" }));
    expect(m.receipt).toHaveBeenCalledWith({ country: "Libya", skuId: 1, periodId: 9, received: true });
    expect(screen.queryByLabelText(/Received date/)).not.toBeInTheDocument();
  });
  it("keeps viewers read-only for FOC and ordered editing and hides the import action", () => {
    m.admin = false; render(<ForecastPage />);
    expect(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Received FOC Mint 50g New Sep 26" })).toBeDisabled();
    expect(screen.queryByText("Import Forecast")).not.toBeInTheDocument();
    fireEvent.click((screen.getByRole("row", { name: "FOC Mint 50g New" }).previousElementSibling as HTMLTableRowElement).cells[2]);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("→W1"));
    expect(screen.queryByRole("button", { name: "W3" })).not.toBeInTheDocument();
  });
  it("distinguishes missing FOC from explicitly entered zero and clears quantities to not set", async () => {
    m.value = null;
    const view = render(<ForecastPage />);
    expect(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" })).toHaveTextContent("Not set");
    expect(screen.getByRole("checkbox", { name: "Received FOC Mint 50g New Sep 26" })).toBeDisabled();
    m.value = "0.00"; view.rerender(<ForecastPage />);
    expect(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" })).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    fireEvent.blur(screen.getByRole("spinbutton"));
    await waitFor(() => expect(m.quantity).toHaveBeenCalledWith({ country: "Libya", skuId: 1, periodId: 9, value: null }));
  });
  it("resets a pending draft on country and unit switches", () => {
    const view = render(<ForecastPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });
    m.country = "Syria"; view.rerender(<ForecastPage />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(m.quantity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit FOC Mint 50g New Sep 26" }));
    m.unit = "Tons"; view.rerender(<ForecastPage />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
  it("submits an explicit duplicate decision with the current evidence key", () => {
    m.received = true;
    m.entries = [{ skuId: 1, periodId: 9, needsReview: true, reviewKey: "current evidence",
      matches: [{ source: "Clearance arrival", quantity: 12, date: "2026-09-20" }] }];
    render(<ForecastPage />);
    expect(screen.getByText("Possible duplicate — not added to stock.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Already included in arrival" }));
    expect(m.review).toHaveBeenCalledWith({ country: "Libya", skuId: 1, periodId: 9, decision: "included", reviewKey: "current evidence" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Received FOC Mint 50g New Sep 26" }));
    expect(m.receipt).toHaveBeenCalledWith({ country: "Libya", skuId: 1, periodId: 9, received: false });
  });
  it.each(["Lebanon", "KSA"])("does not introduce FOC rows, controls or export parameters in %s", country => {
    m.country = country; render(<ForecastPage />);
    expect(screen.queryByRole("checkbox", { name: "Include FOC" })).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /FOC Mint/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("export")).toHaveAttribute("data-include", "undefined");
    expect(screen.getByTestId("export")).not.toHaveAttribute("data-unit");
    expect(m.query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
});
