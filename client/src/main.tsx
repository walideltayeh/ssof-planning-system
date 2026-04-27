import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
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

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
  resetReloadGuardOnSuccess(event);
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
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
