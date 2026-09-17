import type { SectionProps } from "./types";
import { EmptyState } from "./shared";

export default function SupplySection({ pack }: SectionProps) {
  return <EmptyState message={`SupplySection for ${pack.meta.country} is being built.`} />;
}
