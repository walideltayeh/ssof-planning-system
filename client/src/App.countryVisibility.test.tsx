import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ authenticated: true, country: "Libya" as string | null, location: "/forecast",
  hidden: false, loading: false, error: false, clear: vi.fn(), navigate: vi.fn(), refetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ AuthProvider: () => null,
  useAppAuth: () => ({ isAuthenticated: m.authenticated, country: m.country }) }));
vi.mock("@/contexts/CountryContext", () => ({ CountryProvider: () => null,
  COUNTRY_CONFIG: {}, useCountry: () => ({ clearCountry: m.clear }) }));
vi.mock("./hooks/useCountryVisibility", () => ({ useCountryVisibility: () => ({
  data: m.loading ? undefined : [{ country: "Libya", isHidden: m.hidden, canManage: true }],
  isLoading: m.loading, isError: m.error, refetch: m.refetch,
}) }));
vi.mock("./hooks/useAuditLog", () => ({ useNavigationLogger: () => {} }));
vi.mock("./components/AutoSaveReminder", () => ({ default: () => null }));
vi.mock("wouter", () => ({
  useLocation: () => [m.location, m.navigate], Switch: () => <div>Planning data mounted</div>,
  Route: () => null, Redirect: () => null,
}));
vi.mock("./components/DashboardLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("./pages/LandingPage", () => ({ default: () => <div>Sign in fixture</div> }));
vi.mock("./pages/CountrySelectorPage", () => ({ default: () => <div>Country selection fixture</div> }));
vi.mock("./pages/CountryManagementPage", () => ({ default: () => <div>Country restoration fixture</div> }));
import { AppContent } from "./App";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); Object.assign(m, { authenticated: true, country: "Libya", location: "/forecast", hidden: false, loading: false, error: false }); });
describe("country availability gate in active sessions", () => {
  it("unmounts planning data and clears an already selected country when it becomes hidden", () => {
    const view = render(<AppContent />);
    expect(screen.getByText("Planning data mounted")).toBeInTheDocument();
    m.hidden = true; view.rerender(<AppContent />);
    expect(screen.queryByText("Planning data mounted")).not.toBeInTheDocument();
    expect(screen.getByText("Country selection fixture")).toBeInTheDocument();
    expect(m.clear).toHaveBeenCalled();
    expect(m.navigate).toHaveBeenCalledWith("/");
  });
  it.each(["loading", "error"])("does not mount country queries before availability is confirmed: %s", status => {
    m[status as "loading" | "error"] = true; render(<AppContent />);
    expect(screen.queryByText("Planning data mounted")).not.toBeInTheDocument();
  });
  it.each([null, "Libya"])("keeps restoration reachable without a visible selected country: %s", country => {
    m.country = country; m.location = "/country-management"; m.hidden = true;
    render(<AppContent />);
    expect(screen.getByText("Country restoration fixture")).toBeInTheDocument();
    expect(m.clear).not.toHaveBeenCalled();
  });
  it("does not grant anonymous callers access to management", () => {
    m.authenticated = false; m.location = "/country-management"; render(<AppContent />);
    expect(screen.getByText("Sign in fixture")).toBeInTheDocument();
    expect(screen.queryByText("Country restoration fixture")).not.toBeInTheDocument();
  });
});
