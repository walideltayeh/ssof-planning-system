import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { trpc } from "@/lib/trpc";

// ── Types ─────────────────────────────────────────────────────────────────────
export type AppRole = "admin" | "viewer";
export type Country = "Lebanon" | "Syria" | "Libya";

export interface AppUser {
  id: number;
  username: string;
  displayName: string;
  role: AppRole;
  countries: string[];
  isOwner: boolean;
}

interface AuthState {
  user: AppUser | null;
  country: Country | null;
}

interface AuthContextValue {
  user: AppUser | null;
  country: Country | null;
  isOwner: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  canAccessCountry: (c: Country) => boolean;
  login: (username: string, password: string, country: Country) => Promise<string | null>;
  logout: () => void;
}

// ── Persistence ───────────────────────────────────────────────────────────────
const SESSION_KEY = "ssof-session-v2";
// One-time cleanup: remove stale keys from the old localStorage-based auth system
// so they don't cause confusion on devices that previously used the old system.
try {
  ["ssof-session", "ssof-users", "ssof-managed-users"].forEach(k => localStorage.removeItem(k));
} catch { /* ignore */ }

function loadSession(): AuthState {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as AuthState;
  } catch { /* ignore */ }
  return { user: null, country: null };
}

function saveSession(state: AuthState) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadSession);

  const verifyLoginMutation = trpc.appUsers.verifyLogin.useMutation();

  const login = async (username: string, password: string, country: Country): Promise<string | null> => {
    try {
      const result = await verifyLoginMutation.mutateAsync({ username, password, country });
      if (!result.success || !result.user) {
        return result.error ?? "Invalid username or password";
      }
      const newState: AuthState = { user: result.user as AppUser, country };
      setState(newState);
      saveSession(newState);
      return null; // success
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      return msg;
    }
  };

  const logout = () => {
    setState({ user: null, country: null });
    clearSession();
  };

  const isOwner = state.user?.isOwner ?? false;
  const isAdmin = state.user?.role === "admin" || isOwner;
  const isAuthenticated = state.user !== null;
  const canAccessCountry = (c: Country) => {
    if (!state.user) return false;
    if (state.user.isOwner) return true;
    return state.user.countries.includes(c);
  };

  return (
    <AuthContext.Provider value={{
      user: state.user,
      country: state.country,
      isOwner,
      isAdmin,
      isAuthenticated,
      canAccessCountry,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ── Backward-compat aliases ───────────────────────────────────────────────────
/** @deprecated Use useAuth() instead */
export const useAppAuth = useAuth;
export type ManagedUser = AppUser;
export type UserRole = AppRole;
