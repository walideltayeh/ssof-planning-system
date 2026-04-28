import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import ExcelJS from "exceljs";
import type { User } from "../drizzle/schema";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
//
// These tests cover the `/api/import-sheet` and `/api/import-competitor`
// HTTP endpoints. Task #13 made them require a valid session cookie and
// derive the audit username from that session — never from the
// browser-supplied `?username=` query string. We lock in two guarantees:
//
//   1. Anonymous (unauthenticated) requests get HTTP 401 and never reach
//      the downstream handlers (`handleImportSheet` / `upsertCompetitorData`).
//   2. Authenticated requests succeed and the username forwarded to the
//      downstream handler comes from the verified session, even when the
//      caller appends a different `?username=` value.

// `sdk.authenticateRequest(req)` is the single hook through which the route
// learns who the caller is. Throwing simulates an unauthenticated request;
// returning a User mirrors a successful session lookup.
vi.mock("./_core/sdk", () => {
  return {
    sdk: {
      authenticateRequest: vi.fn(),
    },
  };
});

// Downstream consumer for the `/api/import-sheet` endpoint. Stubbed so the
// route's success path resolves regardless of the uploaded buffer's
// contents — what we care about is the username it gets called with.
vi.mock("./excelImport", () => {
  return {
    handleImportSheet: vi.fn(async () => ({
      updated: 0,
      skipped: [],
      sheet: "forecast",
    })),
  };
});

// Downstream consumer for the `/api/import-competitor` endpoint. Same idea:
// stubbed so we can assert the `uploadedBy` argument independently of any
// real database.
vi.mock("./db", () => {
  return {
    upsertCompetitorData: vi.fn(async () => undefined),
  };
});

// Import AFTER vi.mock so the route module picks up the mocked sdk/db helpers.
const { registerSpreadsheetUploadRoutes } = await import(
  "./_core/spreadsheetUploadRoutes"
);
const { sdk } = await import("./_core/sdk");
const { handleImportSheet } = await import("./excelImport");
const dbModule = await import("./db");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerSpreadsheetUploadRoutes(app);
  return app;
}

