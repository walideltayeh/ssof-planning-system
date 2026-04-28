import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mutationStub = () => ({
  mutate: vi.fn(),
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
    get: () => ({
      useQuery: () => ({ data: undefined, isLoading: true, isPending: true }),
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

describe("PlanningFgPage smoke render", () => {
  beforeEach(() => {
    cleanup();
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
});
