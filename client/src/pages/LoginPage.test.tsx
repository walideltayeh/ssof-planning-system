import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const login = vi.fn();
const setCountry = vi.fn();
const clearCountry = vi.fn();
const navigate = vi.fn();
const toastSuccess = vi.fn();

let countryValue: string | null = "Lebanon";

vi.mock("@/contexts/AuthContext", () => ({
  useAppAuth: () => ({ login }),
}));

vi.mock("@/contexts/CountryContext", async () => {
  const actual = await vi.importActual<
    typeof import("@/contexts/CountryContext")
  >("@/contexts/CountryContext");
  return {
    ...actual,
    useCountry: () => ({
      country: countryValue,
      setCountry,
      clearCountry,
    }),
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigate],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import LoginPage from "./LoginPage";

describe("LoginPage", () => {
  beforeEach(() => {
    login.mockReset();
    setCountry.mockReset();
    clearCountry.mockReset();
    navigate.mockReset();
    toastSuccess.mockReset();
    countryValue = "Lebanon";
    cleanup();
  });

  it("submits valid credentials, calls login with the selected country, then navigates home", async () => {
    login.mockResolvedValueOnce(null);
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), "walid");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith("walid", "secret123", "Lebanon");
    expect(navigate).toHaveBeenCalledWith("/");
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/welcome back, walid/i),
    );
  });

  it("shows the server's error message and does not navigate when login fails", async () => {
    login.mockResolvedValueOnce("Invalid username or password");
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), "walid");
    await user.type(screen.getByLabelText(/^password$/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(login).toHaveBeenCalledWith("walid", "wrongpass", "Lebanon");
    expect(
      await screen.findByText(/invalid username or password/i),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("blocks submission and surfaces an error when no country is selected", async () => {
    countryValue = null;
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), "walid");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(login).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/please select a country first/i),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
