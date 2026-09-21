import { describe, expect, it } from "vitest";
import { describeUpdate, isDataUpdate, relativeTime } from "@shared/audit/lastUpdate";

describe("isDataUpdate", () => {
  it("counts uploads, imports and edits as data updates", () => {
    expect(isDataUpdate("upload", "IMS Actuals")).toBe(true);
    expect(isDataUpdate("import", "Forecast")).toBe(true);
    expect(isDataUpdate("edit_cell", "Planning FG")).toBe(true);
    expect(isDataUpdate("save_version", "SSOF Version")).toBe(true);
  });

  it("ignores page views, sign-ins, exports and user-account admin", () => {
    expect(isDataUpdate("page_view", "Dashboard")).toBe(false);
    expect(isDataUpdate("login", null)).toBe(false);
    expect(isDataUpdate("login_failed", null)).toBe(false);
    expect(isDataUpdate("logout", null)).toBe(false);
    expect(isDataUpdate("export_excel", "Dashboard")).toBe(false);
    expect(isDataUpdate("export_anything", null)).toBe(false);
    expect(isDataUpdate("update_user", "Users")).toBe(false);
  });
});

describe("describeUpdate", () => {
  it("writes a plain-English label with the sheet", () => {
    expect(describeUpdate("upload", "IMS Actuals")).toBe("Upload — IMS Actuals");
    expect(describeUpdate("edit_cell", "Shipment")).toBe("Cell edit — Shipment");
    expect(describeUpdate("save_version", null)).toBe("Version saved");
  });

  it("falls back to a readable version of unknown actions", () => {
    expect(describeUpdate("bulk_reprice", "Prices")).toBe("Bulk reprice — Prices");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  it("rounds to the largest whole unit", () => {
    expect(relativeTime("2026-09-21T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-09-21T11:15:00Z", now)).toBe("45 minutes ago");
    expect(relativeTime("2026-09-21T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-09-20T12:00:00Z", now)).toBe("1 day ago");
    expect(relativeTime("2026-09-16T10:00:00Z", now)).toBe("5 days ago");
    expect(relativeTime("2026-07-10T12:00:00Z", now)).toBe("2 months ago");
    expect(relativeTime("2024-08-01T12:00:00Z", now)).toBe("2 years ago");
  });
  it("never reports the future as negative", () => {
    expect(relativeTime("2026-09-22T12:00:00Z", now)).toBe("just now");
  });
});
