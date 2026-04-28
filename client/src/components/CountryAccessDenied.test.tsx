import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const clearCountry = vi.fn();
const navigate = vi.fn();

vi.mock("@/contexts/CountryContext", () => ({
  useCountry: () => ({ clearCountry }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/somewhere", navigate],
}));

import CountryAccessDenied from "./CountryAccessDenied";

describe("CountryAccessDenied", () => {
  beforeEach(() => {
    clearCountry.mockReset();
    navigate.mockReset();
    cleanup();
  });

  it("shows the country and owner names when both are provided", () => {
    render(<CountryAccessDenied country="Syria" ownerName="Walid" />);

    expect(
      screen.getByText(/Syria isn't part of your access/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask Walid to grant access/i),
    ).toBeInTheDocument();
  });

  it("falls back to friendly placeholders when country and owner are missing", () => {
    render(<CountryAccessDenied />);

    expect(
      screen.getByText(/this country isn't part of your access/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask the workspace owner to grant access/i),
    ).toBeInTheDocument();
  });

  it("treats blank/whitespace strings as missing values", () => {
    render(<CountryAccessDenied country="   " ownerName="" />);

    expect(
      screen.getByText(/this country isn't part of your access/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask the workspace owner to grant access/i),
    ).toBeInTheDocument();
  });

  it("clears the selected country and navigates home when 'Switch country' is clicked", async () => {
    const user = userEvent.setup();
    render(<CountryAccessDenied country="Lebanon" ownerName="Walid" />);

    await user.click(screen.getByRole("button", { name: /switch country/i }));

    expect(clearCountry).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
