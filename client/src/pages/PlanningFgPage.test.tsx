import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ data: null as any, save: vi.fn() }));

const mutationStub = () => ({
  mutate: state.save,
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  reset: vi.fn(),
});

const utilsLeaf = new Proxy(
  {},
  {
    get: () => ({
      invalidate: vi.fn(),
      refetch: vi.fn(),
      cancel: vi.fn(),
    }),
  },
);

const utils = new Proxy(
  {},
  {
    get: () => utilsLeaf,
  },
);

const procLeaf = new Proxy(
  {},
  {
    get: (_target, name) => ({
      useQuery: () => ({ data: name === "planningFg" ? state.data : undefined, isLoading: !state.data, isPending: !state.data }),
      useMutation: (_opts?: unknown) => mutationStub(),
    }),
  },
);

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    { useUtils: () => utils },
    {
      get: (target, key) => {
        if (key === "useUtils") return (target as any).useUtils;
        return procLeaf;
      },
    },
  ),
}));

vi.mock("@/contexts/CountryContext", () => ({
  useCountry: () => ({
    country: "Lebanon",
    setCountry: vi.fn(),
    clearCountry: vi.fn(),
    config: { label: "Lebanon" },
  }),
}));

vi.mock("@/contexts/UnitContext", () => ({
  useUnit: () => ({
    unit: "MC",
    setUnit: vi.fn(),
    convertVal: (v: number) => v,
    formatVal: (v: number) => String(v),
    unitLabel: "MC",
  }),
}));

import PlanningFgPage from "./PlanningFgPage";
vi.mock("@/components/ExportSheetButton", () => ({ default: () => null }));
vi.mock("@/components/ImportSheetButton", () => ({ default: () => null }));
vi.mock("@/components/SmartRecommendations", () => ({ default: () => null }));
vi.mock("@/components/BestStrategy", () => ({ default: () => null }));

describe("PlanningFgPage smoke render", () => {
  beforeEach(() => {
    cleanup();
    state.data = null; state.save.mockClear();
  });

  it("renders the loading skeleton (with the per-weight title) without crashing", () => {
    render(<PlanningFgPage weight="50g" />);

    // The loading branch returns <TableSkeleton title={`Planning FG ${weight}`} ... />
    // so the weight-specific title should appear in the DOM.
    expect(screen.getByText(/Planning FG 50g/i)).toBeInTheDocument();
  });

  it("changes the skeleton title when a different weight is passed in", () => {
    render(<PlanningFgPage weight="1kg" />);
    expect(screen.getByText(/Planning FG 1kg/i)).toBeInTheDocument();
  });
  it.each(["50g", "250g", "1kg"])("saves a negative adjustment with Enter and subtracts it from %s closing stock", weight => {
    state.data = {
      skus: [{ id: 1, name: "Mint", weight, category: "Core", packagingType: "New", isActive: true, sortOrder: 1 }],
      periods: [{ id: 12, year: 2026, month: 12, label: "Dec 2026", sortOrder: 12 }],
      planningFg: [{ skuId: 1, periodId: 12, openingStock: "100" }],
      forecast: [], ims: [], shipment: [], arrival: [], clearanceEvents: [],
    };
    const view = render(<PlanningFgPage weight={weight} />);
    const row = screen.getAllByText("Adjustments")[0].closest("tr")!;
    fireEvent.click(within(row).getAllByText("-")[0]);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "-25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ country: "Lebanon", adjustments: "-25" }));
    state.data = { ...state.data, planningFg: [{ ...state.data.planningFg[0], adjustments: "-25" }] };
    view.rerender(<PlanningFgPage weight={weight} />);
    const closingRow = screen.getAllByText("Closing Stock").find(el => el.closest("tr"))!.closest("tr")!;
    expect(within(closingRow).getAllByText("75").length).toBeGreaterThan(0);
  });
});
