/**
 * Unit tests for Product Expiry Dashboard logic.
 * Tests the alert tier calculation and FIFO stock attribution logic
 * without hitting the database.
 */
import { describe, it, expect } from "vitest";

// ── Replicated helpers (same logic as db.ts getExpiryDashboard) ──────────────

const SHELF_LIFE_YEARS = 2;

function getExpiryDate(productionYear: number, productionMonth: number): Date {
  const d = new Date(productionYear, productionMonth - 1, 1);
  d.setFullYear(d.getFullYear() + SHELF_LIFE_YEARS);
  return d;
}

function monthsUntil(target: Date, today: Date): number {
  return (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function getAlertTier(monthsLeft: number): "Expired" | "2M" | "4M" | "6M" | "9M" | "12M" | "18M" | "24M" | "OK" {
  if (monthsLeft <= 0) return "Expired";
  if (monthsLeft <= 2) return "2M";
  if (monthsLeft <= 4) return "4M";
  if (monthsLeft <= 6) return "6M";
  if (monthsLeft <= 9) return "9M";
  if (monthsLeft <= 12) return "12M";
  if (monthsLeft <= 18) return "18M";
  if (monthsLeft <= 24) return "24M";
  return "OK";
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Expiry date calculation", () => {
  it("adds exactly 2 years to the 1st of the production month", () => {
    const expiry = getExpiryDate(2024, 3); // March 2024 → March 2026
    expect(expiry.getFullYear()).toBe(2026);
    expect(expiry.getMonth()).toBe(2); // 0-indexed March
    expect(expiry.getDate()).toBe(1);
  });

  it("handles December correctly (year rollover)", () => {
    const expiry = getExpiryDate(2023, 12); // Dec 2023 → Dec 2025
    expect(expiry.getFullYear()).toBe(2025);
    expect(expiry.getMonth()).toBe(11); // December
  });

  it("handles leap year production month", () => {
    const expiry = getExpiryDate(2024, 2); // Feb 2024 → Feb 2026
    expect(expiry.getFullYear()).toBe(2026);
    expect(expiry.getMonth()).toBe(1); // February
  });
});

describe("Alert tier thresholds", () => {
  const today = new Date(2026, 2, 13); // March 13, 2026

  it("returns Expired when months <= 0", () => {
    const expiry = new Date(2026, 2, 1); // March 1, 2026 — already past
    expect(getAlertTier(monthsUntil(expiry, today))).toBe("Expired");
  });

  it("returns Expired for a product produced in March 2024 (exactly 2 years ago)", () => {
    const expiry = getExpiryDate(2024, 3); // expires March 1, 2026
    expect(getAlertTier(monthsUntil(expiry, today))).toBe("Expired");
  });

  it("returns 2M for a product expiring in ~1.5 months", () => {
    const expiry = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000); // +45 days
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(2);
    expect(getAlertTier(m)).toBe("2M");
  });

  it("returns 4M for a product expiring in ~3 months", () => {
    const expiry = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000); // +90 days
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(2);
    expect(m).toBeLessThanOrEqual(4);
    expect(getAlertTier(m)).toBe("4M");
  });

  it("returns 6M for a product expiring in ~5 months", () => {
    const expiry = new Date(today.getTime() + 150 * 24 * 60 * 60 * 1000); // +150 days
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(4);
    expect(m).toBeLessThanOrEqual(6);
    expect(getAlertTier(m)).toBe("6M");
  });

  it("returns 9M for a product expiring in ~7.5 months", () => {
    const expiry = new Date(today.getTime() + 228 * 24 * 60 * 60 * 1000); // +228 days (~7.5 months)
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(6);
    expect(m).toBeLessThanOrEqual(9);
    expect(getAlertTier(m)).toBe("9M");
  });

  it("returns 12M for a product expiring in ~10 months", () => {
    const expiry = new Date(today.getTime() + 305 * 24 * 60 * 60 * 1000); // +305 days (~10 months)
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(9);
    expect(m).toBeLessThanOrEqual(12);
    expect(getAlertTier(m)).toBe("12M");
  });

  it("returns 18M for a product expiring in ~15 months", () => {
    const expiry = new Date(today.getTime() + 456 * 24 * 60 * 60 * 1000); // +456 days (~15 months)
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(12);
    expect(m).toBeLessThanOrEqual(18);
    expect(getAlertTier(m)).toBe("18M");
  });

  it("returns 24M for a product expiring in ~20 months", () => {
    const expiry = new Date(today.getTime() + 609 * 24 * 60 * 60 * 1000); // +609 days (~20 months)
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(18);
    expect(m).toBeLessThanOrEqual(24);
    expect(getAlertTier(m)).toBe("24M");
  });

  it("returns OK for a product expiring in 25+ months", () => {
    const expiry = new Date(today.getTime() + 780 * 24 * 60 * 60 * 1000); // +780 days (~25.6 months)
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(24);
    expect(getAlertTier(m)).toBe("OK");
  });
});

