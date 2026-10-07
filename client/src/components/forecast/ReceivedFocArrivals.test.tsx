import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReceivedFocArrivals } from "./ReceivedFocArrivals";
import { summarizeFocReceipts } from "@shared/performance/focReceipts";

const m = vi.hoisted(() => ({ entries: [] as any[], unit: "MC" as "MC" | "KG" | "Tons", query: vi.fn() }));
vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({ unit: m.unit }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { focPlanning: { list: { useQuery: (input: unknown) => {
  m.query(input);
  return { data: { skus: [{ id: 1, name: "Mint", weight: "50g", packagingType: "New" }], receipts: { entries: m.entries } } };
} } } } }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); m.entries = []; m.unit = "MC"; });
afterEach(cleanup);
const ds = {
  country: "Libya" as const, skus: [{ id: 1, name: "Mint", weight: "50g", packagingType: "New" }],
  periods: [{ id: 6, year: 2026, month: 6, label: "Jun 26", sortOrder: 6 }],
  arrival: [], planningFg: [], clearanceEvents: [], foc: [{ skuId: 1, periodId: 6, value: "20.00", received: false }],
};
describe("FOC arrivals use the received operational ledger", () => {
  it("shows no arrival or quantity for unreceived FOC", () => {
    m.entries = summarizeFocReceipts(ds, true).entries; render(<ReceivedFocArrivals country="Libya" />);
    expect(screen.queryByRole("region", { name: "Received FOC arrivals" })).not.toBeInTheDocument();
  });
  it("adds received FOC in its own month and removes it exactly when unreceived", () => {
    m.entries = summarizeFocReceipts({ ...ds, foc: [{ ...ds.foc[0], received: true }] }, true).entries;
    localStorage.setItem("ssof:include-foc:Libya", "false");
    const view = render(<ReceivedFocArrivals country="Libya" />);
    expect(screen.getByTestId("foc-arrival-total")).toHaveTextContent("20 MC");
    expect(screen.getByRole("row", { name: /FOC arrival Mint.*Jun 26/ })).toHaveTextContent("20");
    expect(m.query).toHaveBeenCalledWith({ country: "Libya", includeFoc: true });
    m.entries = summarizeFocReceipts(ds, true).entries; view.rerender(<ReceivedFocArrivals country="Libya" />);
    expect(screen.queryByTestId("foc-arrival-total")).not.toBeInTheDocument();
  });
  it("holds an apparent duplicate out of arrivals instead of adding it twice", () => {
    m.entries = summarizeFocReceipts({ ...ds, foc: [{ ...ds.foc[0], received: true }],
      clearanceEvents: [{ skuId: 1, country: "Libya", clearedQty: "20", clearedDate: "2026-06-20" }] }, true).entries;
    render(<ReceivedFocArrivals country="Libya" />);
    expect(screen.getByRole("alert")).toHaveTextContent("held out of arrivals");
    expect(screen.getByTestId("foc-arrival-total")).toHaveTextContent("0 MC");
    expect(screen.queryByRole("row", { name: /FOC arrival Mint/ })).not.toBeInTheDocument();
  });
  it.each([["MC", "20"], ["KG", "120"], ["Tons", "0.12"]] as const)("displays exact received arrivals in %s", (unit, value) => {
    m.unit = unit; m.entries = summarizeFocReceipts({ ...ds, foc: [{ ...ds.foc[0], received: true }] }, true).entries;
    render(<ReceivedFocArrivals country="Libya" />);
    expect(screen.getByTestId("foc-arrival-total")).toHaveTextContent(`${value} ${unit}`);
  });
});
