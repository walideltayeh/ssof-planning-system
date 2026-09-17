import { describe, expect, it } from "vitest";
import { parsePerformanceExportQuery } from "./countryPerformanceExport";

describe("parsePerformanceExportQuery", () => {
  it("accepts a full query and splits comma-separated filters", () => {
    const r = parsePerformanceExportQuery({ country: "Syria", preset: "custom", from: "2026-01", to: "2026-06", compare: "ly", weights: "50g,250g", flavours: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request).toMatchObject({ country: "Syria", preset: "custom", from: "2026-01", to: "2026-06", compare: "ly" });
      expect(r.request.filters).toEqual({ weights: ["50g", "250g"], categories: undefined, packaging: undefined, flavours: undefined });
    }
  });

  it("defaults preset and compare and drops empty filters", () => {
    const r = parsePerformanceExportQuery({ country: "Lebanon" });
    expect(r).toEqual({ ok: true, request: { country: "Lebanon", preset: "ytd", compare: "plan", anchor: undefined, from: undefined, to: undefined, filters: undefined } });
  });

  it("rejects unknown countries, presets and malformed months", () => {
    expect(parsePerformanceExportQuery({ country: "France" }).ok).toBe(false);
    expect(parsePerformanceExportQuery({ country: "KSA", preset: "weekly" }).ok).toBe(false);
    expect(parsePerformanceExportQuery({ country: "KSA", anchor: "2026/05" }).ok).toBe(false);
  });
});