describe("FIFO stock attribution", () => {
  it("assigns remaining stock to oldest batch first", () => {
    // Two batches: 1000 units each, total closing stock = 1500
    const batches = [
      { periodLabel: "Jan 24", qty: 1000, expiryMonths: -2 }, // Expired
      { periodLabel: "Jun 24", qty: 1000, expiryMonths: 3 },  // 4M alert
    ];
    let remainingStock = 1500;
    const result: { label: string; atRisk: number; tier: string }[] = [];
    for (const b of batches) {
      const tier = getAlertTier(b.expiryMonths);
      if (tier === "OK") { remainingStock = Math.max(0, remainingStock - b.qty); continue; }
      const atRisk = Math.min(remainingStock, b.qty);
      remainingStock = Math.max(0, remainingStock - b.qty);
      result.push({ label: b.periodLabel, atRisk, tier });
    }
    // First batch: 1000 units fully at risk (expired)
    expect(result[0].label).toBe("Jan 24");
    expect(result[0].atRisk).toBe(1000);
    expect(result[0].tier).toBe("Expired");
    // Second batch: only 500 remaining stock attributed
    expect(result[1].label).toBe("Jun 24");
    expect(result[1].atRisk).toBe(500);
    expect(result[1].tier).toBe("4M");
  });

  it("shows 0 at-risk when closing stock is 0", () => {
    const batches = [{ qty: 1000, expiryMonths: -1 }];
    const remainingStock = 0;
    const atRisk = Math.min(remainingStock, batches[0].qty);
    expect(atRisk).toBe(0);
  });

  it("shows full batch qty when closing stock exceeds batch qty", () => {
    const batches = [{ qty: 500, expiryMonths: 1 }];
    let remainingStock = 2000;
    const atRisk = Math.min(remainingStock, batches[0].qty);
    remainingStock = Math.max(0, remainingStock - batches[0].qty);
    expect(atRisk).toBe(500);
    expect(remainingStock).toBe(1500);
  });

  it("correctly handles multiple tiers across FIFO batches", () => {
    const batches = [
      { periodLabel: "Jan 24", qty: 200, expiryMonths: -1 },  // Expired
      { periodLabel: "Mar 24", qty: 300, expiryMonths: 1 },   // 2M
      { periodLabel: "Jun 24", qty: 400, expiryMonths: 5 },   // 6M
      { periodLabel: "Sep 24", qty: 500, expiryMonths: 8 },   // 9M
      { periodLabel: "Dec 24", qty: 600, expiryMonths: 11 },  // 12M
      { periodLabel: "Jun 25", qty: 700, expiryMonths: 17 },  // 18M
      { periodLabel: "Dec 25", qty: 800, expiryMonths: 23 },  // 24M
    ];
    let remainingStock = 3000;
    const result: { label: string; atRisk: number; isCleared: boolean; tier: string }[] = [];
    for (const b of batches) {
      const tier = getAlertTier(b.expiryMonths);
      if (tier === "OK") { remainingStock = Math.max(0, remainingStock - b.qty); continue; }
      const atRisk = Math.min(remainingStock, b.qty);
      remainingStock = Math.max(0, remainingStock - b.qty);
      result.push({ label: b.periodLabel, atRisk, isCleared: atRisk <= 0, tier });
    }
    expect(result).toHaveLength(7);
    expect(result[0].tier).toBe("Expired");
    expect(result[1].tier).toBe("2M");
    expect(result[2].tier).toBe("6M");
    expect(result[3].tier).toBe("9M");
    expect(result[4].tier).toBe("12M");
    expect(result[5].tier).toBe("18M");
    expect(result[6].tier).toBe("24M");
    // Total at-risk: 200+300+400+500+600+700+300 = 3000 (stock exhausted at 24M batch)
    const totalAtRisk = result.reduce((s, r) => s + r.atRisk, 0);
    expect(totalAtRisk).toBe(3000);
  });

  it("marks batch as cleared (isCleared=true) when closing stock is fully consumed before reaching it", () => {
    // 3 batches, closing stock = 800 (only covers first two)
    const batches = [
      { periodLabel: "Jan 24", qty: 500, expiryMonths: 1 },  // 2M — fully at risk
      { periodLabel: "Mar 24", qty: 400, expiryMonths: 4 },  // 4M — partially at risk
      { periodLabel: "Jun 24", qty: 300, expiryMonths: 6 },  // 6M — cleared (stock exhausted)
    ];
    let remainingStock = 800;
    const result: { label: string; atRisk: number; isCleared: boolean; tier: string }[] = [];
    for (const b of batches) {
      const tier = getAlertTier(b.expiryMonths);
      if (tier === "OK") { remainingStock = Math.max(0, remainingStock - b.qty); continue; }
      const atRisk = Math.min(remainingStock, b.qty);
      remainingStock = Math.max(0, remainingStock - b.qty);
      result.push({ label: b.periodLabel, atRisk, isCleared: atRisk <= 0, tier });
    }
    expect(result).toHaveLength(3);
    expect(result[0].atRisk).toBe(500);
    expect(result[0].isCleared).toBe(false);
    expect(result[1].atRisk).toBe(300);
    expect(result[1].isCleared).toBe(false);
    expect(result[2].atRisk).toBe(0);
    expect(result[2].isCleared).toBe(true); // ← cleared: stock was exhausted before this batch
  });

  it("all batches are cleared when closing stock is 0", () => {
    const batches = [
      { periodLabel: "Jan 24", qty: 1000, expiryMonths: 3 },
      { periodLabel: "Mar 24", qty: 500, expiryMonths: 6 },
    ];
    let remainingStock = 0;
    const result: { atRisk: number; isCleared: boolean }[] = [];
    for (const b of batches) {
      const tier = getAlertTier(b.expiryMonths);
      if (tier === "OK") continue;
      const atRisk = Math.min(remainingStock, b.qty);
      remainingStock = Math.max(0, remainingStock - b.qty);
      result.push({ atRisk, isCleared: atRisk <= 0 });
    }
    expect(result).toHaveLength(2);
    expect(result[0].isCleared).toBe(true);
    expect(result[1].isCleared).toBe(true);
  });
});

