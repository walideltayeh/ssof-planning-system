import express from "express";
import request from "supertest";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(),
  getAppUserByUsername: vi.fn() }));
vi.mock("./excelImport", () => ({ handleImportSheet: vi.fn(async () => ({ updated: 1, skipped: [], sheet: "Forecast Production" })) }));
const { registerSpreadsheetUploadRoutes } = await import("./_core/spreadsheetUploadRoutes");
const { sdk } = await import("./_core/sdk");
const db = await import("./db");
const { handleImportSheet } = await import("./excelImport");
const app = express(); registerSpreadsheetUploadRoutes(app);
const wb = new ExcelJS.Workbook(); wb.addWorksheet("Forecast Production");
const buffer = Buffer.from(await wb.xlsx.writeBuffer());
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sdk.authenticateRequest).mockResolvedValue({ id: 1, name: "Trusted admin", role: "admin" } as any);
  vi.mocked(db.getAppUserByUsername).mockResolvedValue({
    username: "Trusted admin", countries: '["Libya","Syria"]', role: "admin", isOwner: false,
    countryRoles: '{"Libya":"admin","Syria":"viewer"}',
  } as any);
});
describe("country-specific forecast import authorization", () => {
  it("allows an admin in Libya and forwards only the trusted session actor", async () => {
    const res = await request(app).post("/api/import-sheet?sheet=forecast&country=Libya&username=spoofed").attach("file", buffer, "forecast.xlsx");
    expect(res.status).toBe(200);
    expect(handleImportSheet).toHaveBeenCalledWith(expect.any(Buffer), "forecast", "Libya", "Trusted admin");
  });
  it("denies that same user where they are a viewer", async () => {
    const res = await request(app).post("/api/import-sheet?sheet=forecast&country=Syria").attach("file", buffer, "forecast.xlsx");
    expect(res.status).toBe(403); expect(handleImportSheet).not.toHaveBeenCalled();
  });
  it("denies a global admin without access to the requested country", async () => {
    vi.mocked(db.getAppUserByUsername).mockResolvedValue({ countries: '["Lebanon"]', role: "admin", isOwner: false } as any);
    const res = await request(app).post("/api/import-sheet?sheet=forecast&country=Libya").attach("file", buffer, "forecast.xlsx");
    expect(res.status).toBe(403); expect(handleImportSheet).not.toHaveBeenCalled();
  });
  it("denies unauthenticated callers", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("No session"));
    const res = await request(app).post("/api/import-sheet?sheet=forecast&country=Libya").attach("file", buffer, "forecast.xlsx");
    expect(res.status).toBe(401); expect(handleImportSheet).not.toHaveBeenCalled();
  });
});
