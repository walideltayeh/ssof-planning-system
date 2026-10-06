import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnitProvider } from "@/contexts/UnitContext";
import type { PerformancePack } from "./types";
import SyriaReconciliationSection from "./SyriaReconciliationSection";
import { performanceSections } from "./sections";
import type { SyriaReconciliation } from "@shared/performance/syriaReconciliation";

const baseReconciliation: SyriaReconciliation = {
  status: "available",
  from: "2026-01",
  to: "2026-03",
  generatedAt: "2026-04-02 09:30",
  checkedAt: "2026-04-02 09:31",
  scope: "Whole Syria; filters ignored.",
  lines: [
    { id: "ims", label: "IMS", tracker: 100, ssof: 100, difference: 0, ties: true, breakdown: [], missing: [] },
    { id: "arrivals", label: "Inbound", tracker: 80, ssof: 75, difference: 5, ties: false, breakdown: [{ cause: "unexplained", label: "Unexplained", mc: 0, note: "No residual.", details: [] }], missing: [] },
    { id: "warehouse", label: "Warehouse stock", tracker: 50, ssof: 45, difference: 5, ties: false, breakdown: [{ cause: "dated", label: "Dated", mc: 5, note: "Booked in 5 MC.", details: [{ sku: "Grape 50g", skuId: 1, month: "2026-02", trackerMonth: "2026-02", ssofMonth: "2026-01", mc: 5, note: "Period timing." }] }], missing: [] },
  ],
  mappedIms: { tracker: 90, ssof: 90, ties: true },
  conclusion: "Some warehouse stock remains unreconciled.",
  warning: false,
  pendingProduction: [{ sku: "Grape 50g", month: "2026-03", mc: 12, note: "Pending." }],
  ignoredOpeningEntries: [{ sku: "Orange 50g", month: "2026-01", mc: -2, note: "Opening entry." }],
  chainStart: "2026-01",
};

const pack = (reconciliation: SyriaReconciliation | undefined, country = "Syria") => ({
  meta: { country, window: { label: "Jan–Mar 2026" } },
  syriaReconciliation: reconciliation,
}) as unknown as PerformancePack;

afterEach(() => { cleanup(); localStorage.removeItem("ssof-unit"); });

describe("SyriaReconciliationSection", () => {
  it("shows a tick only for a known matching row", () => {
    render(<SyriaReconciliationSection pack={pack(baseReconciliation)} />);
    expect(screen.getByText("Ties")).toBeInTheDocument();
    expect(screen.getAllByText("Does not tie")).toHaveLength(2);
    expect(screen.getByText("Total IMS")).toBeInTheDocument();
  });

  it("lists residual explanations and exact SKU/month detail", () => {
    render(<SyriaReconciliationSection pack={pack(baseReconciliation)} />);
    expect(screen.getByText("Unexplained")).toBeInTheDocument();
    expect(screen.getAllByText("+5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grape 50g")).toHaveLength(2);
    expect(screen.getAllByText("Month:", { exact: false }).some((element) =>
      /WS Tracker month: 2026-02.*SSOF month: 2026-01/.test(element.textContent ?? ""),
    )).toBe(true);
    expect(screen.getByText(/not proof of warehouse receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/contribute nothing to the reconciliation gap/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Arrival" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Planning FG" }).every((link) => link.getAttribute("href") === "/planning-fg/50g")).toBe(true);
  });

  it("does not convert an unknown warehouse balance into zero or a tie", () => {
    const unknown = {
      ...baseReconciliation,
      lines: baseReconciliation.lines.map((line) => line.id === "warehouse"
        ? { ...line, tracker: null, ssof: null, difference: null, ties: null, missing: ["Planning FG stock missing for Feb 2026"] }
        : line),
    };
    render(<SyriaReconciliationSection pack={pack(unknown)} />);
    const warehouseRow = screen.getByRole("row", { name: /Warehouse stock/ });
    expect(warehouseRow).toHaveTextContent("Unknown");
    expect(screen.getAllByText("Not supplied").length).toBeGreaterThan(0);
    expect(screen.getByText("Planning FG stock missing for Feb 2026")).toBeInTheDocument();
    expect(warehouseRow).not.toHaveTextContent("Ties");
  });

  it.each([["KG", "−30"], ["Tons", "−0.03"]] as const)("converts negative difference in %s", (unit, expected) => {
    localStorage.setItem("ssof-unit", unit);
    const negative = {
      ...baseReconciliation,
      lines: baseReconciliation.lines.map((line) => line.id === "arrivals"
        ? { ...line, tracker: 75, ssof: 80, difference: -5 }
        : line),
    };
    render(<UnitProvider><SyriaReconciliationSection pack={pack(negative)} /></UnitProvider>);
    expect(screen.getByRole("columnheader", { name: `Difference (WS − SSOF, ${unit})` })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Inbound/ })).toHaveTextContent(expected);
    expect(screen.getByText(new RegExp(`displayed in ${unit}`))).toBeInTheDocument();
  });

  it("is eligible only for Syria", () => {
    const section = performanceSections.find((entry) => entry.id === "syriaReconciliation");
    expect(section).toBeDefined();
    expect(section?.available?.(pack(baseReconciliation, "Syria"))).toBe(true);
    expect(section?.available?.(pack(baseReconciliation, "Lebanon"))).toBe(false);
  });

  it("shows explicit unavailable state when the live field is absent", () => {
    render(<SyriaReconciliationSection pack={pack(undefined)} />);
    expect(screen.getByText("Comparison unavailable")).toBeInTheDocument();
  });
});
