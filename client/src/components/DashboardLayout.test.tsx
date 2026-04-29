import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// `DashboardLayout` is wired into a lot of the app's surface area (auth, tRPC,
// presence, country/unit contexts, sidebar resize, etc.). For Task #55 we only
// care about the self-service Change Password dialog, so we stub everything
// else just hard enough to render the sidebar with the user dropdown and the
// dialog. The bits we DO want to assert against (the password-strength hint,
// the disabled state of the "Change Password" button, and that we never call
// the mutation with a weak password) are kept real.
// ---------------------------------------------------------------------------

// `vi.mock` is hoisted to the top of the file, which means the factory bodies
// run BEFORE any top-level `const` is initialized. We therefore stash all the
// shared spies/state inside `vi.hoisted` so the mock factories can reach them
// safely. Tests still read/write the same objects through the `H` alias below.
const H = vi.hoisted(() => {
  type AppUserMock = {
    id: number;
    username: string;
    displayName: string;
    role: "admin" | "viewer";
    countries: string[];
    isOwner: boolean;
  } | null;
  type ChangePwOpts = {
    onSuccess?: (result: { success: boolean; error?: string }) => void;
    onError?: (err: { message: string }) => void;
  };
  return {
    oauthLogout: vi.fn(),
    appLogout: vi.fn(),
    setCountry: vi.fn(),
    clearCountry: vi.fn(),
    setUnit: vi.fn(),
    navigate: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    changePasswordMutate: vi.fn(),
    heartbeatMutate: vi.fn(),
    leaveMutate: vi.fn(),
    logActionMutate: vi.fn(),
    serverLogoutMutate: vi.fn(),
    appUserMock: null as AppUserMock,
    lastChangePwOpts: undefined as ChangePwOpts | undefined,
  };
});

const oauthLogout = H.oauthLogout;
const appLogout = H.appLogout;
const setCountry = H.setCountry;
const clearCountry = H.clearCountry;
const setUnit = H.setUnit;
const navigate = H.navigate;
const toastSuccess = H.toastSuccess;
const toastError = H.toastError;
const changePasswordMutate = H.changePasswordMutate;
const heartbeatMutate = H.heartbeatMutate;
const leaveMutate = H.leaveMutate;
const logActionMutate = H.logActionMutate;
const serverLogoutMutate = H.serverLogoutMutate;

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    error: null,
    isAuthenticated: true,
    refresh: vi.fn(),
    logout: oauthLogout,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAppAuth: () => ({
    user: H.appUserMock,
    isAdmin: H.appUserMock?.role === "admin",
    isOwner: !!H.appUserMock?.isOwner,
    isAuthenticated: !!H.appUserMock,
    canAccessCountry: (c: string) =>
      !!H.appUserMock?.countries.includes(c) || !!H.appUserMock?.isOwner,
    logout: H.appLogout,
  }),
}));

vi.mock("@/contexts/CountryContext", async () => {
  const actual = await vi.importActual<
    typeof import("@/contexts/CountryContext")
  >("@/contexts/CountryContext");
  return {
    ...actual,
    useCountry: () => ({
      country: "Lebanon",
      setCountry,
      clearCountry,
      config: actual.COUNTRY_CONFIG.Lebanon,
    }),
  };
});

vi.mock("@/contexts/UnitContext", () => ({
  useUnit: () => ({
    unit: "MC",
    setUnit,
    convertVal: (v: number) => v,
    formatVal: (v: number) => String(v),
    unitLabel: "MC",
  }),
}));

vi.mock("@/lib/countryAccessStore", () => ({
  useDeniedCountry: () => null,
}));

