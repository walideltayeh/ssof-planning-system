import type { SectionProps } from "./types";
import { EmptyState } from "./shared";

export default function FlowSection({ pack }: SectionProps) {
  return <EmptyState message={`FlowSection for ${pack.meta.country} is being built.`} />;
}
