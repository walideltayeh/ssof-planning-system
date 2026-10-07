import { describe, expect, it } from "vitest";
import { buildIntlMenu, buildLebanonMenu } from "./DashboardLayout";

const originalIntlPaths = [
  "/", "/forecast", "/forecast-production-vs-actual", "/shipment", "/arrival",
  "/intl-ims", "/intl-planning-fg/50g", "/intl-planning-fg/250g",
  "/intl-analysis", "/competitor-analysis", "/forecast-split", "/trade-offers",
  "/expiry-dashboard", "/data-versions", "/sku-management", "/add-year",
  "/user-management", "/audit-trail",
];

describe("FOC Record sidebar placement", () => {
  it.each(["Libya", "Syria"] as const)("is immediately after Forecast Production in %s without reordering other items", country => {
    const menu = buildIntlMenu(["50g", "250g"], country);
    expect(menu.map(item => item.path)).toEqual([
      "/", "/forecast", "/foc", ...originalIntlPaths.slice(2),
    ]);
    expect(menu[2]).toEqual({ label: "FOC Record", path: "/foc", adminOnly: false });
    expect(menu.filter(item => item.path !== "/foc").map(item => item.path)).toEqual(originalIntlPaths);
  });

  it("leaves KSA's menu unchanged and does not show FOC Record", () => {
    expect(buildIntlMenu(["50g", "250g"], "KSA").map(item => item.path)).toEqual(originalIntlPaths);
  });

  it("does not show FOC Record in Lebanon", () => {
    expect(buildLebanonMenu(["50g", "250g"]).some(item => item.path === "/foc")).toBe(false);
  });
});