vi.mock("@/hooks/useMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", navigate],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// Minimal tRPC proxy built inside the mock factory (so it's safe to reference
// `H` even though `vi.mock` is hoisted). Every leaf returns standard
// useMutation/useQuery stubs, EXCEPT `appUsers.changePassword.useMutation`,
// which captures the caller's onSuccess/onError on `H.lastChangePwOpts` so
// the production flow is preserved while we still get a `mutate` we can
// assert against.
vi.mock("@/lib/trpc", () => {
  const defaultMutation = (capturedMutate: ReturnType<typeof vi.fn>) => ({
    mutate: capturedMutate,
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
        setData: vi.fn(),
      }),
    },
  );
  const utils = new Proxy(
    {},
    {
      get: () => utilsLeaf,
    },
  );
  const trpc = new Proxy(
    { useUtils: () => utils },
    {
      get: (target, key) => {
        if (key === "useUtils")
          return (target as { useUtils: () => unknown }).useUtils;
        if (key === "appUsers") {
          return new Proxy(
            {},
            {
              get: (_t, procKey) => {
                if (procKey === "changePassword") {
                  return {
                    useMutation: (opts?: typeof H.lastChangePwOpts) => {
                      H.lastChangePwOpts = opts;
                      return defaultMutation(H.changePasswordMutate);
                    },
                  };
                }
                return {
                  useMutation: () => defaultMutation(vi.fn()),
                  useQuery: () => ({ data: undefined, isLoading: true }),
                };
              },
            },
          );
        }
        if (key === "presence") {
          return {
            heartbeat: {
              useMutation: () => defaultMutation(H.heartbeatMutate),
            },
            leave: { useMutation: () => defaultMutation(H.leaveMutate) },
            online: {
              useQuery: () => ({ data: [], isLoading: false }),
            },
          };
        }
        if (key === "audit") {
          return {
            logAction: {
              useMutation: () => defaultMutation(H.logActionMutate),
            },
          };
        }
        if (key === "auth") {
          return {
            logout: {
              useMutation: () => defaultMutation(H.serverLogoutMutate),
            },
          };
        }
        // Generic fallback for anything else.
        return new Proxy(
          {},
          {
            get: () => ({
              useMutation: () => defaultMutation(vi.fn()),
              useQuery: () => ({ data: undefined, isLoading: true }),
            }),
          },
        );
      },
    },
  );
  return { trpc };
});

// matchMedia stub for `useIsMobile`-adjacent code paths and any radix popper
// internals that may probe it under jsdom.
beforeEach(() => {
  if (!window.matchMedia) {
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
      query: string,
    ) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
});

import DashboardLayout from "./DashboardLayout";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openChangePasswordDialog(user: ReturnType<typeof userEvent.setup>) {
  // The user avatar/dropdown trigger lives in the sidebar footer. Find it via
  // the visible "Walid" display name and walk up to the button it lives in.
  const nameEl = await screen.findByText("Walid");
  const trigger = nameEl.closest("button");
  expect(trigger).not.toBeNull();
  await user.click(trigger!);
  // Now click the "Change Password" item that the dropdown reveals.
  const item = await screen.findByText(/change password/i);
  await user.click(item);
}

