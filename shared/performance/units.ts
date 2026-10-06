export type StockUnit = "MC" | "KG" | "Tons";
export const stockUnitFactor = (unit: StockUnit) => unit === "KG" ? 6 : unit === "Tons" ? 0.006 : 1;

/** Convert explicitly labelled quantities in explanatory text, not percentages or dates. */
export function stockTextInUnit(text: string, unit: StockUnit) {
  if (unit === "MC") return text;
  return text.replace(/(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+MC\b/g, (_match, value: string) =>
    `${(Number(value.replaceAll(",", "")) * stockUnitFactor(unit)).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`,
  ).replace(/\bMC\b/g, unit);
}
