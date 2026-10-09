import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

// ── Fixture: Syria, one SKU, two months ──────────────────────────────────────
// Mar-2026 has NO production but owns a clearance event (orphaned); Apr-2026
// has production and its own clearance event. This mirrors the Sept-2026
// double-count incident: production was moved from Mar to Apr after the
// clearances were logged against Mar, and the arrivals were then re-entered
// under Apr.
const SKU = { id: 210001, name: "Double Apple", weight: "50g", category: "Core", packagingType: "New", country: "Syria" };
const P_MAR = { id: 60015, year: 2026, month: 3, label: "Mar-26", sortOrder: 15, country: "Syria" };
const P_APR = { id: 60016, year: 2026, month: 4, label: "Apr-26", sortOrder: 16, country: "Syria" };

const intlData = {
  foc: [] as { skuId: number; periodId: number; country: string; value: string; received: boolean }[],
  skus: [SKU],
  periods: [P_MAR, P_APR],
  arrival: [],
  shipment: [
    // Mar: production zeroed out, stale cleared status left behind
    { skuId: SKU.id, periodId: P_MAR.id, week1: "0", week2: "0", week3: "0", week4: "0", arrivalStatus: "Cleared", clearedQty: "3600", arrivalOffsetValue: 0, arrivalOffsetUnit: "days" },
    // Apr: real production
    { skuId: SKU.id, periodId: P_APR.id, week1: "3600", week2: "0", week3: "0", week4: "0", arrivalStatus: "Cleared", clearedQty: "3600", arrivalOffsetValue: 0, arrivalOffsetUnit: "days" },
  ],
  actualProduction: [] as { skuId: number; periodId: number; value: string }[],
  // April plan is 5,000 but only 3,600 has cleared → 1,400 still to clear.
  forecast: [{ skuId: SKU.id, periodId: P_APR.id, value: "5000" }],
};

const clearanceEvents = [
  // Two orphaned events on March (no production): 3,600 + 1,500 = 5,100
  { id: 15, skuId: SKU.id, periodId: P_MAR.id, country: "Syria", clearedQty: "3600.00", clearedDate: "2026-05-03", pendingClearDate: null, notes: null, invoiceRef: null, containerRef: null },
  { id: 16, skuId: SKU.id, periodId: P_MAR.id, country: "Syria", clearedQty: "1500.00", clearedDate: "2026-05-10", pendingClearDate: null, notes: null, invoiceRef: null, containerRef: null },
  // Legit event on April
  { id: 51, skuId: SKU.id, periodId: P_APR.id, country: "Syria", clearedQty: "3600.00", clearedDate: "2026-05-04", pendingClearDate: null, notes: null, invoiceRef: null, containerRef: null },
];

let selectedCountry = "Syria";
let selectedData = intlData;
let selectedEvents = clearanceEvents;
const queryCountry = vi.fn();

const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);

const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  reset: vi.fn(),
});

const invalidateArrival = vi.fn();
let productionSaved: (() => void) | undefined;
const utilsLeaf = new Proxy({}, { get: (_t, key) => ({ invalidate: key === "arrival" ? invalidateArrival : vi.fn(), refetch: vi.fn(), cancel: vi.fn() }) });
const utils = new Proxy({}, { get: () => utilsLeaf });

const idleQuery = () => ({ data: undefined, isLoading: false, isFetching: false, refetch: vi.fn() });

