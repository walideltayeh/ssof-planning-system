import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./countryVisibility", async original => ({ ...await original<typeof import("./countryVisibility")>(),
  assertCountryVisible: vi.fn(async () => {}), hiddenCountries: vi.fn(async () => new Set()) }));
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => ({
  ...await importOriginal<typeof import("./db")>(),
  getAppUserByUsername: vi.fn(),
}));
vi.mock("./focPlanning", () => ({
  getFocPlanning: vi.fn(async () => ({ skus: [], periods: [], cells: [] })),
  setFocCell: vi.fn(async () => ({ success: true })),
  previewLibyaPo: vi.fn(async () => ({ rows: [], token: "a".repeat(64), applied: false })),
  importLibyaPo: vi.fn(async () => ({ success: true, versionId: 1, alreadyApplied: false })),
}));
vi.mock("./focReceiptService", () => ({
  updateFocReceipt: vi.fn(async () => ({ success: true, changed: 1, warnings: [] })),
  previewFocReceipts: vi.fn(async () => ({ token: "a".repeat(64), changes: [], skippedNotSet: 0 })),
  commitFocReceipts: vi.fn(async () => ({ success: true, changed: 1, warnings: [] })),
  reviewFocReceipt: vi.fn(async () => ({ success: true })),
}));
vi.mock("./focEntryService", () => ({
  previewFocEntry: vi.fn(async () => ({ token: "a".repeat(64), canSave: true, rows: [], impact: [], warnings: [] })),
  commitFocEntry: vi.fn(async () => ({ success: true, versionId: 1, warnings: [] })),
}));
const { appRouter } = await import("./routers");
const db = await import("./db");
const foc = await import("./focPlanning");
const receipts = await import("./focReceiptService");
const entries = await import("./focEntryService");
function caller(role: "admin" | "user" = "admin") {
  return appRouter.createCaller({ user: { id: 1, name: "FOC Tester", role }, req: {}, res: {} } as TrpcContext);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getAppUserByUsername).mockResolvedValue({
    id: 1, username: "FOC Tester", isOwner: false, role: "admin",
    countries: JSON.stringify(["Libya", "Syria"]), countryRoles: JSON.stringify({ Libya: "admin", Syria: "admin" }),
  } as any);
});
describe("FOC country permissions", () => {
  it.each(["previewEntries", "commitEntries", "previewCell", "commitCell"] as const)("denies viewers and admins from a different country: %s", async method => {
    const input = method.endsWith("Entries")
      ? { country: "Libya" as const, includeFoc: true, ...(method.startsWith("commit") ? { token: "a".repeat(64) } : {}),
        lines: [{ date: "Jun-26", flavor: "Mint", weight: "50gr", packaging: "New Packaging", quantityMC: "10", received: true, accType: "Export", salesManager: "Manager" }] }
      : { country: "Libya" as const, includeFoc: true, skuId: 1, periodId: 6, received: true, ...(method.startsWith("commit") ? { token: "a".repeat(64) } : {}) };
    await expect((caller("user").focPlanning[method] as any)(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(db.getAppUserByUsername).mockResolvedValue({ username: "FOC Tester", role: "admin", countries: '["Libya","Syria"]', countryRoles: '{"Libya":"viewer","Syria":"admin"}', isOwner: false } as any);
    await expect((caller().focPlanning[method] as any)(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(entries.previewFocEntry).not.toHaveBeenCalled(); expect(entries.commitFocEntry).not.toHaveBeenCalled();
  });
  it("keeps past preview and commit cell payloads identical and uses the authenticated audit actor", async () => {
    const cell = { country: "Libya" as const, includeFoc: true, skuId: 1, periodId: 6, value: 12.34 };
    await caller().focPlanning.previewCell(cell);
    await caller().focPlanning.commitCell({ ...cell, token: "a".repeat(64) });
    expect(entries.previewFocEntry).toHaveBeenCalledWith("Libya", { cell: { skuId: 1, periodId: 6, value: 12.34 } }, true);
    expect(entries.commitFocEntry).toHaveBeenCalledWith("Libya", { cell: { skuId: 1, periodId: 6, value: 12.34 } }, true, "FOC Tester", "a".repeat(64));
  });
  it.each(["receiptUpdate", "receiptPreview", "receiptCommit", "receiptReview"] as const)("denies viewer and cross-country admin %s", async method => {
    const input = method === "receiptUpdate"
      ? { country: "Libya" as const, skuId: 1, periodId: 1, received: true }
      : { country: "Libya" as const, skuId: 1, periodId: 1, received: true, token: "a".repeat(64),
        decision: "separate" as const, reviewKey: "evidence" };
    await expect((caller("user").focPlanning[method] as any)(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(db.getAppUserByUsername).mockResolvedValue({ username: "FOC Tester", countries: '["Libya","Syria"]',
      role: "admin", isOwner: false, countryRoles: '{"Libya":"viewer","Syria":"admin"}' } as any);
    await expect((caller().focPlanning[method] as any)(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(receipts.updateFocReceipt).not.toHaveBeenCalled(); expect(receipts.commitFocReceipts).not.toHaveBeenCalled();
    expect(receipts.reviewFocReceipt).not.toHaveBeenCalled(); expect(receipts.previewFocReceipts).not.toHaveBeenCalled();
  });
  it("attributes receipt/review and bulk changes to the authenticated country administrator", async () => {
    await caller().focPlanning.receiptUpdate({ country: "Syria", skuId: 1, periodId: 1, received: true });
    expect(receipts.updateFocReceipt).toHaveBeenCalledWith("Syria", "FOC Tester", expect.objectContaining({ received: true }));
    await caller().focPlanning.receiptCommit({ country: "Syria", periodId: 1, received: true, token: "a".repeat(64) });
    expect(receipts.commitFocReceipts).toHaveBeenCalledWith("Syria", "FOC Tester", { periodId: 1, received: true }, "a".repeat(64));
    await caller().focPlanning.receiptReview({ country: "Syria", skuId: 1, periodId: 1, decision: "included", reviewKey: "current" });
    expect(receipts.reviewFocReceipt).toHaveBeenCalledWith("Syria", "FOC Tester", expect.objectContaining({ decision: "included", reviewKey: "current" }));
  });
  it.each(["2026-02-30", "2026-09-15", null])("rejects the removed receipt date %s before storage", async receivedDate => {
    await expect(caller().focPlanning.receiptUpdate({ country: "Libya", skuId: 1, periodId: 1, received: true, receivedDate } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(receipts.updateFocReceipt).not.toHaveBeenCalled();
  });
  it("requires a receipt field, a bulk scope, a preview token and assigned country", async () => {
    await expect(caller().focPlanning.receiptUpdate({ country: "Libya", skuId: 1, periodId: 1 } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().focPlanning.receiptPreview({ country: "Libya", received: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().focPlanning.receiptCommit({ country: "Libya", periodId: 1, received: true, token: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.mocked(db.getAppUserByUsername).mockResolvedValue({ username: "FOC Tester", countries: '["Syria"]', role: "admin", isOwner: false } as any);
    await expect(caller().focPlanning.receiptUpdate({ country: "Libya", skuId: 1, periodId: 1, received: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(receipts.updateFocReceipt).not.toHaveBeenCalled();
  });
  it("lets a viewer read assigned-country FOC without allowing writes or PO imports", async () => {
    await caller("user").focPlanning.list({ country: "Libya" });
    expect(foc.getFocPlanning).toHaveBeenCalledWith("Libya");
    await expect(caller("user").focPlanning.update({ country: "Libya", skuId: 1, periodId: 1, value: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").focPlanning.poImport({ country: "Libya", token: "a".repeat(64) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(foc.setFocCell).not.toHaveBeenCalled(); expect(foc.importLibyaPo).not.toHaveBeenCalled();
  });
  it("rejects an unassigned country before loading its cells or PO", async () => {
    vi.mocked(db.getAppUserByUsername).mockResolvedValue({ username: "FOC Tester", countries: '["Syria"]', role: "admin", isOwner: false } as any);
    await expect(caller().focPlanning.list({ country: "Libya" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().focPlanning.poPreview({ country: "Libya" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(foc.getFocPlanning).not.toHaveBeenCalled(); expect(foc.previewLibyaPo).not.toHaveBeenCalled();
  });
  it("does not let a Syria administrator edit or import for Libya where they are a viewer", async () => {
    vi.mocked(db.getAppUserByUsername).mockResolvedValue({
      username: "FOC Tester", countries: '["Libya","Syria"]', role: "admin", isOwner: false,
      countryRoles: '{"Libya":"viewer","Syria":"admin"}',
    } as any);
    await expect(caller().focPlanning.update({ country: "Libya", skuId: 1, periodId: 1, value: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().focPlanning.poImport({ country: "Libya", token: "a".repeat(64) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(foc.setFocCell).not.toHaveBeenCalled(); expect(foc.importLibyaPo).not.toHaveBeenCalled();
  });
  it("attributes an allowed admin edit to its country and user and allows clearing to not-set", async () => {
    await caller().focPlanning.update({ country: "Syria", skuId: 1, periodId: 1, value: null });
    expect(foc.setFocCell).toHaveBeenCalledWith("Syria", 1, 1, null, "FOC Tester");
  });
  it.each(["Lebanon", "KSA"])("rejects FOC for %s even for an administrator", async country => {
    await expect(caller().focPlanning.list({ country } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(foc.getFocPlanning).not.toHaveBeenCalled();
  });
  it.each([-1, Infinity, 12.345])("rejects invalid quantity %s before storage", async value => {
    await expect(caller().focPlanning.update({ country: "Libya", skuId: 1, periodId: 1, value })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(foc.setFocCell).not.toHaveBeenCalled();
  });
});
