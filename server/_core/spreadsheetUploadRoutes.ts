import type { Express, Request, Response } from "express";
import { authenticateHttpRequest } from "./httpAuth";

/**
 * Registers the two spreadsheet upload endpoints (`/api/import-sheet` and
 * `/api/import-competitor`) on the given Express app.
 *
 * Both endpoints derive the audit username from the verified session cookie
 * via `authenticateHttpRequest` — the browser-supplied `?username=` query
 * parameter is intentionally ignored. The behaviour is locked in by
 * `server/spreadsheetUpload.test.ts`.
 */
export function registerSpreadsheetUploadRoutes(app: Express) {
  app.post("/api/import-sheet", async (req: Request, res: Response) => {
    try {
      // Authenticate via the same session cookie tRPC uses. The audit
      // username is derived from the verified session — never from the
      // browser-supplied `username` query string, which is ignored.
      const auth = await authenticateHttpRequest(req, res);
      if (!auth) return;
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
      await new Promise<void>((resolve, reject) => {
        upload.single("file")(req as any, res as any, (err: any) => {
          if (err) reject(err); else resolve();
        });
      });
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const sheet = req.query.sheet as string;
      const country = (req.query.country as string) || "Lebanon";
      if (!sheet) {
        res.status(400).json({ error: "Missing 'sheet' query parameter" });
        return;
      }
      const { handleImportSheet } = await import("../excelImport");
      const result = await handleImportSheet(file.buffer, sheet, country, auth.trustedName);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[Sheet Import] Error:", err);
      res.status(400).json({ error: err?.message || "Import failed" });
    }
  });

  app.post("/api/import-competitor", async (req: Request, res: Response) => {
    try {
      // Authenticate via the same session cookie tRPC uses. The audit
      // username is derived from the verified session — never from the
      // browser-supplied `username` query string, which is ignored.
      const auth = await authenticateHttpRequest(req, res);
      if (!auth) return;
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
      await new Promise<void>((resolve, reject) => {
        upload.single("file")(req as any, res as any, (err: any) => {
          if (err) reject(err); else resolve();
        });
      });
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

      const country = (req.query.country as string) || "Lebanon";
      const username = auth.trustedName;
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer);

      const brandMonthly: Record<string, Record<number, number[]>> = {};
      const ws1 = wb.getWorksheet("Brand Monthly Sales");
      if (ws1) {
        ws1.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const brand = String(row.getCell(1).value ?? "").trim();
          const year = parseInt(String(row.getCell(2).value ?? "0"));
          if (!brand || !year || isNaN(year)) return;
          const vals: number[] = [];
          for (let c = 3; c <= 14; c++) {
            vals.push(parseFloat(String(row.getCell(c).value ?? "0")) || 0);
          }
          if (!brandMonthly[brand]) brandMonthly[brand] = {};
          brandMonthly[brand][year] = vals;
        });
      }

      const flavorYearly: Record<string, Record<string, Record<number, number>>> = {};
      const ws2 = wb.getWorksheet("Brand Flavor Annual");
      const flavorYears = [2020,2021,2022,2023,2024,2025,2026];
      if (ws2) {
        ws2.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const brand = String(row.getCell(1).value ?? "").trim();
          const flavor = String(row.getCell(2).value ?? "").trim();
          if (!brand || !flavor) return;
          if (!flavorYearly[brand]) flavorYearly[brand] = {};
          if (!flavorYearly[brand][flavor]) flavorYearly[brand][flavor] = {};
          for (let c = 0; c < flavorYears.length; c++) {
            const v = parseFloat(String(row.getCell(c + 3).value ?? "0")) || 0;
            flavorYearly[brand][flavor][flavorYears[c]] = v;
          }
        });
      }

      const brandMonthlyKg: Record<string, Record<number, number[]>> = {};
      const ws3 = wb.getWorksheet("Brand Monthly Sales KG");
      if (ws3) {
        ws3.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const brand = String(row.getCell(1).value ?? "").trim();
          const year = parseInt(String(row.getCell(2).value ?? "0"));
          if (!brand || !year || isNaN(year)) return;
          const vals: number[] = [];
          for (let c = 3; c <= 14; c++) {
            vals.push(parseFloat(String(row.getCell(c).value ?? "0")) || 0);
          }
          if (!brandMonthlyKg[brand]) brandMonthlyKg[brand] = {};
          brandMonthlyKg[brand][year] = vals;
        });
      }

      const flavorYearlyKg: Record<string, Record<string, Record<number, number>>> = {};
      const ws4 = wb.getWorksheet("Brand Flavor Annual KG");
      if (ws4) {
        ws4.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const brand = String(row.getCell(1).value ?? "").trim();
          const flavor = String(row.getCell(2).value ?? "").trim();
          if (!brand || !flavor) return;
          if (!flavorYearlyKg[brand]) flavorYearlyKg[brand] = {};
          if (!flavorYearlyKg[brand][flavor]) flavorYearlyKg[brand][flavor] = {};
          for (let c = 0; c < flavorYears.length; c++) {
            const v = parseFloat(String(row.getCell(c + 3).value ?? "0")) || 0;
            flavorYearlyKg[brand][flavor][flavorYears[c]] = v;
          }
        });
      }

      const { upsertCompetitorData } = await import("../db");
      const hasKg = Object.keys(brandMonthlyKg).length > 0 || Object.keys(flavorYearlyKg).length > 0;
      await upsertCompetitorData(country, brandMonthly, flavorYearly, username, hasKg ? brandMonthlyKg : undefined, hasKg ? flavorYearlyKg : undefined);

      const brandCount = Object.keys(brandMonthly).length;
      const flavorCount = Object.values(flavorYearly).reduce((s, f) => s + Object.keys(f).length, 0);
      res.json({ success: true, brands: brandCount, flavors: flavorCount });
    } catch (err: any) {
      console.error("[Competitor Import] Error:", err);
      res.status(400).json({ error: err?.message || "Failed to parse competitor file" });
    }
  });
}