const countryProcs: Record<string, any> = {
  data: { useQuery: (input: unknown) => { queryCountry(input); return { data: selectedData, isLoading: false, isFetching: false, refetch: vi.fn() }; } },
  clearanceEvents: { useQuery: () => ({ data: selectedEvents }) },
  deleteClearanceEvent: { useMutation: () => ({ ...mutationStub(), mutateAsync: deleteMutateAsync }) },
};
const genericProc = { useQuery: idleQuery, useMutation: () => mutationStub() };
const countryRouter = new Proxy({}, { get: (_t, key) => countryProcs[key as string] ?? genericProc });
const otherRouter = new Proxy({}, { get: (_t, key) => key === "shipmentCell" ? {
  useMutation: (options: { onSuccess: () => void }) => { productionSaved = options.onSuccess; return mutationStub(); },
} : genericProc });

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    { useUtils: () => utils },
    {
      get: (target, key) => {
        if (key === "useUtils") return (target as any).useUtils;
        if (key === "country") return countryRouter;
        if (key === "focPlanning") return { list: { useQuery: () => ({
          data: { cells: selectedData.foc, receipts: { entries: [] }, skus: [], periods: [] },
          isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
        }) } };
        return otherRouter;
      },
    },
  ),
}));

vi.mock("@/contexts/CountryContext", () => ({
  useCountry: () => ({ country: selectedCountry, setCountry: vi.fn(), clearCountry: vi.fn(), config: { label: selectedCountry, terms: { arrival: "Arrival" } } }),
}));