function sessionUser(name: string): User {
  return {
    id: 1,
    openId: "session-openid",
    email: "session@example.com",
    name,
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

// Minimal but valid .xlsx buffer for `/api/import-sheet`. The downstream
// `handleImportSheet` is mocked, so the only requirement is that multer
// receives some non-empty file content.
async function buildEmptyXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Forecast");
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

// Builds an .xlsx with the two sheets `/api/import-competitor` parses
// (`Brand Monthly Sales` and `Brand Flavor Annual`) populated with one row
// each. The route reads these and forwards the parsed payload along with
// the username to `db.upsertCompetitorData`.
async function buildCompetitorXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet("Brand Monthly Sales");
  ws1.addRow(["Brand", "Year", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  ws1.addRow(["Al Fakher", 2026, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const ws2 = wb.addWorksheet("Brand Flavor Annual");
  ws2.addRow(["Brand", "Flavor", 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  ws2.addRow(["Al Fakher", "Two Apple", 1, 2, 3, 4, 5, 6, 7]);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

const authMock = vi.mocked(sdk.authenticateRequest);
const handleImportSheetMock = vi.mocked(handleImportSheet);
const upsertCompetitorMock = vi.mocked(dbModule.upsertCompetitorData);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spreadsheet upload endpoints", () => {
  // ---------- /api/import-sheet ----------
  describe("POST /api/import-sheet", () => {
    it("rejects anonymous callers with 401 and never reaches handleImportSheet", async () => {
      authMock.mockRejectedValueOnce(new Error("no session"));
      const app = buildApp();
      const xlsx = await buildEmptyXlsxBuffer();

      const res = await request(app)
        .post("/api/import-sheet?sheet=forecast&country=Lebanon&username=spoofed")
        .attach("file", xlsx, "forecast.xlsx");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthenticated" });
      expect(handleImportSheetMock).not.toHaveBeenCalled();
    });

    it("forwards the session username to handleImportSheet, ignoring ?username=", async () => {
      authMock.mockResolvedValueOnce(sessionUser("session-user"));
      const app = buildApp();
      const xlsx = await buildEmptyXlsxBuffer();

      const res = await request(app)
        .post(
          "/api/import-sheet?sheet=forecast&country=Lebanon&username=spoofed-attacker",
        )
        .attach("file", xlsx, "forecast.xlsx");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, sheet: "forecast" });
      expect(handleImportSheetMock).toHaveBeenCalledTimes(1);

      const [, sheet, country, username] = handleImportSheetMock.mock.calls[0];
      expect(sheet).toBe("forecast");
      expect(country).toBe("Lebanon");
      // The audit username MUST come from the verified session, not the
      // `?username=spoofed-attacker` query parameter.
      expect(username).toBe("session-user");
      expect(username).not.toBe("spoofed-attacker");
    });

    it("falls back to 'System' when the session user has no display name", async () => {
      // Mirrors the `getAuditActor` fallback: an authenticated user without a
      // stored name still passes auth, but the audit row is labelled "System"
      // rather than the browser-supplied query parameter.
      authMock.mockResolvedValueOnce(sessionUser(""));
      const app = buildApp();
      const xlsx = await buildEmptyXlsxBuffer();

      const res = await request(app)
        .post("/api/import-sheet?sheet=forecast&country=Lebanon&username=spoofed")
        .attach("file", xlsx, "forecast.xlsx");

      expect(res.status).toBe(200);
      const [, , , username] = handleImportSheetMock.mock.calls[0];
      expect(username).toBe("System");
      expect(username).not.toBe("spoofed");
    });
  });

  // ---------- /api/import-competitor ----------
  describe("POST /api/import-competitor", () => {
    it("rejects anonymous callers with 401 and never reaches upsertCompetitorData", async () => {
      authMock.mockRejectedValueOnce(new Error("no session"));
      const app = buildApp();
      const xlsx = await buildCompetitorXlsxBuffer();

      const res = await request(app)
        .post("/api/import-competitor?country=Lebanon&username=spoofed")
        .attach("file", xlsx, "competitor.xlsx");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthenticated" });
      expect(upsertCompetitorMock).not.toHaveBeenCalled();
    });

    it("forwards the session username to upsertCompetitorData, ignoring ?username=", async () => {
      authMock.mockResolvedValueOnce(sessionUser("session-admin"));
      const app = buildApp();
      const xlsx = await buildCompetitorXlsxBuffer();

      const res = await request(app)
        .post(
          "/api/import-competitor?country=Lebanon&username=spoofed-attacker",
        )
        .attach("file", xlsx, "competitor.xlsx");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(upsertCompetitorMock).toHaveBeenCalledTimes(1);

      // upsertCompetitorData(country, brandMonthly, flavorYearly, uploadedBy, ...)
      const callArgs = upsertCompetitorMock.mock.calls[0];
      const [country, , , uploadedBy] = callArgs;
      expect(country).toBe("Lebanon");
      // The audit username MUST come from the verified session, not the
      // `?username=spoofed-attacker` query parameter.
      expect(uploadedBy).toBe("session-admin");
      expect(uploadedBy).not.toBe("spoofed-attacker");
    });

    it("falls back to 'System' when the session user has no display name", async () => {
      authMock.mockResolvedValueOnce(sessionUser(""));
      const app = buildApp();
      const xlsx = await buildCompetitorXlsxBuffer();

      const res = await request(app)
        .post("/api/import-competitor?country=Lebanon&username=spoofed")
        .attach("file", xlsx, "competitor.xlsx");

      expect(res.status).toBe(200);
      const [, , , uploadedBy] = upsertCompetitorMock.mock.calls[0];
      expect(uploadedBy).toBe("System");
      expect(uploadedBy).not.toBe("spoofed");
    });
  });
});
