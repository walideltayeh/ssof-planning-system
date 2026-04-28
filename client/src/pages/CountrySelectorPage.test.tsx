import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setCountry = vi.fn();
const logout = vi.fn();
const navigate = vi.fn();

type MockUser = {
  displayName: string;
  countries: string[];
  isOwner: boolean;
} | null;

let mockUser: MockUser = null;

vi.mock("@/contexts/AuthContext", () => ({
  useAppAuth: () => ({
    user: mockUser,
    setCountry,
    logout,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/select-country", navigate],
}));

import CountrySelectorPage from "./CountrySelectorPage";

describe("CountrySelectorPage", () => {
  beforeEach(() => {
    setCountry.mockReset();
    logout.mockReset();
    navigate.mockReset();
    mockUser = null;
    cleanup();
  });

  it("shows only the user's single allowed country and selects it on click", async () => {
    mockUser = {
      displayName: "Aileen",
      countries: ["Lebanon"],
      isOwner: false,
    };
    const user = userEvent.setup();

    render(<CountrySelectorPage />);

    expect(screen.getByText(/welcome, aileen/i)).toBeInTheDocument();

    const lebanonBtn = screen.getByRole("button", { name: /enter lebanon/i });
    expect(lebanonBtn).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enter syria/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enter libya/i }),
    ).not.toBeInTheDocument();

    await user.click(lebanonBtn);

    expect(setCountry).toHaveBeenCalledTimes(1);
    expect(setCountry).toHaveBeenCalledWith("Lebanon");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("shows multiple country buttons when the user has access to several", async () => {
    mockUser = {
      displayName: "Walid",
      countries: ["Lebanon", "Syria"],
      isOwner: false,
    };
    const user = userEvent.setup();

    render(<CountrySelectorPage />);

    expect(
      screen.getByRole("button", { name: /enter lebanon/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enter syria/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enter libya/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /enter syria/i }));
    expect(setCountry).toHaveBeenCalledWith("Syria");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("shows all three countries for an owner regardless of the countries list", () => {
    mockUser = {
      displayName: "Owner",
      countries: [],
      isOwner: true,
    };

    render(<CountrySelectorPage />);

    expect(
      screen.getByRole("button", { name: /enter lebanon/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enter syria/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enter libya/i }),
    ).toBeInTheDocument();
  });

  it("shows no country buttons when a non-owner user has no countries", () => {
    mockUser = {
      displayName: "Stranger",
      countries: [],
      isOwner: false,
    };

    render(<CountrySelectorPage />);

    expect(screen.getByText(/welcome, stranger/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enter lebanon/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enter syria/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enter libya/i }),
    ).not.toBeInTheDocument();
    expect(setCountry).not.toHaveBeenCalled();
  });

  it("shows a friendly empty-state message when a non-owner has no countries", () => {
    mockUser = {
      displayName: "Stranger",
      countries: [],
      isOwner: false,
    };

    render(<CountrySelectorPage />);

    expect(
      screen.getByText(/no countries are available for your account/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/you don't have access to any countries yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ask your workspace owner to grant you access/i),
    ).toBeInTheDocument();

    const contactLink = screen.getByTestId("link-contact-owner");
    expect(contactLink).toBeInTheDocument();
    expect(contactLink.getAttribute("href")).toMatch(/^mailto:/);
  });

  it("calls logout when the 'Sign out' link is clicked", async () => {
    mockUser = {
      displayName: "Walid",
      countries: ["Lebanon"],
      isOwner: false,
    };
    const user = userEvent.setup();

    render(<CountrySelectorPage />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while there is no user yet", () => {
    mockUser = null;
    const { container } = render(<CountrySelectorPage />);
    expect(container.firstChild).toBeNull();
  });
});