vi.mock("@/contexts/UnitContext", () => ({
  useUnit: () => ({ unit: "MC", setUnit: vi.fn(), convertVal: (v: number) => v, formatVal: (v: number) => String(v), unitLabel: "MC" }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAppAuth: () => ({ user: { id: 1, username: "planner", role: "admin" } }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("@/components/ImportSheetButton", () => ({ default: () => null }));
vi.mock("@/components/ExportSheetButton", () => ({ default: () => null }));

import ArrivalPage from "./ArrivalPage";
import ShipmentPage from "./ShipmentPage";

describe("ArrivalPage — orphaned clearance events (no production)", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    deleteMutateAsync.mockReset().mockResolvedValue(undefined);
    toastSuccess.mockClear();
    toastError.mockClear();
    selectedCountry = "Syria";
    selectedData = intlData;
    selectedEvents = clearanceEvents;
  });

  it("shows Libya's reported transit status without claiming actual production or warehouse clearance", () => {
    selectedCountry = "Libya";
    selectedEvents = [];
    selectedData = {
      ...intlData,
      skus: [{ ...SKU, country: "Libya" }],
      shipment: [{ ...intlData.shipment[1], week1: "0", clearedQty: "0", arrivalStatus: "In Transit" }],
      periods: [{ ...P_APR, country: "Libya" }],
    };
    render(<ArrivalPage />);
    expect(screen.getByText("Reported in transit")).toBeInTheDocument();
    expect(screen.queryByText("Actual confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("Awaiting Actual")).not.toBeInTheDocument();
    expect(screen.queryByTestId("orphan-clearance-banner")).not.toBeInTheDocument();
  });

  it("adds Syria FOC to expected and actual batch quantities without receiving it or changing clearance events", () => {
    selectedEvents = [clearanceEvents[2]];
    selectedData = {
      ...intlData,
      foc: [{ skuId: SKU.id, periodId: P_APR.id, country: "Syria", value: "400", received: false }],
    };
    render(<ArrivalPage />);
    const breakdown = screen.getByTestId("arrival-production-foc");
    expect(breakdown).toHaveTextContent("Production: 3600 + FOC: 400 = Total arriving: 4000 MC");
    expect(screen.getByText("Expected Arrivals").closest("div")!.parentElement).toHaveTextContent("5400");
    expect(breakdown.closest("[data-slot=card]") ?? breakdown.closest(".overflow-hidden")).toHaveTextContent("Partially Cleared");
    expect(selectedData.foc[0].received).toBe(false);
    expect(selectedEvents[0].clearedQty).toBe("3600.00");
  });

  it("shows a Syria FOC-only batch with its full pending quantity instead of hiding it", () => {
    selectedEvents = [];
    selectedData = {
      ...intlData, forecast: [], shipment: [],
      foc: [{ skuId: SKU.id, periodId: P_APR.id, country: "Syria", value: "600", received: false }],
    };
    render(<ArrivalPage />);
    expect(screen.getByTestId("arrival-production-foc")).toHaveTextContent("Total arriving: 600 MC");
    expect(screen.queryByTestId("orphan-clearance-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("Actual confirmed")).not.toBeInTheDocument();
  });

  it("does not change Libya Arrival quantities when that country has separate FOC", () => {
    selectedCountry = "Libya";
    selectedEvents = [clearanceEvents[2]];
    selectedData = {
      ...intlData,
      foc: [{ skuId: SKU.id, periodId: P_APR.id, country: "Libya", value: "400", received: false }],
    };
    render(<ArrivalPage />);
    expect(screen.queryByTestId("arrival-production-foc")).not.toBeInTheDocument();
    expect(screen.getByText("Expected Arrivals").closest("div")!.parentElement).toHaveTextContent("5000");
  });

  it("surfaces the Mar-26 batch even though it has no production, with a warning banner", () => {
    render(<ArrivalPage />);

    const banner = screen.getByTestId("orphan-clearance-banner");
    expect(banner).toHaveTextContent(/2 clearance events \(5100 MC\) attached to 1 batch with no production/);
    expect(banner).toHaveTextContent(/Mar-26/);

    // Exactly one orphaned card, and it is the March one
    const orphanCards = screen.getAllByTestId("orphan-batch");
    expect(orphanCards).toHaveLength(1);
    expect(orphanCards[0]).toHaveTextContent(/Mar-26/);
    expect(orphanCards[0]).toHaveTextContent(/No production — events still count in FG/);

    // The healthy April batch is still listed normally
    expect(screen.getByText("Apr-26", { selector: "strong" })).toBeInTheDocument();
  });

  it("keeps orphan clearances out of the dashboard plan/actual reconciliation", () => {
    render(<ArrivalPage />);

    // Expected Arrivals = April plan only (5,000); the orphaned March batch has no plan
    // and must not be counted as an expected/confirmed batch.
    const expected = screen.getByText("Expected Arrivals").closest("div")!.parentElement!;
    expect(expected).toHaveTextContent("5000");
    expect(within(expected).getByText("1")).toBeInTheDocument(); // 1 production batch, not 2

    // Still to Clear = 5,000 planned − 3,600 cleared on April = 1,400.
    // If the 5,100 MC of orphaned clearances leaked in, this would read 0.
    const still = screen.getByText("Still to Clear").closest("div")!.parentElement!;
    expect(still).toHaveTextContent("1400");
  });

  it("\"Show only these\" narrows the list to orphaned batches and can be cleared", () => {
    render(<ArrivalPage />);

    fireEvent.click(screen.getByRole("button", { name: /show only these/i }));
    expect(screen.getAllByTestId("orphan-batch")).toHaveLength(1);
    expect(screen.queryByText("Apr-26", { selector: "strong" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show all batches/i }));
    expect(screen.getByText("Apr-26", { selector: "strong" })).toBeInTheDocument();
  });

  it("offers a bulk delete for the orphaned batch that removes every attached event", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ArrivalPage />);

    // Expand the orphaned card
    const card = screen.getAllByTestId("orphan-batch")[0];
    fireEvent.click(within(card).getByText("Double Apple"));

    const bulk = within(card).getByRole("button", { name: /delete all 2 events/i });
    fireEvent.click(bulk);

    // Both March events are deleted, each scoped to the March batch — and
    // never the legitimate April event (#51).
    await vi.waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledTimes(2));
    expect(deleteMutateAsync).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ eventId: 15, skuId: SKU.id, periodId: P_MAR.id, country: "Syria" }));
    expect(deleteMutateAsync).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ eventId: 16, skuId: SKU.id, periodId: P_MAR.id, country: "Syria" }));
    expect(deleteMutateAsync).not.toHaveBeenCalledWith(expect.objectContaining({ eventId: 51 }));
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("keeps going after one delete fails and reports the partial failure", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteMutateAsync
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    render(<ArrivalPage />);

    const card = screen.getAllByTestId("orphan-batch")[0];
    fireEvent.click(within(card).getByText("Double Apple"));
    fireEvent.click(within(card).getByRole("button", { name: /delete all 2 events/i }));

    // The second event is still attempted after the first one fails
    await vi.waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toMatch(/1 of 2 event\(s\) could not be deleted/);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does nothing when the confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ArrivalPage />);

    const card = screen.getAllByTestId("orphan-batch")[0];
    fireEvent.click(within(card).getByText("Double Apple"));
    fireEvent.click(within(card).getByRole("button", { name: /delete all 2 events/i }));

    expect(deleteMutateAsync).not.toHaveBeenCalled();
  });
});

