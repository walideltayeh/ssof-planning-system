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

type OwnerContact = { displayName: string; email: string | null };

let mockUser: MockUser = null;
let mockOwners: OwnerContact[] = [];

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

vi.mock("@/lib/trpc", () => ({
  trpc: {
    appUsers: {
      listOwners: {
        useQuery: () => ({ data: mockOwners, isLoading: false }),
      },
    },
  },
}));

import CountrySelectorPage from "./CountrySelectorPage";

describe("CountrySelectorPage", () => {
  beforeEach(() => {
    setCountry.mockReset();
    logout.mockReset();
    navigate.mockReset();
    mockUser = null;
    mockOwners = [];
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
    mockOwners = [{ displayName: "Walid El Tayeh", email: "walid@example.com" }];

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

  it("shows the workspace owner's name and pre-fills their email in the contact link", () => {
    mockUser = {
      displayName: "Stranger",
      countries: [],
      isOwner: false,
    };
    mockOwners = [{ displayName: "Walid El Tayeh", email: "walid@example.com" }];

    render(<CountrySelectorPage />);

    // The owner's name and email are visible in the empty state.
    const ownersList = screen.getByTestId("list-workspace-owners");
    expect(ownersList).toHaveTextContent("Walid El Tayeh");
    expect(ownersList).toHaveTextContent("walid@example.com");

    // The contact link recipient is the owner's email, not blank.
    const contactLink = screen.getByTestId("link-contact-owner");
    const href = contactLink.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:walid@example.com?")).toBe(true);
    expect(href).toContain(
      `subject=${encodeURIComponent("Requesting country access for SSOF Planning")}`,
    );
    // Button label personalises to the single owner.
    expect(contactLink.textContent).toMatch(/contact walid el tayeh/i);
  });

  it("lists every owner and includes all of their emails in the mailto when there are multiple", () => {
    mockUser = {
      displayName: "Stranger",
      countries: [],
      isOwner: false,
    };
    mockOwners = [
      { displayName: "Walid El Tayeh", email: "walid@example.com" },
      { displayName: "Aileen Khalil", email: "aileen@example.com" },
    ];

    render(<CountrySelectorPage />);

    const ownersList = screen.getByTestId("list-workspace-owners");
    expect(ownersList).toHaveTextContent("Walid El Tayeh");
    expect(ownersList).toHaveTextContent("walid@example.com");
    expect(ownersList).toHaveTextContent("Aileen Khalil");
    expect(ownersList).toHaveTextContent("aileen@example.com");

    const contactLink = screen.getByTestId("link-contact-owner");
    const href = contactLink.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:walid@example.com,aileen@example.com?")).toBe(
      true,
    );
    expect(contactLink.textContent).toMatch(/contact the workspace owners/i);
  });

  it("falls back gracefully without a broken link when no owner email is configured", () => {
    mockUser = {
      displayName: "Stranger",
      countries: [],
      isOwner: false,
    };
    mockOwners = [{ displayName: "Walid El Tayeh", email: null }];

    render(<CountrySelectorPage />);

    // Friendly copy is preserved.
    expect(
      screen.getByText(/you don't have access to any countries yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ask your workspace owner to grant you access/i),
    ).toBeInTheDocument();

    // No broken mailto link is rendered.
    expect(
      screen.queryByTestId("link-contact-owner"),
    ).not.toBeInTheDocument();
    // A small note explains contact info is missing.
    expect(screen.getByTestId("no-owner-contact")).toBeInTheDocument();
    // Owner display list is not rendered when there are no usable emails.
    expect(
      screen.queryByTestId("list-workspace-owners"),
    ).not.toBeInTheDocument();
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
