import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Country } from "@/contexts/AuthContext";
const m = vi.hoisted(() => ({ mutate: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), navigate: vi.fn(), clear: vi.fn(),
  pending: false, error: false, canManage: true, isHidden: false, options: null as any }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: m.invalidate }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/country-management", m.navigate] }));
vi.mock("@/contexts/CountryContext", async original => ({ ...await original<typeof import("@/contexts/CountryContext")>(),
  useCountry: () => ({ clearCountry: m.clear }) }));
vi.mock("@/hooks/useCountryVisibility", () => ({ useCountryVisibility: () => ({
  data: (["Lebanon", "Syria", "Libya", "KSA"] as Country[]).map(country => ({
    country, isHidden: m.isHidden, canManage: country === "Libya" && m.canManage,
  })),
  isLoading: false, isError: m.error, refetch: m.refetch,
}) }));
vi.mock("@/lib/trpc", () => ({ trpc: { countryVisibility: { setHidden: {
  useMutation: (options: any) => { m.options = options; return { isPending: m.pending, mutate: m.mutate }; },
} } } }));
import CountryManagementPage from "./CountryManagementPage";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); m.pending = false; m.error = false; m.canManage = true; m.isHidden = false;
});
describe("Admin country Hide/Restore controls", () => {
  it.each([false, true])("requires explicit confirmation before %s visibility change and retains all data", async hidden => {
    m.isHidden = hidden; render(<CountryManagementPage />);
    fireEvent.click(screen.getByRole("button", { name: hidden ? "Restore Libya" : "Hide Libya" }));
    expect(m.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(/Libya/);
    if (!hidden) expect(screen.getByRole("dialog")).toHaveTextContent(/data|records|history/);
    fireEvent.click(screen.getByRole("button", { name: hidden ? "Restore country" : "Hide country" }));
    expect(m.mutate).toHaveBeenCalledWith({ country: "Libya", hidden: !hidden });
    await act(async () => { await m.options.onSuccess({ country: "Libya", isHidden: !hidden }); });
    await waitFor(() => expect(m.refetch).toHaveBeenCalled());
    expect(m.invalidate).toHaveBeenCalled();
  });
  it("shows no mutation controls for viewers and no controls for unassigned countries", () => {
    m.canManage = false; render(<CountryManagementPage />);
    expect(screen.queryByRole("button", { name: /Hide|Restore/ })).not.toBeInTheDocument();
  });
  it("does not allow duplicate clicks while saving", () => {
    m.pending = true; render(<CountryManagementPage />);
    expect(screen.getByRole("button", { name: "Hide Libya" })).toBeDisabled();
  });
  it("clears the selected country when returning to country selection", () => {
    render(<CountryManagementPage />);
    fireEvent.click(screen.getByRole("button", { name: "Back to countries" }));
    expect(m.clear).toHaveBeenCalled(); expect(m.navigate).toHaveBeenCalledWith("/");
  });
  it("fails closed and offers retry when visibility cannot be loaded", () => {
    m.error = true; render(<CountryManagementPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide Libya" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(m.refetch).toHaveBeenCalled();
  });
});