describe("ArrivalPage — reads Production entries", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    queryCountry.mockClear();
    selectedCountry = "Libya";
    selectedData = {
      ...intlData,
      shipment: [{ ...intlData.shipment[1], week1: "100", week2: "200", week3: "300", week4: "400" }],
      actualProduction: [],
    };
    selectedEvents = [{ ...clearanceEvents[2], country: "Libya", clearedQty: "300.00" }];
  });

  const actualLabel = () => {
    const batchHeader = screen.getByText("Apr-26", { selector: "strong" }).closest(".cursor-pointer") as HTMLElement;
    return within(batchHeader).getByText(/^Actual:/, { selector: "span" });
  };

  it("refreshes Lebanon's Arrival query after a successful Production save", () => {
    selectedCountry = "Lebanon";
    invalidateArrival.mockClear();
    productionSaved = undefined;
    render(<ShipmentPage />);
    expect(typeof productionSaved).toBe("function");
    productionSaved!();
    expect(invalidateArrival).toHaveBeenCalledTimes(1);
  });

  it.each(["Libya", "Syria", "KSA"])("reads all four Production weeks as actual in %s without a separate actual entry", (country) => {
    selectedCountry = country;
    render(<ArrivalPage />);
    expect(queryCountry).toHaveBeenCalledWith({ country });
    expect(actualLabel()).toHaveTextContent("1000");
    expect(screen.queryByText("Awaiting Actual", { exact: true })).not.toBeInTheDocument();
    const confirmed = screen.getByText("Actual Confirmed vs Planned").closest("div")!.parentElement!;
    expect(confirmed).toHaveTextContent("1000");
    // Preserve the existing planned-minus-cleared dashboard rule.
    const still = screen.getByText("Still to Clear").closest("div")!.parentElement!;
    expect(still).toHaveTextContent("4700");
  });

  it("refreshes the Actual figure when Production data is refreshed", () => {
    const view = render(<ArrivalPage />);
    expect(actualLabel()).toHaveTextContent("1000");
    selectedData = { ...selectedData, shipment: [{ ...selectedData.shipment[0], week4: "900" }] };
    view.rerender(<ArrivalPage />);
    expect(actualLabel()).toHaveTextContent("1500");
  });

  it("uses a positive manual actual override and falls back to Production when removed or zero", () => {
    selectedData = { ...selectedData, actualProduction: [{ skuId: SKU.id, periodId: P_APR.id, value: "1200" }] };
    const view = render(<ArrivalPage />);
    expect(actualLabel()).toHaveTextContent("1200");
    selectedData = { ...selectedData, actualProduction: [{ skuId: SKU.id, periodId: P_APR.id, value: "0" }] };
    view.rerender(<ArrivalPage />);
    expect(actualLabel()).toHaveTextContent("1000");
    selectedData = { ...selectedData, actualProduction: [] };
    view.rerender(<ArrivalPage />);
    expect(actualLabel()).toHaveTextContent("1000");
  });

  it("shows forecast-only batches as Awaiting Actual, without pretending production was entered", () => {
    selectedData = { ...selectedData, shipment: [] };
    selectedEvents = [];
    render(<ArrivalPage />);
    expect(actualLabel()).toHaveTextContent("—");
    expect(screen.getAllByText("Awaiting Actual", { exact: true }).length).toBeGreaterThan(0);
  });
});