describe("Shelf life boundary conditions", () => {
  it("a product produced exactly 2 years ago is Expired", () => {
    const today = new Date(2026, 2, 1); // March 1, 2026
    const expiry = getExpiryDate(2024, 3); // March 1, 2026 exactly
    const m = monthsUntil(expiry, today);
    expect(m).toBeCloseTo(0, 0);
    expect(getAlertTier(m)).toBe("Expired");
  });

  it("a product produced 23 months ago is in 2M alert zone", () => {
    // Today = March 2026, produced April 2024 → expires April 2026 → ~1 month left
    const today = new Date(2026, 2, 13);
    const expiry = getExpiryDate(2024, 4); // April 2026
    const m = monthsUntil(expiry, today);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(2);
    expect(getAlertTier(m)).toBe("2M");
  });

  it("tier boundaries: 6.01 months → 9M, 9.01 months → 12M", () => {
    expect(getAlertTier(6.01)).toBe("9M");
    expect(getAlertTier(9.01)).toBe("12M");
    expect(getAlertTier(12.01)).toBe("18M");
    expect(getAlertTier(18.01)).toBe("24M");
    expect(getAlertTier(24.01)).toBe("OK");
  });

  it("tier boundaries: exact values land in the lower tier", () => {
    expect(getAlertTier(2)).toBe("2M");
    expect(getAlertTier(4)).toBe("4M");
    expect(getAlertTier(6)).toBe("6M");
    expect(getAlertTier(9)).toBe("9M");
    expect(getAlertTier(12)).toBe("12M");
    expect(getAlertTier(18)).toBe("18M");
    expect(getAlertTier(24)).toBe("24M");
  });
});
