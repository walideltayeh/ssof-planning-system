import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PerformancePack } from "./types";
import FocSection from "./FocSection";
import { performanceSections } from "./sections";

afterEach(cleanup);

const createPack = (foc?: PerformancePack["foc"], country = "Libya") => ({
  meta: { country, window: { label: "Jan–Feb 2026" } },
  foc,
}) as unknown as PerformancePack;

describe("FocSection", () => {
  it("shows entered subtotals separately and never replaces missing aggregate with zero", () => {
    render(<FocSection pack={createPack({
      includeFoc: true,
      basisLabel: "Including entered FOC — FOC incomplete",
      note: "Planned free quantities only.",
      months: [
        { periodId: 1, label: "Jan 2026", ordered: 100, foc: null, enteredFoc: 0, physical: null, knownPhysical: 100, percent: null, missing: 1 },
      ],
      skus: [
        { skuId: 10, label: "Mint", weight: "50g", packaging: "New", ordered: 0, foc: 0, enteredFoc: 0, physical: 0, knownPhysical: 0, percent: 0, missing: 0 },
      ],
      total: { label: "Total", ordered: 100, foc: null, enteredFoc: 0, physical: null, knownPhysical: 100, percent: null, missing: 1 },
    })} />);
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
    expect(screen.getByText(/0 entered · 1 missing/)).toBeInTheDocument();
    expect(screen.getByText(/0 entered · 0%/)).toBeInTheDocument();
    expect(screen.getByText(/planned FOC is included/)).toBeInTheDocument();
    expect(screen.getByText(/not warehouse receipts/i)).toBeInTheDocument();
  });

  it("makes the missing FOC data layer explicit when the aggregate is absent", () => {
    render(<FocSection pack={createPack(undefined, "Syria")} />);
    expect(screen.getByText("FOC data layer is not available in this analysis pack.")).toBeInTheDocument();
    expect(screen.getByText(/No aggregate has been inferred/)).toBeInTheDocument();
  });

  it("does not present entered-only planned or awaiting subtotals as complete when receipt cells are missing", () => {
    render(<FocSection pack={createPack({
      includeFoc: false,
      basisLabel: "Ordered volume only — excluding FOC",
      note: "Received free quantities are excluded from stock.",
      months: [],
      skus: [],
      total: { label: "Total", ordered: 1, foc: 1, enteredFoc: 1, physical: 1, knownPhysical: 1, percent: 100, missing: 0 },
      receipts: {
        entries: [], warnings: [],
        months: [{
          periodId: 1, label: "Jan 2026", planned: 8, received: 2, receivedForPlan: 0,
          awaiting: 3, excluded: 2, reviewPending: 1, receivedPercent: null, missing: 2,
        }],
        skus: [],
        total: {
          label: "Total", planned: 8, received: 2, receivedForPlan: 0, awaiting: 3,
          excluded: 2, reviewPending: 1, receivedPercent: null, missing: 2,
        },
      } as any,
    })} />);
    const monthRow = screen.getByRole("row", { name: /Jan 2026/ });
    expect(within(monthRow).getAllByText(/Not set · 8 entered/)).toHaveLength(1);
    expect(within(monthRow).getAllByText(/Not set · 3 awaiting from entered cells/)).toHaveLength(1);
    expect(within(monthRow).getAllByText("2")).toHaveLength(3);
    expect(within(monthRow).getAllByText("Not set")).toHaveLength(1);
  });

  it("registers the analysis section only for Libya and Syria", () => {
    const section = performanceSections.find((item) => item.id === "foc");
    expect(section?.available?.({ meta: { country: "Libya" } } as never)).toBe(true);
    expect(section?.available?.({ meta: { country: "Syria" } } as never)).toBe(true);
    expect(section?.available?.({ meta: { country: "KSA" } } as never)).toBe(false);
    expect(section?.available?.({ meta: { country: "Lebanon" } } as never)).toBe(false);
  });
});
