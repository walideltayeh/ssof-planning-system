import { describe, expect, it } from "vitest";
import { arrangeSections, performanceSections } from "./sections";

describe("arrangeSections", () => {
  it("keeps the default board order and numbers sections from 1 when no layout is saved", () => {
    const arranged = arrangeSections(performanceSections, null);
    expect(arranged.map((s) => s.id).slice(0, 4)).toEqual(["runningRate", "outlook", "executive", "changes"]);
    expect(arranged.map((s) => s.number)).toEqual(arranged.map((_, i) => i + 1));
    expect(arranged.every((s) => !s.hiddenFromSlides)).toBe(true);
  });

  it("applies the saved order first, appends anything missing, ignores unknown ids and marks hidden slides", () => {
    const arranged = arrangeSections(performanceSections, { order: ["executive", "ghost", "runningRate"], hidden: ["anomalies", "ghost"] });
    expect(arranged[0].id).toBe("executive");
    expect(arranged[1].id).toBe("runningRate");
    expect(arranged[2].id).toBe("outlook");
    expect(arranged).toHaveLength(performanceSections.length);
    expect(arranged.find((s) => s.id === "anomalies")?.hiddenFromSlides).toBe(true);
    expect(arranged.filter((s) => s.hiddenFromSlides)).toHaveLength(1);
  });

  it("renumbers after sections that do not apply to the pack are removed", () => {
    const withoutMarket = performanceSections.filter((s) => s.id !== "market");
    const arranged = arrangeSections(withoutMarket, { order: [], hidden: [] });
    expect(arranged.some((s) => s.id === "market")).toBe(false);
    expect(arranged[arranged.length - 1].number).toBe(withoutMarket.length);
  });
});
