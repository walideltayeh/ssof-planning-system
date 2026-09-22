import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LastUpdatedPanel from "./LastUpdatedPanel";

const rows = [
  { country: "Lebanon", at: "2026-06-09T06:01:46.994Z", username: "walid", displayName: "Walid El Tayeh", action: "import", sheet: "Planning FG 1kg", details: null },
  { country: "Syria", at: "2026-07-13T18:06:25.125Z", username: "sary", displayName: null, action: "edit_cell", sheet: "IMS", details: null },
  { country: "KSA", at: null, username: null, displayName: null, action: null, sheet: null, details: null },
];

vi.mock("@/hooks/useLastUpdates", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useLastUpdates")>("@/hooks/useLastUpdates");
  return { ...actual, useLastUpdates: () => ({ data: rows, isLoading: false }) };
});

describe("LastUpdatedPanel", () => {
  afterEach(cleanup);

  it("shows only the selected country, with time and actor", () => {
    render(<LastUpdatedPanel country="Syria" />);
    expect(screen.getByText("Last Updated")).toBeInTheDocument();
    expect(screen.getByText(/Syria/)).toBeInTheDocument();
    // Username fallback when the account has no display name
    expect(screen.getByText(/Jul 2026.*· sary/)).toBeInTheDocument();
    // Other countries never appear
    expect(screen.queryByText(/Lebanon/)).not.toBeInTheDocument();
    expect(screen.queryByText(/KSA/)).not.toBeInTheDocument();
  });

  it("puts the who/what detail in the tooltip", () => {
    render(<LastUpdatedPanel country="Lebanon" />);
    expect(screen.getByTestId("last-updated-panel").getAttribute("title")).toMatch(/by Walid El Tayeh — Import — Planning FG 1kg/);
    expect(screen.getByText(/Jun 2026.*· Walid El Tayeh/)).toBeInTheDocument();
  });

  it("says so when the selected country has no recorded update", () => {
    render(<LastUpdatedPanel country="KSA" />);
    expect(screen.getByText("no update")).toBeInTheDocument();
    expect(screen.getByText("No edits, uploads or imports recorded")).toBeInTheDocument();
  });

  it("renders nothing for a country the user cannot see", () => {
    const { container } = render(<LastUpdatedPanel country="Libya" />);
    expect(container).toBeEmptyDOMElement();
  });
});
