/**
 * Country Performance pack — shared contract between the server aggregator
 * (server/analysis/countryPerformance.ts), the Excel exporter and the client
 * page (client/src/pages/CountryPerformancePage.tsx).
 *
 * All quantities are in MC (master cases). The client converts to KG / Tons
 * through UnitContext. Money values are USD at `skus.priceToWs` (our selling
 * price to wholesale, $/MC) and are only computed for SKUs with a price set.
 */

export type PerformanceCountry = "Lebanon" | "Syria" | "Libya" | "KSA";
export type PeriodPreset = "month" | "qtd" | "ytd" | "l12m" | "custom";
export type CompareMode = "plan" | "ly" | "prev";
export type Rag = "green" | "amber" | "red" | "grey";

export interface PerformanceFilters {
  weights?: string[];
  categories?: string[];
  packaging?: string[];
  flavours?: string[];
}

export interface PerformanceRequest {
  country: PerformanceCountry;
  preset: PeriodPreset;
  /** Anchor month "YYYY-MM" for month/qtd/ytd/l12m. Defaults to the latest month with actual IMS. */
  anchor?: string;
  /** Custom range bounds "YYYY-MM" (inclusive). Only used when preset = custom. */
  from?: string;
  to?: string;
  compare: CompareMode;
  filters?: PerformanceFilters;
}

export interface PeriodRef {
  id: number;
  year: number;
  month: number;
  /** Full label as stored on the period row, e.g. "May 2026". */
  label: string;
  /** Short label for chart axes, e.g. "May'26". */
  short: string;
}

export interface Delta {
  /** Reference value (plan / last year / previous period) summed over the window. */
  reference: number | null;
  /** value − reference */
  delta: number | null;
  /** (value − reference) / |reference| × 100 */
  pct: number | null;
  /** Empty-state message when reference is unavailable, e.g. "No prior year data". */
  note?: string;
}

export interface SparkPoint {
  label: string;
  value: number | null;
}

export type KpiUnit = "MC" | "pct" | "weeks" | "count" | "usd" | "days";

export interface KpiTile {
  key: string;
  /** Plain-English tile title, e.g. "Sell-out (IMS)". */
  label: string;
  /** The business question the tile answers. */
  question: string;
  value: number | null;
  unit: KpiUnit;
  vsPlan: Delta | null;
  vsLastYear: Delta | null;
  vsPrevious: Delta | null;
  status: Rag;
  statusReason: string;
  /** 12 monthly points ending at the window end. */
  sparkline: SparkPoint[];
  /** Secondary reading shown under the value, e.g. "5.2 weeks of cover". */
  subValue?: string;
  note?: string;
}

export interface KeyMessage {
  rank: number;
  tone: "positive" | "warning" | "negative" | "neutral";
  headline: string;
  detail: string;
  /** MC magnitude used to rank the message (absolute). */
  impactMc: number;
}

export interface RiskItem {
  rank: number;
  sku: string;
  weight: string;
  issue: string;
  impactMc: number;
  action: string;
  severity: Rag;
}

export interface WaterfallStep {
  key: string;
  label: string;
  /** Absolute level after this step (for totals) or the signed movement (for deltas). */
  value: number;
  kind: "total" | "delta";
  /** Gap versus the previous total, in MC and % (null for totals / first step). */
  gapMc: number | null;
  gapPct: number | null;
  note?: string;
}

export interface PipelineStage {
  key: string;
  label: string;
  mc: number | null;
  weeksOfCover: number | null;
  note?: string;
}

export interface LeadTimeStat {
  label: string;
  avgDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  sampleSize: number;
  trend: SparkPoint[];
  note?: string;
}

export interface DelayedBatch {
  sku: string;
  weight: string;
  productionPeriod: string;
  producedMc: number;
  clearedMc: number;
  pendingMc: number;
  expectedArrival: string | null;
  daysLate: number | null;
  status: string;
  invoiceRef: string | null;
  containerRef: string | null;
  note: string | null;
}

export interface FlowSection {
  /** Two bridges: supply (plan → produced → cleared → pipeline) and stock (opening → closing). */
  waterfall: { supply: WaterfallStep[]; stock: WaterfallStep[] };
  pipeline: PipelineStage[];
  leadTimes: LeadTimeStat[];
  delayedBatches: DelayedBatch[];
  notes: string[];
}

export interface DemandMonth {
  label: string;
  ims: number | null;
  plan: number;
  lastYear: number | null;
  runningRate3: number | null;
  runningRate6: number | null;
  /** true when the IMS value is auto-filled from forecast (excluded from accuracy). */
  autoFilled: boolean;
  isActual: boolean;
}

export interface YoyMonth {
  label: string;
  current: number | null;
  lastYear: number | null;
  growthPct: number | null;
  cumulativeCurrent: number | null;
  cumulativeLastYear: number | null;
  cumulativeGrowthPct: number | null;
}

export interface SeasonalityPoint {
  month: number;
  label: string;
  index: number | null;
  yearsUsed: number;
  tag: "Ramadan" | "Summer" | null;
}

