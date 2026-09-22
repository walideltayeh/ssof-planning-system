import {
  AnomaliesSection,
  BoardChangesSection,
  CommercialSection,
  DataConfidenceSection,
  DemandSection,
  ExecutiveSummarySection,
  FlowSection,
  ForecastQualitySection,
  ForwardSection,
  InventorySection,
  MarketSection,
  OutlookSection,
  PortfolioSection,
  RunningRateSection,
  SupplySection,
} from "./index";
import type { ComponentType } from "react";
import type { PerformancePack, SectionProps } from "./types";

export interface PerformanceSectionDefinition {
  id: string;
  title: string;
  Component: ComponentType<SectionProps>;
  intlOnly?: boolean;
  /** Hide the section entirely when the pack has nothing for it (e.g. no competitor sheet). */
  available?: (pack: PerformancePack) => boolean;
}

/** A section with its display number, in the order the presenter chose. */
export interface OrderedSection extends PerformanceSectionDefinition {
  number: number;
  hiddenFromSlides: boolean;
}

export interface SlideLayout {
  order: string[];
  hidden: string[];
}

/** Default board order: Running Rate first, then the outlook, then the executive summary and the flow of the chain. */
export const performanceSections: PerformanceSectionDefinition[] = [
  { id: "runningRate", title: "Running Rate", Component: RunningRateSection },
  { id: "outlook", title: "Full-Year Outlook and Required Run Rate", Component: OutlookSection },
  { id: "executive", title: "Executive Summary", Component: ExecutiveSummarySection },
  { id: "changes", title: "What Changed Since the Last Board", Component: BoardChangesSection },
  { id: "flow", title: "Supply Chain Flow", Component: FlowSection },
  { id: "demand", title: "Demand — sell-out (IMS)", Component: DemandSection },
  { id: "supply", title: "Supply — production, arrivals and clearance", Component: SupplySection },
  { id: "inventory", title: "Inventory Health", Component: InventorySection },
  { id: "quality", title: "Forecast Quality", Component: ForecastQualitySection },
  { id: "portfolio", title: "SKU Portfolio Health", Component: PortfolioSection },
  { id: "market", title: "Market Context", Component: MarketSection, available: (pack) => pack.market !== null },
  { id: "forward", title: "Forward Look — next 6 months", Component: ForwardSection },
  { id: "commercial", title: "Commercial Value", Component: CommercialSection },
  { id: "anomalies", title: "Anomalies", Component: AnomaliesSection },
  { id: "confidence", title: "Data Confidence", Component: DataConfidenceSection },
];

export function titleForSection(section: PerformanceSectionDefinition, isIntl: boolean) {
  return section.id === "supply" && !isIntl ? "Supply — production and arrivals" : section.title;
}

/**
 * Applies the user's saved slide layout to the sections that apply to this pack.
 * Unknown ids in the layout are ignored; sections missing from the layout keep their default position at the end.
 */
export function arrangeSections(sections: PerformanceSectionDefinition[], layout: SlideLayout | null | undefined): OrderedSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const ordered: PerformanceSectionDefinition[] = [];
  for (const id of layout?.order ?? []) {
    const s = byId.get(id);
    if (s && !ordered.includes(s)) ordered.push(s);
  }
  for (const s of sections) if (!ordered.includes(s)) ordered.push(s);
  const hidden = new Set(layout?.hidden ?? []);
  return ordered.map((s, i) => ({ ...s, number: i + 1, hiddenFromSlides: hidden.has(s.id) }));
}
