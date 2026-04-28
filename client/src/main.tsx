import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { toast } from "sonner";
import App from "./App";
import { getLoginUrl } from "./const";
import { isCountryAccessError, extractCountryFromAccessError } from "./lib/countryAccessError";
import { setDeniedCountry } from "./lib/countryAccessStore";
import "./index.css";

const queryClient = new QueryClient();

// SSOF stores its app session in localStorage (key "ssof-session-v2"),
// independent of the server's HTTP-only auth cookie. When the cookie expires
// (or the user was never logged in on this browser) the localStorage session
// is stale: the app thinks the user is logged in and starts firing protected
// mutations like presence.heartbeat / audit.logAction, every one of which
// the server rejects with 401 "Please login (10001)". The previous handler
// reacted by hard-navigating to getLoginUrl() — but when no OAuth portal is
// configured that resolves to "/", the page reloads, the stale session is
// re-read from localStorage, and the loop restarts. Visible symptom: the
// site "blinks" forever on landing.
//
// The correct response on 401 is to (a) clear the stale localStorage session
// so the next mount renders the LandingPage instead of the dashboard, and
// (b) reload only when an OAuth portal redirect is actually different from
// where we already are. A sessionStorage guard prevents repeat reloads in
// any remaining edge case.
const SESSION_KEY = "ssof-session-v2";
const RELOAD_GUARD_KEY = "ssof-auth-reload-guard";

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (error.message !== UNAUTHED_ERR_MSG) return;

  // Clear stale client-side session so AuthProvider stops thinking the user
  // is signed in. Subsequent renders will hit App.tsx's "if (!isAuthenticated)
  // return <LandingPage />" branch and stop firing protected mutations.
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }

  const loginUrl = getLoginUrl();

  // If a real OAuth portal is configured, navigate to it (different origin).
  if (loginUrl.startsWith("http") && loginUrl !== window.location.href) {
    window.location.href = loginUrl;
    return;
  }

  // Local fallback: do at most one reload to re-mount AuthProvider with a
  // cleared session. Without this guard a misbehaving query could still loop.
  // Wrap sessionStorage in try/catch — Safari private mode and some embedded
  // contexts throw on storage access, and we'd rather silently skip recovery
  // than crash the whole error subscriber.
  try {
    if (!sessionStorage.getItem(RELOAD_GUARD_KEY)) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      window.location.reload();
    }
  } catch { /* ignore — storage unavailable */ }
};

// Once the user successfully completes a query (any 2xx response), it's safe
// to reset the reload guard so a future genuine 401 can recover.
const resetReloadGuardOnSuccess = (event: { type: string; action?: { type: string } }) => {
  if (event.type === "updated" && event.action?.type === "success") {
    try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* ignore */ }
  }
};

// When the server says "You do not have access to <country>" mid-session
// (e.g. an owner just revoked the user's access), surface a friendly toast
// pointing them at who to ask. The DashboardLayout proactive guard
// (CountryAccessDenied) already handles the in-page render; this subscriber
// catches the case where access was revoked WHILE the user is sitting on a
// page so they get an immediate signal instead of silent query failures.
// We throttle per country so 5+ simultaneous country.* query failures on a
// single dashboard load only produce one toast — but a later revocation of
// a *different* country (or a re-grant + revoke cycle) still surfaces.
const recentlyToastedCountries = new Map<string, number>();
const COUNTRY_TOAST_COOLDOWN_MS = 60_000;
const showCountryAccessToast = (error: unknown) => {
  if (!isCountryAccessError(error)) return;
  const country = extractCountryFromAccessError(error) ?? "this country";
  // Persist the denial so DashboardLayout can swap in the friendly empty
  // state authoritatively (server says no, even if local cache says yes).
  setDeniedCountry(country);
  const now = Date.now();
  const last = recentlyToastedCountries.get(country);
  if (last && now - last < COUNTRY_TOAST_COOLDOWN_MS) return;
  recentlyToastedCountries.set(country, now);
  toast.error(`You no longer have access to ${country}`, {
    description:
      "Ask the workspace owner to grant access if you need to view this country's data.",
    duration: 8000,
  });
};

// Clear the per-country toast cooldown when the app session changes (login /
// logout / user switch) so a freshly logged-in user sees fresh notifications.
if (typeof window !== "undefined") {
  window.addEventListener("storage", evt => {
    if (evt.key === "ssof-session-v2") recentlyToastedCountries.clear();
  });
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    showCountryAccessToast(error);
    console.error("[API Query Error]", error);
  }
  resetReloadGuardOnSuccess(event);
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    showCountryAccessToast(error);
    console.error("[API Mutation Error]", error);
  }
  resetReloadGuardOnSuccess(event);
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
