/** Client-side view of the Country Performance pack contract (type-only import from the server). */
export type {
  AnomalySection,
  AtRiskSku,
  BoardHeadline,
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
  InventoryEfficiency,
  InventorySection,
  KeyMessage,
  KpiTile,
  KpiUnit,
  LostSales,
  MarketSection,
  OutlookSection,
  PerformanceCountry,
  PerformanceFilters,
  PerformanceMeta,
  PerformancePack,
  PerformanceRequest,
  PeriodPreset,
  PeriodRef,
  PortfolioSection,
  ProjectionInputs,
  Rag,
  RiskItem,
  RunningRateSection,
  SparkPoint,
  SupplySection,
  VolumeBridge,
  WaterfallStep,
} from "../../../../server/analysis/countryPerformance.types";

export interface SectionProps {
  pack: import("../../../../server/analysis/countryPerformance.types").PerformancePack;
  /** True when rendered as a full-screen slide; components should use larger type and hide dense tables where noted. */
  presentation?: boolean;
}
