import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ForecastPage from "./ForecastPage";
import FocRecordPage from "./FocRecordPage";
import { matchFocDrafts } from "@shared/focEntry";

const m = vi.hoisted(() => ({
  country: "Libya", admin: true, unit: "MC" as "MC" | "KG" | "Tons",
  paid: vi.fn(), production: vi.fn(), invalidate: vi.fn(), query: vi.fn(),
  preview: vi.fn(), commit: vi.fn(), entriesCommit: vi.fn(),
  movePreview: vi.fn(), moveCommit: vi.fn(),
  value: "12.00" as string | null, received: false, lines: [] as any[], entries: [] as any[],
}));
vi.mock("@/contexts/CountryContext", () => ({ useCountry: () => ({ country: m.country, config: { terms: { forecast: "Forecast Production" } } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAppAuth: () => ({ user: { role: "admin" }, isAdminFor: () => m.admin }) }));
vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({
  unit: m.unit, unitLabel: m.unit, formatVal: (q: number) => String(q * (m.unit === "KG" ? 6 : m.unit === "Tons" ? .006 : 1)),
}) }));
vi.mock("@/components/ExportSheetButton", () => ({ default: (p: any) => <button data-testid="export" data-include={String(p.includeFoc)} data-unit={p.unit}>Export Forecast</button> }));
vi.mock("@/components/ImportSheetButton", () => ({ default: () => <button>Import Forecast</button> }));
vi.mock("@/lib/trpc", () => {
  const skus = [
    { id: 1, name: "Mint", weight: "50g", packagingType: "New", isActive: true, category: "Core" },
    { id: 2, name: "Inactive", weight: "50g", packagingType: "New", isActive: false, category: "Core" },
    { id: 3, name: "Mint", weight: "50g", packagingType: "Old", isActive: true, category: "Core" },
  ], periods = [{ id: 9, label: "Sep 26", year: 2026, month: 9, sortOrder: 1 }];
  const forecast = [{ skuId: 1, periodId: 9, value: "100.00" }];
  const useMutation = (spy: any) => ({ useMutation: (options: any) => ({
    isPending: false, mutate: (input: any) => { spy(input); options.onSuccess?.({ warnings: [] }, input); },
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
      previewMove: { useMutation: () => ({ isPending: false, mutateAsync: async (input: any) => {
        m.movePreview(input); return { token: "b".repeat(64), canSave: true, rows: [], impact: [
          { sku: "Mint · 50g · New", month: "Sep 26", before: 112, after: 100, beforeArrivals: 12, afterArrivals: 0 },
          { sku: "Mint · 50g · Old", month: "Sep 26", before: 100, after: 112, beforeArrivals: 0, afterArrivals: 12 },
        ], warnings: [], move: { sourceSku: "Mint · 50g · New", targetSku: "Mint · 50g · Old",
          sourceTotalBefore: 12, sourceTotalAfter: 0, targetTotalBefore: 5, targetTotalAfter: 17,
          months: [{ periodId: 9, month: "Sep 26", quantityMC: 12, receivedMC: 12, sourceBefore: 12,
            sourceAfter: 0, targetBefore: 5, targetAfter: 17, sourceLineCount: 1, targetLineCount: 1, resultLineCount: 2 }] } };
      } }) },
      commitMove: { useMutation: () => ({ isPending: false, mutateAsync: async (input: any) => {
        m.moveCommit(input); return { success: true, versionId: 43, warnings: [] };
      } }) },
      list: { useQuery: (input: any, options: any) => { m.query(input, options); return {
        data: { skus, periods, cells: [{ skuId: 1, periodId: 9, value: m.value, received: m.received, lines: m.lines }], receipts: { entries: m.entries } },
        refetch: vi.fn(), error: null,
      }; } },
      previewCell: { useMutation: () => ({ isPending: false, mutateAsync: async (input: any) => {
        m.preview(input); return { token: "a".repeat(64), canSave: true, rows: [], impact: [], warnings: [] };
      } }) },
      commitCell: { useMutation: () => ({ isPending: false, mutateAsync: async (input: any) => {
        m.commit(input); return { success: true, versionId: 42, warnings: [] };
      } }) },
      previewEntries: { useMutation: () => ({ isPending: false, mutateAsync: async (input: any) => {
        m.preview(input); const rows = matchFocDrafts(input.lines, skus, periods, input.country);
        return { token: "a".repeat(64), canSave: rows.every(r => !r.errors.length), rows, impact: [], warnings: [] };
      } }) },
      commitEntries: { useMutation: () => ({ isPending: false, mutateAsync: async (input: any) => {
        m.entriesCommit(input); return { success: true, versionId: 43, warnings: [] };
      } }) },
    },
  } };
});
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks(); localStorage.clear(); m.country = "Libya"; m.admin = true; m.unit = "MC";
  m.value = "12.00"; m.received = false; m.entries = []; m.lines = [];
});
afterEach(cleanup);
const label = "Mint 50g New Sep 26";
const confirm = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and save" }));
  await waitFor(() => expect(m.commit.mock.calls.length + m.entriesCommit.mock.calls.length).toBeGreaterThan(0));
};
describe("Forecast Production is independent of FOC", () => {
  it.each(["Lebanon", "Libya", "Syria", "KSA"])("restores the paid-only grid and exports without loading FOC in %s", country => {
    m.country = country; localStorage.setItem(`ssof:include-foc:${country}`, "false"); render(<ForecastPage />);
    expect(screen.queryByRole("button", { name: "Record FOC" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Combined|Ordered only|Include FOC/)).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /FOC Mint/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("export")).toHaveAttribute("data-include", "undefined");
    expect(screen.getByTestId("export")).not.toHaveAttribute("data-unit");
    expect(screen.getByText("Grand Total").closest("tr")).toHaveTextContent("100");
    expect(m.query).not.toHaveBeenCalled();
  });
  it("restores the original muted header and natural column layout without the modified red header", () => {
    render(<ForecastPage />);
    expect(document.querySelector("table")).toHaveClass("w-full", "text-xs", "border-collapse");
    expect(document.querySelector("colgroup")).not.toBeInTheDocument();
    const rows = [...document.querySelectorAll("thead tr")];
    expect(rows[0]).toHaveClass("bg-muted");
    expect(rows[1]).toHaveClass("bg-muted", "border-b");
    expect(rows[0].children[0]).toHaveClass("px-2", "py-2", "font-medium", "text-muted-foreground", "min-w-[50px]");
    expect(rows[0].children[1]).toHaveClass("px-2", "py-2", "font-medium", "text-muted-foreground", "min-w-[180px]");
    expect(rows[1].children[2]).toHaveClass("px-1", "py-1", "text-muted-foreground", "min-w-[60px]", "text-[10px]");
    expect(rows[1].children[3]).toHaveClass("border-amber-400", "bg-amber-50", "text-amber-800", "min-w-[70px]");
    expect(document.querySelector("thead")!.innerHTML).not.toContain("#7f1d1d");
    expect(document.querySelector("thead")!.innerHTML).not.toContain("#8f2a2a");
  });
  it("keeps viewers from editing the paid forecast or importing", () => {
    m.admin = false; render(<ForecastPage />);
    expect(screen.queryByText("Import Forecast")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Mint")[0].closest("tr")!.cells[2]);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(m.paid).not.toHaveBeenCalled();
  });
});
describe("separate FOC Record", () => {
  it("previews a whole-row reassignment, explains the merge and stock impact, then commits only after confirmation", async () => {
    render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Move FOC for Mint 50g New to another SKU" }));
    fireEvent.click(screen.getByRole("combobox", { name: "SKU" }));
    fireEvent.click(screen.getByRole("option", { name: /Mint.*50g.*Old/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview move" }));
    await screen.findByRole("button", { name: "Confirm and save" });
    expect(m.movePreview).toHaveBeenCalledWith({ country: "Libya", sourceSkuId: 1, targetSkuId: 3 });
    expect(m.moveCommit).not.toHaveBeenCalled();
    expect(screen.getByText("Lines before → after")).toBeInTheDocument();
    expect(screen.getByText("Arrivals (MC)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(m.moveCommit).toHaveBeenCalledWith({ country: "Libya", sourceSkuId: 1, targetSkuId: 3, token: "b".repeat(64) }));
    expect(m.invalidate).toHaveBeenCalled();
  });
  it("starts a cell reassignment with only that month's scope", async () => {
    render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `View recorded FOC lines ${label}` }));
    fireEvent.click(screen.getByRole("button", { name: "Move this month to another SKU" }));
    fireEvent.click(screen.getByRole("combobox", { name: "SKU" }));
    fireEvent.click(screen.getByRole("option", { name: /Mint.*50g.*Old/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview move" }));
    await screen.findByRole("button", { name: "Confirm and save" });
    expect(m.movePreview).toHaveBeenCalledWith({ country: "Libya", sourceSkuId: 1, targetSkuId: 3, periodIds: [9] });
  });
  it.each(["Selected months", "Month range"])("previews %s with explicit month IDs and keeps KG display separate from stored MC", async mode => {
    m.unit = "KG"; render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Move FOC for Mint 50g New to another SKU" }));
    fireEvent.click(screen.getByRole("combobox", { name: "SKU" }));
    fireEvent.click(screen.getByRole("option", { name: /Mint.*50g.*Old/ }));
    fireEvent.click(screen.getByRole("radio", { name: mode }));
    if (mode === "Selected months") fireEvent.click(screen.getByRole("checkbox", { name: "Sep 26" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview move" }));
    await screen.findByRole("button", { name: "Confirm and save" });
    expect(m.movePreview).toHaveBeenCalledWith({ country: "Libya", sourceSkuId: 1, targetSkuId: 3, periodIds: [9] });
    expect(screen.getByText("Moving quantity (KG)")).toBeInTheDocument();
    expect(screen.getByText("Source before → after (KG)")).toBeInTheDocument();
    expect(screen.getAllByText("72").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(m.moveCommit).toHaveBeenCalledWith({ country: "Libya", sourceSkuId: 1, targetSkuId: 3, periodIds: [9], token: "b".repeat(64) }));
  });
  it("discards a preview when the unit context changes instead of confirming stale move data", async () => {
    const view = render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Move FOC for Mint 50g New to another SKU" }));
    fireEvent.click(screen.getByRole("combobox", { name: "SKU" }));
    fireEvent.click(screen.getByRole("option", { name: /Mint.*50g.*Old/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview move" }));
    await screen.findByRole("button", { name: "Confirm and save" });
    m.unit = "Tons"; view.rerender(<FocRecordPage />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm and save" })).not.toBeInTheDocument());
    expect(m.moveCommit).not.toHaveBeenCalled();
  });
  it("does not expose reassignment to viewers", () => {
    m.admin = false; render(<FocRecordPage />);
    expect(screen.queryByRole("button", { name: /Move FOC/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `View recorded FOC lines ${label}` }));
    expect(screen.queryByRole("button", { name: "Move this month to another SKU" })).not.toBeInTheDocument();
  });
  it("uses exactly the same restored header and column layout as Forecast Production", () => {
    const forecast = render(<ForecastPage />);
    const originalHeader = document.querySelector("thead")!.outerHTML;
    forecast.unmount();
    render(<FocRecordPage />);
    expect(document.querySelector("thead")!.outerHTML).toBe(originalHeader);
    expect(document.querySelector("table")).toHaveClass("w-full", "text-xs", "border-collapse");
    expect(document.querySelector("colgroup")).not.toBeInTheDocument();
  });
  it.each(["Libya", "Syria"])("shows one active-SKU row and monthly/year receipt splits in %s", country => {
    m.country = country; render(<FocRecordPage />);
    const row = screen.getByRole("row", { name: "FOC Mint 50g New" });
    expect(row).toHaveClass("border-b", "border-border", "hover:bg-muted");
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
    expect(screen.getByText("Grand Total").closest("tr")).toHaveTextContent("12");
    expect(screen.getByText("Grand Total").closest("tr")).toHaveClass("bg-slate-100", "font-bold");
    expect(screen.getByText("Grand Total").closest("tfoot")).not.toHaveClass("sticky");
    expect(screen.getByText("Received total")).toBeInTheDocument();
    expect(screen.getByText("Not received total").closest("tr")).toHaveTextContent("12");
    expect(m.query).toHaveBeenCalledWith({ country, includeFoc: true }, expect.objectContaining({ enabled: true }));
  });
  it("does not share Analysis's excluded basis or offer a basis switch", () => {
    localStorage.setItem("ssof:include-foc:Libya", "false"); m.received = true; render(<FocRecordPage />);
    expect(m.query).toHaveBeenCalledWith({ country: "Libya", includeFoc: true }, expect.anything());
    expect(screen.queryByRole("checkbox", { name: "Include FOC" })).not.toBeInTheDocument();
    expect(screen.getByText("Received total").closest("tr")).toHaveTextContent("12");
  });
  it.each(["MC", "KG", "Tons"] as const)("previews and confirms displayed %s edits as MC, never writing paid data", async unit => {
    m.unit = unit; render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `Edit FOC ${label}` }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: unit === "MC" ? "20" : unit === "KG" ? "120" : "0.12" } });
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" });
    await screen.findByRole("button", { name: "Confirm and save" });
    expect(m.commit).not.toHaveBeenCalled();
    await confirm();
    expect(m.commit).toHaveBeenCalledWith(expect.objectContaining({ country: "Libya", skuId: 1, periodId: 9, value: 20, token: "a".repeat(64) }));
    expect(m.invalidate).toHaveBeenCalled();
    expect(m.paid).not.toHaveBeenCalled(); expect(m.production).not.toHaveBeenCalled();
  });
  it.each([false, true])("can reverse Received status from %s after confirmation", async received => {
    m.received = received; render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: `Received FOC ${label}` }));
    expect(m.commit).not.toHaveBeenCalled(); await confirm();
    expect(m.commit).toHaveBeenCalledWith(expect.objectContaining({ received: !received, includeFoc: true }));
  });
  it("allows entry in an empty existing month, and previews full-cell deletion", async () => {
    m.value = null; const view = render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `Edit FOC ${label}` }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25" } });
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" }); await confirm();
    expect(m.commit).toHaveBeenLastCalledWith(expect.objectContaining({ value: 25 }));
    cleanup(); m.value = "25"; view.unmount(); render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `View recorded FOC lines ${label}` }));
    fireEvent.click(screen.getByRole("button", { name: `Delete FOC ${label}` })); await confirm();
    expect(m.commit).toHaveBeenLastCalledWith(expect.objectContaining({ remove: true }));
  });
  it("keeps viewers read-only but lets them inspect source lines", () => {
    m.admin = false; m.lines = [{ id: "one", quantityMC: 12, received: false, date: "Sep-26", flavor: "Mint", weight: "50gr",
      packaging: "New Packaging", accType: "Export", salesManager: "Manager", actor: "Creator", recordedAt: "", source: "Recorded FOC" }];
    render(<FocRecordPage />);
    expect(screen.queryByRole("button", { name: `Edit FOC ${label}` })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `Received FOC ${label}` })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Record FOC" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `View recorded FOC lines ${label}` }));
    expect(screen.getByText(/Manager/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete FOC line/ })).not.toBeInTheDocument();
  });
  it("edits and deletes only the selected expanded recorded line through separate confirmations", async () => {
    m.lines = [{ id: "one", quantityMC: 5, received: true, date: "Sep-26", accType: "Export", salesManager: "Manager A", source: "Recorded FOC" },
      { id: "two", quantityMC: 7, received: false, date: "Sep-26", accType: "Domestic", salesManager: "Manager B", source: "Recorded FOC" }];
    render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `View recorded FOC lines ${label}` }));
    fireEvent.click(screen.getByRole("button", { name: `Edit FOC line two quantity for ${label}` }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview quantity" }));
    await confirm();
    expect(m.commit).toHaveBeenLastCalledWith(expect.objectContaining({ lineId: "two", value: 9 }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: `Delete FOC line one for ${label}` }));
    await confirm();
    expect(m.commit).toHaveBeenLastCalledWith(expect.objectContaining({ lineId: "one", remove: true }));
    expect(m.paid).not.toHaveBeenCalled();
  });
  it("holds duplicates for review and confirms an evidence-bound separate-arrival decision", async () => {
    m.received = true;
    m.entries = [{ skuId: 1, periodId: 9, lineId: "one", quantity: 12, receiptMonth: "Sep 26", received: true,
      needsReview: true, reviewKey: "current evidence", matches: [{ source: "Clearance arrival", quantity: 12, date: "2026-09-20" }] }];
    render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `View recorded FOC lines ${label}` }));
    expect(screen.getByText(/Possible duplicate receipt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm separate shipment" }));
    await confirm();
    expect(m.commit).toHaveBeenCalledWith(expect.objectContaining({ lineId: "one", decision: "separate", reviewKey: "current evidence" }));
  });
  it("resets unsaved quantity drafts and confirmations when country or display units change", () => {
    const view = render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: `Edit FOC ${label}` }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });
    m.unit = "KG"; view.rerender(<FocRecordPage />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Edit FOC ${label}` }));
    m.country = "Syria"; view.rerender(<FocRecordPage />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(m.commit).not.toHaveBeenCalled();
  });
  it.each(["Lebanon", "KSA"])("denies FOC access and disables its query in %s", country => {
    m.country = country; render(<FocRecordPage />);
    expect(screen.getByRole("heading", { name: "FOC Record access denied" })).toBeInTheDocument();
    expect(m.query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
  it("records repeated pasted past-month lines in MC only after confirmation", async () => {
    m.unit = "KG"; render(<FocRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Record FOC" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Paste sheet rows/ }), { target: { value:
      "Date\tAcc Type\tSales Manager\tFlavor\tWeight\tPackaging\tQuantity in MC\nSep-26\tExport\tManager A\tMint\t50gr\tNew Packaging\t15\nSep-26\tDomestic\tManager B\tMint\t50gr\tNew Packaging\t20" } });
    fireEvent.click(screen.getByRole("button", { name: "Use pasted rows" }));
    expect(screen.getAllByLabelText("Quantity (MC)").map(el => (el as HTMLInputElement).value)).toEqual(["15", "20"]);
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await confirm();
    expect(m.entriesCommit).toHaveBeenCalledWith(expect.objectContaining({ country: "Libya", lines: [
      expect.objectContaining({ quantityMC: "15", accType: "Export" }), expect.objectContaining({ quantityMC: "20", salesManager: "Manager B" }),
    ] }));
  });
  it("keeps unmatched pasted lines visible and blocks the entire save", async () => {
    render(<FocRecordPage />); fireEvent.click(screen.getByRole("button", { name: "Record FOC" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Paste sheet rows/ }), { target: { value:
      "Date\tAcc Type\tSales Manager\tFlavor\tWeight\tPackaging\tQuantity in MC\nSep-26\tExport\tManager\tUnknown Flavor\t50gr\tNew Packaging\t20" } });
    fireEvent.click(screen.getByRole("button", { name: "Use pasted rows" }));
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(await screen.findByText("No matching SKU in this country.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
    expect(m.entriesCommit).not.toHaveBeenCalled();
  });
  it("cancels preview without writing", async () => {
    render(<FocRecordPage />); fireEvent.click(screen.getByRole("checkbox", { name: `Received FOC ${label}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(m.commit).not.toHaveBeenCalled();
  });
});
