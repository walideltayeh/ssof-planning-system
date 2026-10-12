import { describe, expect, it } from "vitest";
import { canonicalSkuLabel } from "./canonicalSkuLabel";

describe("canonical SKU identity", () => {
  it("adds weight and packaging for legacy raw SKU records", () => {
    expect(canonicalSkuLabel({ name: "Hazelnut", weight: "250g", packagingType: "Old" })).toBe("Hazelnut · 250g · Old");
  });
  it("does not repeat canonical label parts", () => {
    expect(canonicalSkuLabel({ name: "Hazelnut · 250g · New", weight: "250g", packaging: "New" })).toBe("Hazelnut · 250g · New");
  });
});