export interface MixRow {
  group: string;
  mc: number;
  sharePct: number;
  lastYearSharePct: number | null;
  shiftPts: number | null;
}

export interface MixDimension {
  dimension: "weight" | "category" | "packaging" | "flavour";
  title: string;
  rows: MixRow[];
}

export interface ParetoRow {
  sku: string;
  weight: string;
  mc: number;
  sharePct: number;
  cumulativePct: number;
  inTop80: boolean;
}

export interface Mover {
  sku: string;
  weight: string;
  current: number;
  reference: number;
  deltaMc: number;
  deltaPct: number | null;
}

export interface NpiRampRow {
  sku: string;
  weight: string;
  launchMonth: string | null;
  monthsSinceLaunch: number;
  ramp: SparkPoint[];
  totalMc: number;
}

export interface DemandSection {
  monthly: DemandMonth[];
  yoy: YoyMonth[];
  seasonality: SeasonalityPoint[];
  mix: MixDimension[];
  pareto: ParetoRow[];
  growers: Mover[];
  decliners: Mover[];
  moversBasis: "ly" | "prev";
  npi: { coreSharePct: number | null; npiSharePct: number | null; byMonth: { label: string; corePct: number | null; npiPct: number | null }[]; ramps: NpiRampRow[] };
  notes: string[];
}

export interface AttainmentMonth {
  label: string;
  plan: number;
  actual: number;
  attainmentPct: number | null;
  cumulativePlan: number;
  cumulativeActual: number;
}

export interface CumulativePoint {
  label: string;
  cumulativeProduction: number;
  cumulativeIms: number;
  gap: number;
}

export interface ArrivalsMonth {
  label: string;
  planned: number;
  actual: number;
  variance: number;
}

export interface BatchStatusCount {
  status: string;
  batches: number;
  mc: number;
}

export interface ClearanceSummary {
  clearedMc: number;
  pendingMc: number;
  clearanceRatePct: number | null;
  batchStatus: BatchStatusCount[];
  oldestPending: { sku: string; productionPeriod: string; pendingMc: number; daysWaiting: number | null } | null;
  avgDaysToClear: number | null;
  medianDaysToClear: number | null;
}

export interface SupplySection {
  attainment: AttainmentMonth[];
  cumulative: CumulativePoint[];
  arrivals: ArrivalsMonth[];
  onTimePct: number | null;
  onTimeNote: string;
  clearance: ClearanceSummary | null;
  notes: string[];
}

export type CoverZone = "Out of Stock" | "Negative" | "Critical" | "Healthy" | "Overstock";

export interface SkuCover {
  skuId: number;
  sku: string;
  weight: string;
  category: string;
  closingStock: number;
  weeks: number | null;
  zone: CoverZone;
  monthlyDemand: number;
}

export interface HeatmapRow {
  sku: string;
  weight: string;
  cells: { label: string; weeks: number | null; zone: CoverZone; closing: number }[];
}

export interface AtRiskSku {
  sku: string;
  weight: string;
  closingStock: number;
  weeks: number | null;
  projectedStockoutMonth: string | null;
  projectedStockoutDate: string | null;
  nextArrival: { month: string; mc: number } | null;
  shortfallMc: number;
}

export interface OverstockSku {
  sku: string;
  weight: string;
  closingStock: number;
  weeks: number | null;
  excessMc: number;
  monthsToSell: number | null;
  monthlyDemand: number;
}

export interface ExpiryRiskRow {
  sku: string;
  weight: string;
  productionPeriod: string;
  expiryDate: string;
  remainingMc: number;
  monthsUntilExpiry: number;
  atRiskMc: number;
}

export interface StockValue {
  valueUsd: number | null;
  pricedMc: number;
  unpricedMc: number;
  pricedSharePct: number | null;
  skusMissingPrice: string[];
}

export interface InventorySection {
  targetWeeks: { low: number; high: number };
  coverFormula: string;
  cover: SkuCover[];
  zoneCounts: { zone: CoverZone; count: number }[];
  heatmap: { months: string[]; rows: HeatmapRow[] };
  atRisk: AtRiskSku[];
  overstock: OverstockSku[];
  expiryRisk: { rows: ExpiryRiskRow[]; totalAtRiskMc: number } | null;
  stockValue: StockValue;
  notes: string[];
}

export interface AccuracyPoint {
  label: string;
  forecast: number;
  actual: number;
  accuracyPct: number | null;
  biasPct: number | null;
  skusMeasured: number;
}

export interface AccuracyGroup {
  group: string;
  weight?: string;
  forecast: number;
  actual: number;
  accuracyPct: number | null;
  biasPct: number | null;
  monthsMeasured: number;
}

export interface ChronicSku {
  sku: string;
  weight: string;
  direction: "over" | "under";
  consecutiveMonths: number;
  avgBiasPct: number;
}

export interface ForecastQualitySection {
  overallAccuracyPct: number | null;
  overallBiasPct: number | null;
  byMonth: AccuracyPoint[];
  byWeight: AccuracyGroup[];
  bySku: AccuracyGroup[];
  chronic: ChronicSku[];
  excludedAutoFilledMonths: number;
  method: string;
  notes: string[];
}

