import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  user: null as null | { id: number; username: string; displayName: string; role: "admin" | "viewer"; countries: string[]; isOwner: boolean },
  country: "Libya" as "Lebanon" | "Syria" | "Libya" | "KSA",
  setCountry: vi.fn(),
  layout: null as null | { order: string[]; hidden: string[] },
  pack: null as any,
  performanceInputs: [] as any[],
  performanceQuery: vi.fn(),
  monthlyInputs: [] as any[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: H.user,
    isAdminFor: () => false,
    isAuthenticated: !!H.user,
    canAccessCountry: (name: string) => !!H.user && (H.user.isOwner || H.user.countries.includes(name)),
  }),
  useAppAuth: () => ({
    user: H.user,
    isAdminFor: () => false,
    isAdmin: false,
    isOwner: !!H.user?.isOwner,
    isAuthenticated: !!H.user,
    canAccessCountry: (name: string) => !!H.user && (H.user.isOwner || H.user.countries.includes(name)),
    logout: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCountryVisibility", () => ({ useCountryVisibility: () => ({
  data: ["Lebanon", "Syria", "Libya", "KSA"].map(country => ({ country, isHidden: false, canManage: false })),
  isLoading: false, isError: false,
}) }));

vi.mock("@/contexts/CountryContext", () => ({
  COUNTRY_CONFIG: {
    Lebanon: { flag: "LB" },
    Syria: { flag: "SY" },
    Libya: { flag: "LY" },
    KSA: { flag: "SA" },
  },
  useCountry: () => ({ country: H.country, setCountry: H.setCountry, clearCountry: vi.fn() }),
}));

vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({ unit: "MC", setUnit: vi.fn() }) }));
vi.mock("@/hooks/useIncludeFoc", () => ({ useIncludeFoc: () => ({ includeFoc: true, setIncludeFoc: vi.fn() }) }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false, isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/LastUpdatedPanel", () => ({ default: () => null }));
vi.mock("@/lib/countryAccessStore", () => ({ useDeniedCountry: () => null }));
vi.mock("@/hooks/useLastUpdates", () => ({
  useLastUpdates: () => ({ data: undefined }),
  formatUpdateTime: (value: string) => value,
  lastUpdateSentence: () => "",
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    country: {
      performance: {
        useQuery: (input: unknown) => {
          H.performanceInputs.push(input);
          return H.performanceQuery();
        },
      },
      monthlyAnalysis: { useQuery: (input: unknown) => { H.monthlyInputs.push(input); return { data: undefined, isLoading: false, error: null }; } },
      slideLayout: { useQuery: () => ({ data: H.layout }) },
      weights: { useQuery: () => ({ data: [] }) },
    },
    appUsers: {
      changePassword: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
    },
    audit: { logAction: { useMutation: () => ({ mutate: vi.fn() }) } },
    presence: {
      heartbeat: { useMutation: () => ({ mutate: vi.fn() }) },
      leave: { useMutation: () => ({ mutate: vi.fn() }) },
      online: { useQuery: () => ({ data: [] }) },
    },
    auth: { logout: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}));

vi.mock("@/components/performance/PerformanceContext", () => ({
  PerformanceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/performance/PerformanceHeader", () => ({
  default: (props: { onExportPdf: () => void; onPresentation: () => void }) => (
    <div>
      <button type="button" onClick={props.onExportPdf}>Export PDF</button>
      <button type="button" onClick={props.onPresentation}>Open presentation</button>
    </div>
  ),
}));

vi.mock("@/components/performance/PresentationMode", () => ({
  default: ({ sections }: { sections: { id: string }[] }) => (
    <output data-testid="presentation-order">{sections.map((section) => section.id).join(",")}</output>
  ),
}));

vi.mock("@/components/performance/SlideLayoutDialog", () => ({ default: () => null }));
vi.mock("@/components/performance/PresenterNote", () => ({ default: () => null }));
vi.mock("@/components/performance/BoardChangesSection", () => ({ default: () => <span>Board changes test content</span> }));
vi.mock("@/components/performance/index", () => {
  const Component = () => <span>Performance section test content</span>;
  return {
    AnomaliesSection: Component,
    BoardChangesSection: Component,
    CommercialSection: Component,
    DataConfidenceSection: Component,
    DemandSection: Component,
    ExecutiveSummarySection: Component,
    FlowSection: Component,
    ForecastQualitySection: Component,
    ForwardSection: Component,
    InventorySection: Component,
    MarketSection: Component,
    OutlookSection: Component,
    PortfolioSection: Component,
    RunningRateSection: Component,
    StockSituationSection: Component,
    SupplySection: Component,
    SyriaReconciliationSection: Component,
  };
});

import CountryPerformancePage from "./CountryPerformancePage";
import DashboardLayout from "@/components/DashboardLayout";

const defaultOrder = [
  "confidence", "runningRate", "commercial", "market", "portfolio", "outlook", "executive",
  "stockSituation", "changes", "flow", "demand", "supply", "inventory", "quality", "forward", "anomalies",
];

function screenSectionIds() {
  return [...document.querySelectorAll(".perf-screen-tree [data-perf-section]")].map((node) => node.getAttribute("data-perf-section"));
}

function makePack() {
  return {
    meta: {
      country: "Libya",
      isIntl: true,
      periodKey: "ytd",
      window: { label: "Year to date" },
      compareLabel: "vs plan",
      generatedAt: "2026-02-01T00:00:00.000Z",
      dataAsOf: null,
    },
    market: {},
    foc: { basisLabel: "FOC included", note: "Planning note for testing" },
  };
}

describe("CountryPerformancePage integration", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    H.user = { id: 1, username: "planner", displayName: "Planner", role: "viewer", countries: ["Lebanon", "Libya"], isOwner: false };
    H.country = "Libya";
    H.layout = { order: defaultOrder, hidden: ["portfolio"] };
    H.pack = makePack();
    H.performanceInputs = [];
    H.monthlyInputs = [];
    H.performanceQuery.mockReturnValue({ data: H.pack, isFetching: false, isLoading: false, error: null });
    H.setCountry.mockClear();
    window.document.body.classList.remove("perf-printing");
  });

  it("mounts only Summary by default, then unmounts each previous group when tabs change", () => {
    render(<CountryPerformancePage />);
    const panel = screen.getByRole("tabpanel");
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(screenSectionIds()).toEqual(["runningRate", "outlook", "executive", "changes"]);
    expect(within(panel).queryByText("Supply Chain Flow")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Demand" }));
    expect(screenSectionIds()).toEqual(["demand", "portfolio", "market"]);
    expect(screen.getByRole("tab", { name: "Demand" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Supply & Stock" }));
    expect(screenSectionIds()).toEqual(["flow", "supply", "stockSituation", "inventory", "forward"]);
    expect(screen.queryByRole("tab", { name: "Demand" })).toHaveAttribute("aria-selected", "false");
    expect(document.querySelector('.perf-screen-tree [data-perf-section="demand"]')).toBeNull();
  });

  it("mounts Monthly Analysis on demand with the active filter input and keeps it out of presentation", () => {
    render(<CountryPerformancePage />);
    expect(H.monthlyInputs).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Monthly Analysis" }));
    expect(screen.getByText("No monthly analysis data")).toBeInTheDocument();
    expect(H.monthlyInputs).toHaveLength(1);
    expect(H.monthlyInputs[0]).toMatchObject({ country: "Libya", preset: "ytd", compare: "plan", includeFoc: true });
    fireEvent.click(screen.getByRole("button", { name: "Open presentation" }));
    expect(screen.getByTestId("presentation-order")).not.toHaveTextContent("monthly");
  });

  it("loads and remembers tabs per authenticated user, including when the account changes in place", async () => {
    localStorage.setItem("ssof-performance-tab:1", "demand");
    localStorage.setItem("ssof-performance-tab:2", "supply");
    const view = render(<CountryPerformancePage />);
    expect(screen.getByRole("tab", { name: "Demand" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Value" }));
    await waitFor(() => expect(localStorage.getItem("ssof-performance-tab:1")).toBe("value"));

    H.user = { id: 2, username: "planner-two", displayName: "Planner Two", role: "viewer", countries: ["Lebanon"], isOwner: false };
    view.rerender(<CountryPerformancePage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Supply & Stock" })).toHaveAttribute("aria-selected", "true"));
    expect(localStorage.getItem("ssof-performance-tab:2")).toBe("supply");
  });

  it("prints the complete saved order without a FOC section, honors hidden slides, then restores active-only browsing", () => {
    fireEvent.click(render(<CountryPerformancePage />).getByRole("tab", { name: "Supply & Stock" }));
    let printSnapshot: { ids: string[]; hiddenPortfolio: boolean; printing: boolean } | undefined;
    const print = vi.fn(() => {
      const frames = [...document.querySelectorAll(".perf-print-tree [data-perf-section]")];
      printSnapshot = {
        ids: frames.map((frame) => frame.getAttribute("data-perf-section")!.replace(/^print-/, "")),
        hiddenPortfolio: frames.some((frame) => frame.getAttribute("data-perf-section") === "print-portfolio" && frame.classList.contains("perf-hidden-slide")),
        printing: document.body.classList.contains("perf-printing"),
      };
    });
    Object.defineProperty(window, "print", { configurable: true, value: print });

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(print).toHaveBeenCalledOnce();
    expect(printSnapshot).toEqual({ ids: defaultOrder, hiddenPortfolio: true, printing: true });
    expect(printSnapshot?.ids).not.toContain("foc");

    act(() => window.dispatchEvent(new Event("afterprint")));
    expect(document.querySelector(".perf-print-tree")).toBeNull();
    expect(document.body).not.toHaveClass("perf-printing");
    expect(screenSectionIds()).toEqual(["flow", "supply", "stockSituation", "inventory", "forward"]);
  });

  it("gives presentation the complete saved slide order regardless of selected tab", () => {
    render(<CountryPerformancePage />);
    fireEvent.click(screen.getByRole("tab", { name: "Quality & Risk" }));
    fireEvent.click(screen.getByRole("button", { name: "Open presentation" }));
    expect(screen.getByTestId("presentation-order")).toHaveTextContent(
      defaultOrder.filter((id) => id !== "portfolio").join(","),
    );
    expect(screen.getByTestId("presentation-order")).not.toHaveTextContent("foc");
  });

  it("shows and switches only to accessible countries in Value without querying other country packs", () => {
    render(<CountryPerformancePage />);
    fireEvent.click(screen.getByRole("tab", { name: "Value" }));
    const countryAccess = screen.getByRole("region", { name: /All Countries/i });
    expect(within(countryAccess).getByRole("button", { name: "Lebanon" })).toBeInTheDocument();
    expect(within(countryAccess).getByRole("button", { name: /Libya/ })).toBeInTheDocument();
    expect(within(countryAccess).queryByRole("button", { name: "Syria" })).not.toBeInTheDocument();
    expect(within(countryAccess).queryByRole("button", { name: "KSA" })).not.toBeInTheDocument();
    fireEvent.click(within(countryAccess).getByRole("button", { name: "Lebanon" }));
    expect(H.setCountry).toHaveBeenCalledWith("Lebanon");
    expect(new Set(H.performanceInputs.map((input) => input.country))).toEqual(new Set(["Libya"]));
  });

  it("keeps the sticky rail inside DashboardLayout's actual content main scroll region", () => {
    render(
      <DashboardLayout>
        <CountryPerformancePage />
      </DashboardLayout>,
    );
    const rail = screen.getByRole("tablist", { name: "Analysis working groups" }).parentElement;
    expect(rail).toHaveClass("sticky", "top-0");
    expect(rail?.closest("main.flex-1.p-4")).not.toBeNull();
    expect(rail?.closest('main[data-slot="sidebar-inset"]')).not.toBeNull();
  });
});
