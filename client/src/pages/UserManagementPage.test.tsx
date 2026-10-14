import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  users: [] as any[],
  auth: { isOwner: true, isAdmin: true, user: { username: "signed-in" } },
  pending: false,
  navigate: vi.fn(),
  invalidate: vi.fn(),
  mutationOptions: {} as Record<string, any>,
  mutate: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setPaused: vi.fn(),
  },
  mutateAsync: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAppAuth: () => m.auth }));
vi.mock("wouter", () => ({ useLocation: () => ["/users", m.navigate] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => {
  const hook = (name: string) => ({
    useMutation: (options: any) => {
      m.mutationOptions[name] = options;
      return {
        isPending: m.pending,
        mutate: m.mutate[name as keyof typeof m.mutate],
        mutateAsync: m.mutateAsync[name as keyof typeof m.mutateAsync],
      };
    },
  });
  return {
    trpc: {
      useUtils: () => ({ appUsers: { list: { invalidate: m.invalidate } } }),
      appUsers: {
        list: { useQuery: () => ({ data: m.users, isLoading: false }) },
        create: hook("create"),
        update: hook("update"),
        delete: hook("delete"),
        setPaused: hook("setPaused"),
      },
    },
  };
});

import UserManagementPage from "./UserManagementPage";

const users = [
  { id: 1, username: "owner", displayName: "Workspace Owner", email: "", role: "admin", countries: [], isOwner: true },
  { id: 2, username: "signed-in", displayName: "Signed In User", email: "", role: "admin", countries: ["Lebanon"], isOwner: false },
  { id: 3, username: "amira", displayName: "Amira Haddad", email: "", role: "viewer", countries: ["Syria"], isOwner: false },
  { id: 4, username: "samir", displayName: "Samir Nasser", email: "", role: "viewer", countries: ["Libya"], isOwner: false, isPaused: true },
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.users = users;
  m.auth = { isOwner: true, isAdmin: true, user: { username: "signed-in" } };
  m.pending = false;
  m.mutationOptions = {};
});

describe("User account pause and resume", () => {
  it("shows active by default for older rows and shows paused state for paused rows", () => {
    render(<UserManagementPage />);
    expect(screen.getByTestId("status-account-3")).toHaveTextContent("Active");
    expect(screen.getByTestId("status-account-4")).toHaveTextContent("Paused");
  });

  it("requires confirmation before pausing, communicates access/session impact, and refreshes after success", async () => {
    render(<UserManagementPage />);
    fireEvent.click(screen.getByRole("button", { name: "Pause Amira Haddad" }));
    expect(m.mutate.setPaused).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Pause Amira Haddad" });
    expect(dialog).toHaveTextContent(/blocks account access and current signed-in sessions/i);
    expect(dialog).toHaveTextContent(/resume restores access/i);
    expect(dialog).toHaveTextContent(/countries, roles, and history will be retained/i);

    fireEvent.click(screen.getByRole("button", { name: "Pause account" }));
    expect(m.mutate.setPaused).toHaveBeenCalledWith({ id: 3, isPaused: true });
    await act(async () => {
      m.mutationOptions.setPaused.onSuccess({ success: true, isPaused: true });
    });
    await waitFor(() => expect(m.invalidate).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resumes a paused account directly and blocks controls for owners and the signed-in account", () => {
    render(<UserManagementPage />);
    fireEvent.click(screen.getByRole("button", { name: "Resume Samir Nasser" }));
    expect(m.mutate.setPaused).toHaveBeenCalledWith({ id: 4, isPaused: false });
    expect(screen.queryByRole("button", { name: /Pause Workspace Owner|Resume Workspace Owner/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pause Signed In User|Resume Signed In User/ })).not.toBeInTheDocument();
  });

  it("disables pause and resume toggles while a mutation is pending", () => {
    m.pending = true;
    render(<UserManagementPage />);
    expect(screen.getByRole("button", { name: "Pause Amira Haddad" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume Samir Nasser" })).toBeDisabled();
  });

  it("keeps owner-only access and existing account management controls", () => {
    m.auth = { isOwner: false, isAdmin: true, user: { username: "signed-in" } };
    render(<UserManagementPage />);
    expect(screen.queryByRole("button", { name: "Pause Amira Haddad" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Amira Haddad/ })).not.toBeInTheDocument();
    expect(m.navigate).toHaveBeenCalledWith("/");
  });
});
