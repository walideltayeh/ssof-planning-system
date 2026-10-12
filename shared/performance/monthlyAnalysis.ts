/** Read-only planner data. Quantities remain MC; cover and indexes never convert. */
export interface MonthlyRef { year: number; month: number; label: string; key: string }
export interface MonthlyIndex { month: number; index: number | null; years: number; ramadanYears: number[]; summer: boolean }
export interface MonthlyRate {
  avg3: number; avg6: number; avg12: number; last: number; lastMonth: string | null;
  trendPct: number | null; direction: string; sampleMonths: number;
}
export interface MonthlyYoy {
  month: MonthlyRef; current: number | null; prior: number | null; growthPct: number | null;
  cumulativeCurrent: number | null; cumulativePrior: number | null; cumulativeGrowthPct: number | null;
}
export interface MonthlyComparison {
  month: MonthlyRef; forecast: number; actual: number; gap: number; gapPct: number | null;
}
export interface MonthlySuggestion {
  month: MonthlyRef; suggested: number; current: number | null; differenceMc: number | null; differencePct: number | null;
  material: boolean; availablePeriod: boolean; currentClosing: number | null; suggestedClosing: number;
  currentCover: number | null; suggestedCover: number | null; seasonalityYears: number;
}
export interface MonthlyRow {
  id: string; sku: string; weight: string; category: string; flavour: string; total: boolean;
  rates: MonthlyRate; stock: { closing: number; weeks: number | null; zone: string };
  ims: (number | null)[]; imsTotal: number;
  volatility: { months: number; mean: number; stdDev: number; cvPct: number | null; label: string };
  yoy: MonthlyYoy[]; comparison: MonthlyComparison[];
  bias: { months: number; gapPct: number | null; label: string };
  suggestions: MonthlySuggestion[];
}
export interface MonthlyAnalysis {
  country: string; asOf: string; windowLabel: string;
  gridMonths: MonthlyRef[]; selectedMonths: MonthlyRef[]; forecastMonths: MonthlyRef[];
  rows: MonthlyRow[]; totals: MonthlyRow[];
  seasonality: { group: string; months: MonthlyIndex[] }[];
  materialThresholdPct: number; notes: string[];
}
