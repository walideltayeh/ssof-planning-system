import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
//
// Task #22 / `server/excelImport.test.ts` already pin down that the six
// importers in `server/excelImport.ts` write the verified session username
// into the `audit_trail` table verbatim. The `/api/import-competitor` route,
// however, takes a different exit: it calls `db.upsertCompetitorData`, which
// persists the uploader directly onto the `competitor_data` row (there is no
// separate `audit_trail` write for competitor uploads). `spreadsheetUpload.test.ts`
// proves the route forwards the session-derived `uploadedBy` argument; this
// file proves `upsertCompetitorData` actually writes that exact value into
// the `competitor_data.uploaded_by` column on both the insert and update
// branches — so a future refactor can't quietly substitute `"System"`, a
// hard-coded label, or some other field, re-opening the spoofing hole on
// the competitor side.
//
// We mock `pg` and `drizzle-orm/node-postgres` so `getDb()` returns a fake
// drizzle client we fully control, then inspect the payload handed to
// `.values(...)` (insert branch) and `.set(...)` (update branch).

const mocks = vi.hoisted(() => {
  // Captures `db.update(competitorData).set(payload).where(...)`.
  const updateWhereSpy = vi.fn(async () => undefined);
  const setSpy = vi.fn(() => ({ where: updateWhereSpy }));

  // Captures `db.insert(competitorData).values(payload)`.
  const valuesSpy = vi.fn(async () => undefined);

  // Controls what `db.select().from(competitorData).where(...)` resolves to.
  // Empty array ⇒ insert branch; non-empty ⇒ update branch.
  const selectResult: unknown[] = [];

  const drizzleClient = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectResult),
        orderBy: () => Promise.resolve(selectResult),
      }),
    }),
    update: () => ({ set: setSpy }),
    insert: () => ({ values: valuesSpy }),
  };

  return { setSpy, updateWhereSpy, valuesSpy, selectResult, drizzleClient };
});

// `db.ts` instantiates a real `pg.Pool` inside `getPool()` when DATABASE_URL
// is set. We replace it with a no-op so no actual connection is attempted.
vi.mock("pg", () => {
  class FakePool {
    on() {}
    end() {}
  }
  return { Pool: FakePool, default: { Pool: FakePool } };
});

// `getDb()` calls `drizzle(pool)`. Returning our fake client lets us assert
// on every chained call the importer makes.
vi.mock("drizzle-orm/node-postgres", () => {
  return {
    drizzle: () => mocks.drizzleClient,
  };
});

// `getDb()` short-circuits to `null` when DATABASE_URL is unset, which would
// make `upsertCompetitorData` return without ever touching our spies. Set a
// dummy value so the production code path runs end-to-end against the mock,
// and remember the original so we can restore it in `afterAll` — this avoids
// leaking a fake URL into other test files that may rely on DATABASE_URL
// being unset.
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL =
  ORIGINAL_DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";

// Import AFTER vi.mock so `./db` picks up the mocked pg/drizzle modules.
const { upsertCompetitorData } = await import("./db");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectResult.length = 0;
});

afterAll(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upsertCompetitorData persists the verified uploader verbatim", () => {
  it("writes the uploadedBy argument into the new row on the insert branch", async () => {
    // No existing competitor_data row for this country ⇒ insert branch.
    mocks.selectResult.length = 0;

    await upsertCompetitorData(
      "Lebanon",
      { brands: [{ brand: "Al Fakher", year: 2026, monthly: [1] }] },
      { brands: [{ brand: "Al Fakher", flavor: "Two Apple", yearly: [1] }] },
      "session-admin",
    );

    expect(mocks.valuesSpy).toHaveBeenCalledTimes(1);
    expect(mocks.setSpy).not.toHaveBeenCalled();

    const inserted = mocks.valuesSpy.mock.calls[0][0] as {
      country: string;
      uploadedBy: string;
    };

    // The `uploaded_by` column MUST capture the exact string the route
    // forwarded (which the route in turn pulled from the verified session).
    expect(inserted.uploadedBy).toBe("session-admin");
    expect(inserted.uploadedBy).not.toBe("System");
    expect(inserted.country).toBe("Lebanon");
  });

  it("writes the uploadedBy argument into the row on the update branch", async () => {
    // A pre-existing row for this country ⇒ update branch.
    mocks.selectResult.push({ id: 7, country: "Syria", uploadedBy: "old-user" });

    await upsertCompetitorData(
      "Syria",
      { brands: [] },
      { brands: [] },
      "another-admin",
    );

    expect(mocks.setSpy).toHaveBeenCalledTimes(1);
    expect(mocks.updateWhereSpy).toHaveBeenCalledTimes(1);
    expect(mocks.valuesSpy).not.toHaveBeenCalled();

    const updated = mocks.setSpy.mock.calls[0][0] as { uploadedBy: string };

    // Same guarantee on the overwrite path: nothing in `upsertCompetitorData`
    // is allowed to swap the verified uploader for `"System"` or any other
    // hard-coded label before it lands in the database.
    expect(updated.uploadedBy).toBe("another-admin");
    expect(updated.uploadedBy).not.toBe("System");
    expect(updated.uploadedBy).not.toBe("old-user");
  });

  it("forwards the literal 'System' fallback string as-is when the route supplies it", async () => {
    // `spreadsheetUpload.test.ts` already proves the route falls back to
    // the literal "System" when the session user has no display name. This
    // test confirms `upsertCompetitorData` doesn't mangle that value either —
    // whatever string the caller passed is exactly what gets persisted, no
    // hard-coded substitution kicks in for an empty/missing name.
    mocks.selectResult.length = 0;

    await upsertCompetitorData("Libya", {}, {}, "System");

    expect(mocks.valuesSpy).toHaveBeenCalledTimes(1);
    const inserted = mocks.valuesSpy.mock.calls[0][0] as {
      uploadedBy: string;
    };
    expect(inserted.uploadedBy).toBe("System");
  });
});
