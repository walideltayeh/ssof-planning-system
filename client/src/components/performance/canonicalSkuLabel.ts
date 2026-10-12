type SkuIdentity = {
  name?: unknown;
  sku?: unknown;
  flavour?: unknown;
  weight?: unknown;
  packaging?: unknown;
  packagingType?: unknown;
};

/** Client-safe canonical identity for legacy raw SKU rows and current API labels. */
export function canonicalSkuLabel(record: SkuIdentity): string {
  const rawName = String(record.flavour ?? record.name ?? record.sku ?? "SKU").trim();
  const weight = record.weight == null ? "" : String(record.weight).trim();
  const packaging = String(record.packaging ?? record.packagingType ?? "").trim();
  let label = rawName || "SKU";
  if (weight && !label.toLowerCase().includes(weight.toLowerCase())) label += ` · ${weight}`;
  if (packaging && !new RegExp(`(?:^|[·\\s])${packaging.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[·\\s])`, "i").test(label)) {
    label += ` · ${packaging}`;
  }
  return label;
}
