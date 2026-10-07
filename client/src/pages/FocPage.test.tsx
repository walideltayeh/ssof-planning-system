import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FocPage, { displayValue, toMastercases } from "./FocPage";

const mocks = vi.hoisted(() => ({
  country: "Libya" as string,
  admin: true,
  unit: "MC" as "MC" | "KG" | "Tons",
  mutate: vi.fn(),
  receiptMutate: vi.fn(),
  commitMutate: vi.fn(),
  reviewMutate: vi.fn(),
  queryInput: vi.fn(),
  queryOptions: vi.fn(),
  invalidateList: vi.fn(),
  invalidatePerformance: vi.fn(),
  invalidatePlanningFg: vi.fn(),
  invalidateLegacyStock: vi.fn(),
  previewBeforeDate: null as string | null,
  fixture: {
    skus: [{ id: 21, name: "Double Apple", weight: "50g", packagingType: "New", isActive: true }],
    periods: [{ id: 30, label: "Sep 2026" }, { id: 31, label: "Oct 2026" }],
    cells: [
      { skuId: 21, periodId: 30, value: null },
      { skuId: 21, periodId: 31, value: "0.00" },
    ],
  },
}));

vi.mock("@/contexts/CountryContext", () => ({ useCountry: () => ({ country: mocks.country }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAppAuth: () => ({ isAdminFor: () => mocks.admin }) }));
vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({ unit: mocks.unit }) }));
vi.mock("@/lib/trpc", () => {
  const query = {
    useQuery: (input: unknown, options: unknown) => {
      mocks.queryInput(input);
      mocks.queryOptions(options);
      return { data: mocks.fixture, isLoading: false, isFetching: false, refetch: vi.fn(), error: null };
    },
    useMutation: (options: { onSuccess?: () => void; onError?: (error: unknown) => void }) => ({
      mutate: (input: unknown) => { mocks.mutate(input); },
      isPending: false,
      options,
    }),
  };
  const receiptMutation = {
    useMutation: (options: { onSuccess?: (result: unknown, variables: any) => unknown; onError?: (error: unknown) => void }) => ({
      mutate: (input: any) => {
        mocks.receiptMutate(input);
        options.onSuccess?.({ success: true }, input);
      },
      isPending: false,
    }),
  };
  const previewMutation = {
    useMutation: (options: { onSuccess?: (result: unknown, variables: any) => unknown; onError?: (error: unknown) => void }) => ({
      mutate: (input: any) => {
        options.onSuccess?.({
          token: "a".repeat(64),
          skippedNotSet: 1,
          warnings: [],
          changes: [{
            skuId: 21, periodId: 30, sku: "Double Apple", planMonth: "Sep 2026", quantity: 2,
            receiptMonth: "Oct 2026", before: { received: false, receivedDate: mocks.previewBeforeDate },
            after: { received: true, receivedDate: mocks.previewBeforeDate }, matches: [],
          }],
        }, input);
      },
      isPending: false,
    }),
  };
  const commitMutation = {
    useMutation: (options: { onSuccess?: (result: unknown, variables: any) => unknown }) => ({
      mutate: (input: any) => { mocks.commitMutate(input); options.onSuccess?.({ success: true }, input); },
      isPending: false,
    }),
  };
  const reviewMutation = {
    useMutation: () => ({ mutate: (input: unknown) => mocks.reviewMutate(input), isPending: false }),
  };
  const utils = {
    focPlanning: { list: { invalidate: mocks.invalidateList } },
    country: { performance: { invalidate: mocks.invalidatePerformance }, planningFg: { invalidate: mocks.invalidatePlanningFg },
      intlAnalysis: { invalidate: mocks.invalidateLegacyStock }, stockLevels: { invalidate: mocks.invalidateLegacyStock },
      currentMonthClosingStock: { invalidate: mocks.invalidateLegacyStock } },
  };
  return {
    trpc: {
      useUtils: () => utils,
      focPlanning: {
        list: query, update: query, receiptUpdate: receiptMutation,
        receiptPreview: previewMutation, receiptCommit: commitMutation, receiptReview: reviewMutation,
      },
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  mocks.country = "Libya";
  mocks.admin = true;
  mocks.unit = "MC";
  mocks.mutate.mockClear();
  mocks.receiptMutate.mockClear();
  mocks.commitMutate.mockClear();
  mocks.reviewMutate.mockClear();
  mocks.queryInput.mockClear();
  mocks.queryOptions.mockClear();
  mocks.invalidateList.mockClear();
  mocks.invalidatePerformance.mockClear();
  mocks.invalidatePlanningFg.mockClear();
  (mocks.fixture.cells[1] as any).received = false;
  (mocks.fixture.cells[1] as any).receiptReviewKey = null;
  (mocks.fixture as any).receipts = { entries: [] };
});
afterEach(cleanup);

describe("FOC planning grid", () => {
  it("keeps missing cells distinct from explicit zero", () => {
    render(<FocPage />);
    expect(mocks.queryInput).toHaveBeenLastCalledWith({ country: "Libya", includeFoc: true });
    expect(screen.getByRole("button", { name: /Double Apple Sep 2026: Not set, edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Double Apple Oct 2026: 0, edit/i })).toBeInTheDocument();
  });

  it("requests the list with the shared Include FOC basis so the query key tracks the switch", () => {
    render(<FocPage />);
    expect(mocks.queryInput).toHaveBeenLastCalledWith({ country: "Libya", includeFoc: true });
    fireEvent.click(screen.getByRole("switch", { name: "Include FOC in stock" }));
    expect(mocks.queryInput).toHaveBeenLastCalledWith({ country: "Libya", includeFoc: false });
  });

  it("renders a read-only grid for viewers", () => {
    mocks.admin = false;
    render(<FocPage />);
    expect(screen.getByText("Read-only view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Double Apple Sep 2026: Not set/i })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /received status/i })).toHaveLength(2);
    expect(screen.getAllByRole("combobox", { name: /received status/i })[0]).toBeDisabled();
  });

  it("lets country admins edit receipt status and optional ISO date", () => {
    render(<FocPage />);
    expect((screen.getByRole("combobox", { name: /Double Apple Sep 2026 received status/i }) as HTMLSelectElement).value).toBe("no");
    fireEvent.change(screen.getByRole("combobox", { name: /Double Apple Oct 2026 received status/i }), { target: { value: "yes" } });
    expect(mocks.receiptMutate).toHaveBeenCalledWith({ country: "Libya", skuId: 21, periodId: 31, received: true });
    fireEvent.change(screen.getByLabelText("Double Apple Oct 2026 received date"), { target: { value: "2026-11-03" } });
    expect(mocks.receiptMutate).toHaveBeenLastCalledWith({ country: "Libya", skuId: 21, periodId: 31, receivedDate: "2026-11-03" });
  });

  it("uses server preview and requires an explicit bulk confirmation", () => {
    mocks.previewBeforeDate = null;
    render(<FocPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Mark month received" })[0]);
    expect(screen.getByText("Review receipt changes")).toBeInTheDocument();
    expect(screen.getAllByText(/Sep 2026/).length).toBeGreaterThan(0);
    expect(screen.getByText("Sep 2026 → Sep 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm 1 entries/i }));
    expect(mocks.commitMutate).toHaveBeenCalledWith(expect.objectContaining({
      country: "Libya", periodId: 30, received: true, token: "a".repeat(64),
    }));
  });
  it("shows the actual previous receipt date and landing month in bulk confirmation", () => {
    mocks.previewBeforeDate = "2026-11-02";
    render(<FocPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Mark month received" })[0]);
    expect(screen.getByText("2026-11-02 → 2026-11-02")).toBeInTheDocument();
    expect(screen.getByText("2026-11 → 2026-11")).toBeInTheDocument();
    mocks.previewBeforeDate = null;
  });

  it("labels SKU-wide confirmations as all-month actions and closes them when the unit changes", () => {
    const view = render(<FocPage />);
    fireEvent.click(screen.getByRole("button", { name: "Mark all months received" }));
    expect(screen.getByText(/covers every entered plan month, including collapsed or otherwise hidden years/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm 1 entries for all months/i })).toBeInTheDocument();
    mocks.unit = "KG";
    view.rerender(<FocPage />);
    expect(screen.queryByText("Review receipt changes")).not.toBeInTheDocument();
  });

  it("surfaces possible duplicates and only enables Already counted with clearance evidence", () => {
    (mocks.fixture.cells[1] as any).received = true;
    (mocks.fixture.cells[1] as any).receiptReviewKey = "stale-persisted-key";
    (mocks.fixture as any).receipts = { entries: [{
      skuId: 21, periodId: 31, needsReview: true, reviewKey: "current-no-match-key", matches: [],
    }] };
    render(<FocPage />);
    expect(screen.getByText(/Possible duplicate — review required/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Already counted" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Separate shipment" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Separate shipment" }));
    expect(mocks.reviewMutate).toHaveBeenCalledWith(expect.objectContaining({ decision: "separate", reviewKey: "current-no-match-key" }));
  });

  it.each([
    ["KG", "12", 2],
    ["Tons", "0.012", 2],
  ] as const)("converts %s input to rounded MC before sending", (displayUnit, entered, expectedMc) => {
    mocks.unit = displayUnit;
    render(<FocPage />);
    fireEvent.click(screen.getByRole("button", { name: /Double Apple Sep 2026: Not set/i }));
    const input = screen.getByRole("textbox", { name: "Double Apple Sep 2026 FOC" });
    fireEvent.change(input, { target: { value: entered } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.mutate).toHaveBeenCalledWith({ country: "Libya", skuId: 21, periodId: 30, value: expectedMc });
  });

  it("does not enable a request or display another country's FOC grid", () => {
    mocks.country = "KSA";
    render(<FocPage />);
    expect(screen.getByText("FOC planning is available only for Libya and Syria.")).toBeInTheDocument();
    expect(mocks.queryOptions).toHaveBeenCalledWith({ enabled: false, retry: false });
  });

  it("converts and rounds values according to MC storage precision", () => {
    expect(toMastercases(10, "KG")).toBe(1.67);
    expect(toMastercases(0.02, "Tons")).toBe(3.33);
    expect(displayValue(1, "Tons")).toBe("0.006");
  });
});
