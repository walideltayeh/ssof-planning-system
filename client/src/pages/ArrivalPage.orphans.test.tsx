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
  skus: [SKU],
  periods: [P_MAR, P_APR],
  arrival: [],
  shipment: [
    // Mar: production zeroed out, stale cleared status left behind
    { skuId: SKU.id, periodId: P_MAR.id, week1: "0", week2: "0", week3: "0", week4: "0", arrivalStatus: "Cleared", clearedQty: "3600", arrivalOffsetValue: 0, arrivalOffsetUnit: "days" },
    // Apr: real production
    { skuId: SKU.id, periodId: P_APR.id, week1: "3600", week2: "0", week3: "0", week4: "0", arrivalStatus: "Cleared", clearedQty: "3600", arrivalOffsetValue: 0, arrivalOffsetUnit: "days" },
  ],
  actualProduction: [],
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

const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);

const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  reset: vi.fn(),
});

const utilsLeaf = new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn(), cancel: vi.fn() }) });
const utils = new Proxy({}, { get: () => utilsLeaf });

const idleQuery = () => ({ data: undefined, isLoading: false, isFetching: false, refetch: vi.fn() });

const countryProcs: Record<string, any> = {
  data: { useQuery: () => ({ data: intlData, isLoading: false, isFetching: false, refetch: vi.fn() }) },
  clearanceEvents: { useQuery: () => ({ data: clearanceEvents }) },
  deleteClearanceEvent: { useMutation: () => ({ ...mutationStub(), mutateAsync: deleteMutateAsync }) },
};
const genericProc = { useQuery: idleQuery, useMutation: () => mutationStub() };
const countryRouter = new Proxy({}, { get: (_t, key) => countryProcs[key as string] ?? genericProc });
const otherRouter = new Proxy({}, { get: () => genericProc });

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    { useUtils: () => utils },
    {
      get: (target, key) => {
        if (key === "useUtils") return (target as any).useUtils;
        if (key === "country") return countryRouter;
        return otherRouter;
      },
    },
  ),
}));

vi.mock("@/contexts/CountryContext", () => ({
  useCountry: () => ({ country: "Syria", setCountry: vi.fn(), clearCountry: vi.fn(), config: { label: "Syria", terms: { arrival: "Arrival" } } }),
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

describe("ArrivalPage — orphaned clearance events (no production)", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    deleteMutateAsync.mockReset().mockResolvedValue(undefined);
    toastSuccess.mockClear();
    toastError.mockClear();
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
