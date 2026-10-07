import { mcPrecision } from "@shared/performance/foc";
type Unit = "MC" | "KG" | "Tons";
export function fromMastercases(value: number, unit: Unit) {
  return unit === "KG" ? value * 6 : unit === "Tons" ? value * 0.006 : value;
}
export function toMastercases(value: number, unit: Unit) {
  return mcPrecision(unit === "KG" ? value / 6 : unit === "Tons" ? value / 0.006 : value);
}
export function displayValue(value: number, unit: Unit) {
  return fromMastercases(value, unit).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function exactDisplayValue(value: number, unit: Unit) {
  return fromMastercases(value, unit).toLocaleString("en-US", { maximumFractionDigits: unit === "Tons" ? 5 : unit === "KG" ? 2 : 2 });
}
