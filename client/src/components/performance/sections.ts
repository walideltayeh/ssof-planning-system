import {
  CommercialSection,
  DataConfidenceSection,
  DemandSection,
  ExecutiveSummarySection,
  FlowSection,
  ForecastQualitySection,
  ForwardSection,
  InventorySection,
  ScorecardSection,
  SupplySection,
} from "./index";
import type { ComponentType } from "react";
import type { SectionProps } from "./types";

export interface PerformanceSectionDefinition {
  id: string;
  number: number;
  title: string;
  Component: ComponentType<SectionProps>;
  intlOnly?: boolean;
  minCountries?: number;
}

export const performanceSections: PerformanceSectionDefinition[] = [
  { id: "executive", number: 1, title: "Executive Summary", Component: ExecutiveSummarySection },
  { id: "flow", number: 2, title: "Supply Chain Flow", Component: FlowSection },
  { id: "demand", number: 3, title: "Demand — sell-out (IMS)", Component: DemandSection },
  { id: "supply", number: 4, title: "Supply — production, arrivals and clearance", Component: SupplySection },
  { id: "inventory", number: 5, title: "Inventory Health", Component: InventorySection },
  { id: "quality", number: 6, title: "Forecast Quality", Component: ForecastQualitySection },
  { id: "forward", number: 7, title: "Forward Look — next 6 months", Component: ForwardSection },
  { id: "commercial", number: 8, title: "Commercial Value", Component: CommercialSection },
  { id: "scorecard", number: 9, title: "Multi-country Scorecard", Component: ScorecardSection, minCountries: 2 },
  { id: "confidence", number: 10, title: "Data Confidence", Component: DataConfidenceSection },
];

export function titleForSection(section: PerformanceSectionDefinition, isIntl: boolean) {
  return section.id === "supply" && !isIntl ? "Supply — production and arrivals" : section.title;
}