import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ data: null as any, save: vi.fn(), invalidate: vi.fn() }));
const utilsLeaf = new Proxy({}, { get: () => ({ invalidate: state.invalidate }) });
const utils = new Proxy({}, { get: () => utilsLeaf });
const procedures = new Proxy({}, { get: (_target, name) => ({
  useQuery: () => ({ data: name === "planningFg" ? state.data : undefined, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useMutation: () => ({ mutate: state.save, mutateAsync: state.save, isPending: false }),
}) });
vi.mock("@/lib/trpc", () => ({ trpc: new Proxy({ useUtils: () => utils }, {
  get: (target, key) => key === "useUtils" ? target.useUtils : procedures,
}) }));
vi.mock("@/contexts/CountryContext", () => ({ useCountry: () => ({ country: "Syria" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAppAuth: () => ({ user: { id: 1, role: "admin", name: "Test" } }) }));
vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({ unit: "MC", unitLabel: "MC", formatVal: (v: number) => String(v), convertVal: (v: number) => v }) }));
vi.mock("@/components/ExportSheetButton", () => ({ default: () => null }));
vi.mock("@/components/IncludeFocExportButton", () => ({ default: () => null }));
vi.mock("@/components/ImportSheetButton", () => ({ default: () => null }));
import IntlPlanningFgPage from "./IntlPlanningFgPage";

beforeEach(() => {
  cleanup(); state.save.mockClear(); state.invalidate.mockClear();
  state.data = {
    skus: [{ id: 1, country: "Syria", name: "Mint", weight: "50g", category: "Core", packagingType: "New", isActive: true, isExcludedFromTotal: false, sortOrder: 1 }],
    periods: [{ id: 12, country: "Syria", year: 2026, month: 12, label: "Dec 2026", sortOrder: 12 }],
    forecast: [{ skuId: 1, periodId: 12, value: "1000" }], actualProduction: [],
    shipment: [{ skuId: 1, periodId: 12, week1: "800" }], arrival: [],
    planningFg: [{ skuId: 1, periodId: 12, openingStock: "100" }], ims: [], clearanceEvents: [],
    foc: [{ country: "Syria", skuId: 1, periodId: 12, value: "50", received: false }],
  };
});
describe("linked Syria FG pages", () => {
  it.each(["50g", "250g", "1kg"])("renders Production + FOC and keeps pending quantities out of stock in %s", weight => {
    state.data.skus[0].weight = weight;
    render(<IntlPlanningFgPage weight={weight} />);
    const production = screen.getAllByText("Production + FOC")[0].closest("tr")!;
    expect(within(production).getAllByText("850")).toHaveLength(2);
    const arrivals = screen.getAllByText("Actual arrivals / Planned Orders")[0].closest("tr")!;
    expect(within(arrivals).queryByText("850")).not.toBeInTheDocument();
    const closing = screen.getAllByText("Closing Stock")[0].closest("tr")!;
    expect(within(closing).getAllByText("100")).toHaveLength(2);
  });
  it("edits paid production only, never writing combined FOC back into production", () => {
    render(<IntlPlanningFgPage weight="50g" />);
    const row = screen.getAllByText("Production + FOC")[0].closest("tr")!;
    fireEvent.click(within(row).getAllByText("850")[0]);
    const input = screen.getByDisplayValue("800");
    fireEvent.change(input, { target: { value: "700" } });
    fireEvent.blur(input);
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ country: "Syria", week1: "700", week2: "0", week3: "0", week4: "0" }));
  });
});
