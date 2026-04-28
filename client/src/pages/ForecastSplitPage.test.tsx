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
      useQuery: () => ({ data: undefined, isLoading: false, isPending: false }),
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "tester", displayName: "Tester", role: "admin", countries: ["Lebanon"], isOwner: true },
    country: "Lebanon",
    isOwner: true,
    isAdmin: true,
    isAuthenticated: true,
    canAccessCountry: () => true,
    login: vi.fn(),
    logout: vi.fn(),
    setCountry: vi.fn(),
    clearCountry: vi.fn(),
  }),
  useAppAuth: () => ({
    user: { id: 1, username: "tester", displayName: "Tester", role: "admin", countries: ["Lebanon"], isOwner: true },
    country: "Lebanon",
    isOwner: true,
    isAdmin: true,
    isAuthenticated: true,
    canAccessCountry: () => true,
    login: vi.fn(),
    logout: vi.fn(),
    setCountry: vi.fn(),
    clearCountry: vi.fn(),
  }),
}));

import ForecastSplitPage from "./ForecastSplitPage";

describe("ForecastSplitPage smoke render", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the page header without crashing", () => {
    render(<ForecastSplitPage />);

    expect(
      screen.getByRole("heading", { name: /Recommended Forecast SKU Split/i }),
    ).toBeInTheDocument();
  });

  it("renders the explanatory blurb describing the recommendation engine", () => {
    render(<ForecastSplitPage />);

    expect(
      screen.getByText(/Senior data analyst engine/i),
    ).toBeInTheDocument();
  });
});
