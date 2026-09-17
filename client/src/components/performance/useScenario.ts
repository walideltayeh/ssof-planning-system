import { useMemo } from "react";
import { aggregateProjection, mcForWeeks, projectSku } from "@shared/performance/projection";
import type { GapRow, ProjectionInputs } from "./types";

export function useScenario(inputs: ProjectionInputs, multiplier: number) {
  return useMemo(() => {
    const labelMonths = (months: ReturnType<typeof aggregateProjection>) => months.map((m, i) => ({ ...m, label: inputs.months[i] ?? `Month ${i + 1}` }));
    const total = labelMonths(aggregateProjection(inputs.skus, multiplier, inputs.cover, inputs.target));
    const weights = [...new Set(inputs.skus.map((s) => s.weight))];
    const byWeight = weights.map((weight) => ({ weight, months: labelMonths(aggregateProjection(inputs.skus.filter((s) => s.weight === weight), multiplier, inputs.cover, inputs.target)) }));
    const lastIndex = Math.max(0, inputs.months.length - 1);
    const gaps: GapRow[] = inputs.skus.map((sku) => {
      const scaledDemand = sku.demand.map((v) => v * multiplier);
      const projectedClosing = projectSku(sku, multiplier, inputs.cover, inputs.target)[lastIndex]?.closing ?? sku.openingStock;
      const low = mcForWeeks(inputs.target.low, scaledDemand, lastIndex, inputs.cover);
      const high = mcForWeeks(inputs.target.high, scaledDemand, lastIndex, inputs.cover);
      const action = projectedClosing < low ? "add" : projectedClosing > high ? "cut" : "hold";
      const gapMc = action === "add" ? low - projectedClosing : action === "cut" ? -(projectedClosing - high) : 0;
      const orderIndex = Math.max(0, lastIndex - inputs.leadTimeMonths);
      return { sku: sku.sku, weight: sku.weight, horizonMonth: inputs.months[lastIndex] ?? "–", projectedClosing, targetClosing: action === "cut" ? high : low, gapMc, action, orderByMonth: orderIndex === 0 ? "now" : inputs.months[orderIndex] ?? null };
    });
    return { total, byWeight, gaps };
  }, [inputs, multiplier]);
}