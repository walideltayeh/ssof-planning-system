import { describe, it, expect } from "vitest";
import { weightGrams, packsPerMc, tierPricesOf, hasAnyTierPrice } from "./packUnits";

describe("weightGrams", () => {
  it("parses g and kg weights", () => {
    expect(weightGrams("50g")).toBe(50);
    expect(weightGrams("250g")).toBe(250);
    expect(weightGrams("1kg")).toBe(1000);
    expect(weightGrams("1.5kg")).toBe(1500);
  });
  it("returns null for unparseable weights", () => {
    expect(weightGrams("")).toBeNull();
    expect(weightGrams("large")).toBeNull();
  });
});

describe("packsPerMc", () => {
  it("converts standard formats (1 MC = 6 KG)", () => {
    expect(packsPerMc("50g")).toEqual({ count: 120, unit: "packs" });
    expect(packsPerMc("250g")).toEqual({ count: 24, unit: "pieces" });
    expect(packsPerMc("1kg")).toEqual({ count: 6, unit: "pieces" });
  });
  it("returns null when the weight can't be parsed", () => {
    expect(packsPerMc("???")).toBeNull();
  });
});

describe("tierPricesOf", () => {
  it("parses numeric-column strings from the server", () => {
    const tp = tierPricesOf({
      priceToWs: "127.00",
      priceWsToSemiWs: "138.50",
      priceSemiWsToRetail: null,
      finalRspPerPack: "1.75",
    });
    expect(tp).toEqual({ toWs: 127, wsToSemiWs: 138.5, semiWsToRetail: null, rspPerPack: 1.75 });
    expect(hasAnyTierPrice(tp)).toBe(true);
  });
  it("treats missing / empty / negative values as not set", () => {
    const tp = tierPricesOf({ priceToWs: "", priceWsToSemiWs: "-5", priceSemiWsToRetail: undefined, finalRspPerPack: "abc" });
    expect(tp).toEqual({ toWs: null, wsToSemiWs: null, semiWsToRetail: null, rspPerPack: null });
    expect(hasAnyTierPrice(tp)).toBe(false);
  });
  it("is safe on rows without the price columns at all", () => {
    expect(hasAnyTierPrice(tierPricesOf({}))).toBe(false);
  });
});
