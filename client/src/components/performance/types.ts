/** Client-side view of the Country Performance pack contract (type-only import from the server). */
export type {
  AtRiskSku,
  CommercialSection,
  CompareMode,
  CoverZone,
  DataConfidenceSection,
  Delta,
  DemandSection,
  FlowSection,
  ForecastQualitySection,
  ForwardSection,
  GapRow,
  InventorySection,
  KeyMessage,
  KpiTile,
  KpiUnit,
  PerformanceCountry,
  PerformanceFilters,
  PerformanceMeta,
  PerformancePack,
  PerformanceRequest,
  PeriodPreset,
  PeriodRef,
  ProjectionInputs,
  Rag,
  RiskItem,
  ScorecardRow,
  SparkPoint,
  SupplySection,
  WaterfallStep,
} from "../../../../server/analysis/countryPerformance.types";

export interface SectionProps {
  pack: import("../../../../server/analysis/countryPerformance.types").PerformancePack;
  /** True when rendered as a full-screen slide; components should use larger type and hide dense tables where noted. */
  presentation?: boolean;
}
