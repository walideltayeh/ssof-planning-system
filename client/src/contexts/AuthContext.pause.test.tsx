import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  session: { data: undefined as object | null | undefined, isFetchedAfterMount: false, isFetching: false },
  cancel: vi.fn(),
  reset: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { cancel: m.cancel, reset: m.reset } } }),
    auth: { me: { useQuery: () => m.session } },
    appUsers: { verifyLogin: { useMutation: () => ({ mutateAsync: m.verify }) } },
  },
}));
import { AuthProvider, useAuth } from "./AuthContext";

const account = { id: 2, username: "viewer", displayName: "Viewer", role: "viewer", countries: ["Syria"], isOwner: false };
function Probe() {
  const auth = useAuth();
  return <><p>{auth.isAuthenticated ? "Signed in" : "Signed out"}</p><button onClick={() => auth.login("viewer", "test-password")}>Sign in</button></>;
}
beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  m.session = { data: undefined, isFetchedAfterMount: false, isFetching: false };
  m.verify.mockResolvedValue({ success: true, user: account });
  m.reset.mockImplementation(async () => {
    m.session = { data: undefined, isFetchedAfterMount: false, isFetching: false };
  });
});
describe("paused session recovery", () => {
  it("clears the stored session when a fresh server response no longer accepts it", async () => {
    localStorage.setItem("ssof-session-v2", JSON.stringify({ user: account, country: "Syria" }));
    m.session = { data: null, isFetchedAfterMount: true, isFetching: false };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    expect(localStorage.getItem("ssof-session-v2")).toBeNull();
  });
  it("keeps the session during a network failure or an unfinished check", () => {
    localStorage.setItem("ssof-session-v2", JSON.stringify({ user: account, country: "Syria" }));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(localStorage.getItem("ssof-session-v2")).not.toBeNull();
  });
  it("does not let a cached signed-out result undo a successful login", async () => {
    m.session = { data: null, isFetchedAfterMount: true, isFetching: false };
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("Signed in")).toBeInTheDocument());
    expect(m.cancel).toHaveBeenCalled();
    expect(m.reset).toHaveBeenCalled();
  });
});