/** One SKU's projection inputs — enough for the client to replay the projection with a demand multiplier. */
export interface ProjectionSkuInput {
  skuId: number;
  sku: string;
  weight: string;
  openingStock: number;
  /** Per horizon month: planned demand (IMS if entered, else forecast). */
  demand: number[];
  /** Per horizon month: planned arrivals landing in that month. */
  arrivals: number[];
  /** Per horizon month: planned production (for order-timing hints). */
  production: number[];
}

export interface ProjectionInputs {
  months: string[];
  /** Cover formula parameters, mirrors the country's Planning FG rule. */
  cover: { mode: "sameMonth" | "nextTwoAvg"; factor: number };
  target: { low: number; high: number };
  leadTimeMonths: number;
  leadTimeNote: string;
  skus: ProjectionSkuInput[];
}

export interface ForwardMonth {
  label: string;
  demand: number;
  arrivals: number;
  closing: number;
  weeks: number | null;
  targetLowMc: number;
  targetHighMc: number;
}

export interface ForwardWeight {
  weight: string;
  months: ForwardMonth[];
}

export interface GapRow {
  sku: string;
  weight: string;
  horizonMonth: string;
  projectedClosing: number;
  targetClosing: number;
  gapMc: number;
  action: "add" | "cut" | "hold";
  orderByMonth: string | null;
}

export interface ForwardSection {
  horizonMonths: string[];
  total: ForwardMonth[];
  byWeight: ForwardWeight[];
  gaps: GapRow[];
  inputs: ProjectionInputs;
  notes: string[];
}

export interface CommercialRow {
  group: string;
  selloutUsd: number | null;
  selloutLyUsd: number | null;
  selloutGrowthPct: number | null;
  stockUsd: number | null;
  pricedSharePct: number | null;
}

export interface CommercialSection {
  hasPrices: boolean;
  selloutUsd: number | null;
  selloutLyUsd: number | null;
  stockUsd: number | null;
  pricedVolumeSharePct: number | null;
  byWeight: CommercialRow[];
  byCategory: CommercialRow[];
  skusMissingPrice: string[];
  notes: string[];
}

export interface ConfidenceIssue {
  severity: Rag;
  title: string;
  detail: string;
  count: number;
}

export interface SheetFreshness {
  sheet: string;
  lastUpdated: string | null;
}

export interface ReconciliationRow {
  sku: string;
  weight: string;
  packClosing: number;
  planningFgClosing: number;
  difference: number;
}

export interface DataConfidenceSection {
  score: number;
  grade: "High" | "Medium" | "Low";
  issues: ConfidenceIssue[];
  missingImsMonths: { sku: string; weight: string; months: string[] }[];
  skusWithoutForecast: { sku: string; weight: string }[];
  autoFilledImsMonths: number;
  skusMissingPrice: string[];
  freshness: SheetFreshness[];
  reconciliation: { month: string | null; ok: boolean; checkedSkus: number; mismatches: ReconciliationRow[]; note: string };
}

export interface PerformanceMeta {
  country: PerformanceCountry;
  isIntl: boolean;
  generatedAt: string;
  dataAsOf: string | null;
  preset: PeriodPreset;
  compare: CompareMode;
  filters: PerformanceFilters;
  window: { from: PeriodRef; to: PeriodRef; months: PeriodRef[]; label: string };
  /** Months used for trend charts: the window when it spans 6+ months, else the last 12 months ending at the window end. */
  chartWindow: { from: PeriodRef; to: PeriodRef; months: PeriodRef[]; label: string };
  compareLabel: string;
  lastYearAvailable: boolean;
  previousAvailable: boolean;
  latestActualImsPeriod: PeriodRef | null;
  currentPeriod: PeriodRef | null;
  availablePeriods: PeriodRef[];
  filterOptions: { weights: string[]; categories: string[]; packaging: string[]; flavours: string[] };
  skuCount: number;
  activeSkuCountUnfiltered: number;
}

export interface PerformancePack {
  meta: PerformanceMeta;
  executive: { tiles: KpiTile[]; keyMessages: KeyMessage[]; risks: RiskItem[] };
  flow: FlowSection;
  demand: DemandSection;
  supply: SupplySection;
  inventory: InventorySection;
  forecastQuality: ForecastQualitySection;
  forward: ForwardSection;
  commercial: CommercialSection;
  confidence: DataConfidenceSection;
}

export interface ScorecardRow {
  country: PerformanceCountry;
  windowLabel: string;
  imsMc: number | null;
  imsVsPlanPct: number | null;
  imsVsLyPct: number | null;
  productionMc: number | null;
  planAttainmentPct: number | null;
  closingStockMc: number | null;
  weeksOfCover: number | null;
  forecastAccuracyPct: number | null;
  stockoutRiskSkus: number;
  overstockSkus: number;
  pendingClearanceMc: number | null;
  expiryRiskMc: number | null;
  confidenceScore: number;
  status: Rag;
}