function getChangePasswordSubmit() {
  // The submit button inside the dialog is the one labeled "Change Password"
  // (the Cancel button is "Cancel"). Multiple matches can exist for the
  // text alone (the dropdown item is also labeled "Change Password"), so we
  // scope to role+name.
  return screen.getByRole("button", { name: /change password/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardLayout — Change Password dialog (weak password handling)", () => {
  beforeEach(() => {
    H.appUserMock = {
      id: 7,
      username: "walid",
      displayName: "Walid",
      role: "admin",
      countries: ["Lebanon", "Syria", "Libya"],
      isOwner: true,
    };
    changePasswordMutate.mockReset();
    heartbeatMutate.mockReset();
    leaveMutate.mockReset();
    logActionMutate.mockReset();
    serverLogoutMutate.mockReset();
    oauthLogout.mockReset();
    appLogout.mockReset();
    setCountry.mockReset();
    clearCountry.mockReset();
    setUnit.mockReset();
    navigate.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    H.lastChangePwOpts = undefined;
    cleanup();
  });

  it("disables the Change Password submit button while the new password is too short", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);

    const newPwInput = await screen.findByTestId("input-change-password-new");
    await user.type(newPwInput, "abc1");

    // Hint should appear with the destructive variant test id, NOT the OK one.
    const hint = await screen.findByTestId("text-change-password-strength-hint");
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/at least 8 characters/i);
    expect(
      screen.queryByTestId("text-change-password-strength-ok"),
    ).not.toBeInTheDocument();

    expect(getChangePasswordSubmit()).toBeDisabled();
  });

  it("shows the missing-letter hint and keeps the submit disabled for a digits-only password", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    const newPwInput = await screen.findByTestId("input-change-password-new");
    await user.type(newPwInput, "12345678");

    const hint = await screen.findByTestId("text-change-password-strength-hint");
    expect(hint.textContent).toMatch(/a letter/i);
    expect(hint.textContent).not.toMatch(/at least \d+ characters/i);
    expect(getChangePasswordSubmit()).toBeDisabled();
  });

  it("shows the missing-number hint and keeps the submit disabled for a letters-only password", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    const newPwInput = await screen.findByTestId("input-change-password-new");
    await user.type(newPwInput, "abcdefgh");

    const hint = await screen.findByTestId("text-change-password-strength-hint");
    expect(hint.textContent).toMatch(/a number/i);
    expect(getChangePasswordSubmit()).toBeDisabled();
  });

  it("flips to the OK hint and enables the submit only once the password meets every requirement", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    const newPwInput = await screen.findByTestId("input-change-password-new");

    await user.type(newPwInput, "abcdefgh");
    expect(getChangePasswordSubmit()).toBeDisabled();
    expect(
      screen.getByTestId("text-change-password-strength-hint"),
    ).toBeInTheDocument();

    await user.type(newPwInput, "1");
    const ok = await screen.findByTestId("text-change-password-strength-ok");
    expect(ok.textContent).toMatch(/strong password/i);
    expect(
      screen.queryByTestId("text-change-password-strength-hint"),
    ).not.toBeInTheDocument();
    expect(getChangePasswordSubmit()).toBeEnabled();
  });

  it("does not call the changePassword mutation when the user clicks while the password is still weak", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    const newPwInput = await screen.findByTestId("input-change-password-new");
    await user.type(newPwInput, "weak");

    // The submit button is disabled, but try to click anyway. userEvent
    // respects `disabled`, so this is a no-op — exactly the contract we want
    // to lock in (the weak password must NOT reach the server even via a
    // stale click).
    await user.click(getChangePasswordSubmit());

    expect(changePasswordMutate).not.toHaveBeenCalled();
  });

  it("rejects weak input from the keyboard Enter shortcut on the confirm field too", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    // Fill enough to look like a real attempt but with a weak new password.
    await user.type(
      await screen.findByPlaceholderText(/current password/i),
      "oldpass1",
    );
    await user.type(
      screen.getByTestId("input-change-password-new"),
      "weak",
    );
    const confirm = screen.getByPlaceholderText(/confirm new password/i);
    await user.type(confirm, "weak{Enter}");

    expect(changePasswordMutate).not.toHaveBeenCalled();
    // The inline error surfaces the shared requirements message rather than
    // silently failing. We look for the "include a letter and a number"
    // phrasing that is unique to PASSWORD_REQUIREMENTS_MESSAGE (the strength
    // hint uses a different "Password must contain ..." phrasing for missing
    // requirements), so this also pins that the canonical shared message is
    // what we surface.
    expect(
      await screen.findByText(/include a letter and a number/i),
    ).toBeInTheDocument();
  });

  it("forwards a strong password to the changePassword mutation with the right payload", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    await user.type(
      await screen.findByPlaceholderText(/current password/i),
      "oldpass1",
    );
    await user.type(
      screen.getByTestId("input-change-password-new"),
      "secret123",
    );
    await user.type(
      screen.getByPlaceholderText(/confirm new password/i),
      "secret123",
    );

    await user.click(getChangePasswordSubmit());

    expect(changePasswordMutate).toHaveBeenCalledTimes(1);
    expect(changePasswordMutate).toHaveBeenCalledWith({
      currentPassword: "oldpass1",
      newPassword: "secret123",
      confirmPassword: "secret123",
    });
  });

  it("surfaces the server's weak-password error when the server-side backstop rejects a bypassed payload", async () => {
    const user = userEvent.setup();
    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await openChangePasswordDialog(user);
    await user.type(
      await screen.findByPlaceholderText(/current password/i),
      "oldpass1",
    );
    await user.type(
      screen.getByTestId("input-change-password-new"),
      "secret123",
    );
    await user.type(
      screen.getByPlaceholderText(/confirm new password/i),
      "secret123",
    );
    await user.click(getChangePasswordSubmit());

    // Simulate the case where someone bypasses the client form (e.g. devtools
    // or a stale build) and the server responds with the shared requirements
    // message. The dialog should display it inline instead of swallowing it.
    expect(H.lastChangePwOpts?.onError).toBeTypeOf("function");
    act(() => {
      H.lastChangePwOpts!.onError!({
        message:
          "Password must be at least 8 characters and include a letter and a number.",
      });
    });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/at least 8 characters/i),
    ).toBeInTheDocument();
  });
});
