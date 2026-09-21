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

  it("lists every accessible country and expands the selected one", () => {
    render(<LastUpdatedPanel country="Syria" />);
    expect(screen.getByText("Last Updated")).toBeInTheDocument();
    expect(screen.getByText(/Lebanon/)).toBeInTheDocument();
    expect(screen.getByText(/KSA/)).toBeInTheDocument();
    // Selected country shows the full time + actor (username fallback when no display name)
    expect(screen.getByText(/Jul 2026.*· sary/)).toBeInTheDocument();
    // Non-selected countries only show the relative age
    expect(screen.queryByText(/Jun 2026/)).not.toBeInTheDocument();
    expect(screen.getByText("no update")).toBeInTheDocument();
  });

  it("puts the who/what detail in the tooltip", () => {
    render(<LastUpdatedPanel country="Lebanon" />);
    const lebanon = screen.getByText(/Lebanon/).closest("[title]");
    expect(lebanon?.getAttribute("title")).toMatch(/by Walid El Tayeh — Import — Planning FG 1kg/);
    expect(screen.getByText(/Jun 2026.*· Walid El Tayeh/)).toBeInTheDocument();
  });
});
