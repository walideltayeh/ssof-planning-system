import type { SectionProps } from "./types";
import { EmptyState } from "./shared";

export default function InventorySection({ pack }: SectionProps) {
  return <EmptyState message={`InventorySection for ${pack.meta.country} is being built.`} />;
}
