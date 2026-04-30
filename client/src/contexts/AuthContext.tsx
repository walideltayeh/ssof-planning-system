import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { trpc } from "@/lib/trpc";

export type AppRole = "admin" | "viewer";
export type Country = "Lebanon" | "Syria" | "Libya" | "KSA";

export interface AppUser {
  id: number;
  username: string;
  displayName: string;
  role: AppRole;
  countries: string[];
  /**
   * Per-country role overrides. Missing entry → caller's global `role` applies
   * for that country. Owners always behave as admin regardless of overrides.
   */
  countryRoles?: Record<string, AppRole>;
  isOwner: boolean;
  email?: string | null;
}

interface AuthState {
  user: AppUser | null;
  country: Country | null;
}

interface AuthContextValue {
  user: AppUser | null;
  country: Country | null;
  isOwner: boolean;
  /**
   * True iff the caller is admin for the *currently selected* country. Owners
   * are admin everywhere. Falls back to the user's global `role` when no
   * per-country override is set, matching server-side `getEffectiveAppRole`.
   * If no country is selected yet, true when the user is admin for at least
   * one assigned country (so admin-only nav links remain visible).
   */
  isAdmin: boolean;
  isAuthenticated: boolean;
  canAccessCountry: (c: Country) => boolean;
  /** Per-country role check. Owners always return true. */
  isAdminFor: (c: Country) => boolean;
  login: (username: string, password: string, country?: Country) => Promise<string | null>;
  logout: () => void;
  setCountry: (c: Country) => void;
  clearCountry: () => void;
}

const SESSION_KEY = "ssof-session-v2";
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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadSession);

  const verifyLoginMutation = trpc.appUsers.verifyLogin.useMutation();

  const login = async (username: string, password: string, country?: Country): Promise<string | null> => {
    try {
      const result = await verifyLoginMutation.mutateAsync({
        username,
        password,
        ...(country ? { country } : {}),
      });
      if (!result.success || !result.user) {
        return result.error ?? "Invalid username or password";
      }
      const user = result.user as AppUser;
      const userCountries = user.isOwner
        ? ["Lebanon", "Syria", "Libya", "KSA"]
        : user.countries;
      const resolvedCountry = country
        ? country
        : userCountries.length === 1
          ? (userCountries[0] as Country)
          : null;
      const newState: AuthState = { user, country: resolvedCountry };
      setState(newState);
      saveSession(newState);
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      return msg;
    }
  };

  const setCountry = (c: Country) => {
    const newState: AuthState = { ...state, country: c };
    setState(newState);
    saveSession(newState);
  };

  const clearCountry = () => {
    const newState: AuthState = { ...state, country: null };
    setState(newState);
    saveSession(newState);
  };

  const logout = () => {
    setState({ user: null, country: null });
    clearSession();
  };

  const isOwner = state.user?.isOwner ?? false;
  const isAuthenticated = state.user !== null;
  const canAccessCountry = (c: Country) => {
    if (!state.user) return false;
    if (state.user.isOwner) return true;
    return state.user.countries.includes(c);
  };
  const isAdminFor = (c: Country): boolean => {
    if (!state.user) return false;
    if (state.user.isOwner) return true;
    const override = state.user.countryRoles?.[c];
    if (override) return override === "admin";
    return state.user.role === "admin";
  };
  // Legacy `isAdmin` resolves against the currently selected country so
  // existing call-sites (e.g. country-scoped pages) keep working. When no
  // country is selected, fall back to "admin somewhere" so admin-only nav
  // entries stay visible on the country selector.
  const isAdmin = (() => {
    if (!state.user) return false;
    if (state.user.isOwner) return true;
    if (state.country) return isAdminFor(state.country);
    if (state.user.role === "admin") return true;
    const overrides = state.user.countryRoles ?? {};
    return Object.values(overrides).some(r => r === "admin");
  })();

  return (
    <AuthContext.Provider value={{
      user: state.user,
      country: state.country,
      isOwner,
      isAdmin,
      isAuthenticated,
      canAccessCountry,
      isAdminFor,
      login,
      logout,
      setCountry,
      clearCountry,
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

/** @deprecated Use useAuth() instead */
export const useAppAuth = useAuth;
export type ManagedUser = AppUser;
export type UserRole = AppRole;
