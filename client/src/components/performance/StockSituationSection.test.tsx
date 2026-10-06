import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import StockSituationSection from "./StockSituationSection";
import type { PerformancePack } from "./types";

const pack = {
  meta: { country: "Syria", window: { label: "Aug 2026" } },
  stockSituation: {
    rows: [{ skuId: 1, sku: "Grape", weight: "50g", packaging: "New", production: 1200, arrival: 800, remainingStock: -50 }],
    totals: { production: 1200, arrival: 800, remainingStock: -50 },
  },
} as unknown as PerformancePack;

afterEach(cleanup);

describe("StockSituationSection", () => {
  it("shows SKU identity, the three MC columns, totals and negative stock", () => {
    render(<StockSituationSection pack={pack} />);
    expect(screen.getByRole("table", { name: "Stock situation by SKU for Syria" })).toBeInTheDocument();
    expect(screen.getByText("Grape")).toBeInTheDocument();
    expect(screen.getByText("50g · New")).toBeInTheDocument();
    for (const label of ["Production", "Arrival", "Remaining stock"]) {
      expect(screen.getByRole("columnheader", { name: `${label} (MC)` })).toBeInTheDocument();
    }
    expect(screen.getAllByText("1,200")).toHaveLength(2);
    expect(screen.getAllByText("800")).toHaveLength(2);
    expect(screen.getAllByText("-50")).toHaveLength(2);
    expect(screen.getByRole("rowheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.queryByText("Lebanon")).not.toBeInTheDocument();
  });

  it("handles an empty filtered pack in presentation mode", () => {
    render(<StockSituationSection pack={{ ...pack, stockSituation: { rows: [], totals: { production: 0, arrival: 0, remainingStock: 0 } } }} presentation />);
    expect(screen.getByText("No stock situation data for the selected country and period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
