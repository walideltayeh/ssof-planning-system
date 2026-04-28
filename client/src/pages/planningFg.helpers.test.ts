import { describe, it, expect } from "vitest";
import {
  getWeeksStyle,
  getClosingStockStyle,
  pushEntry,
  popEntry,
  clearStackForSku,
  recordEdit,
  applyUndo,
  applyRedo,
  peekTop,
  getStackForSku,
  type UndoEntry,
  type UndoStacks,
} from "./planningFg.helpers";

// ── Conditional formatting ─────────────────────────────────────────────────

describe("getWeeksStyle", () => {
  it("renders 0 weeks as a muted neutral cell", () => {
    expect(getWeeksStyle(0)).toBe("bg-gray-200 text-gray-500 font-bold");
  });

  it("treats negative weeks as a critical (dark) shortage", () => {
    expect(getWeeksStyle(-1)).toBe("bg-gray-900 text-white font-bold");
    expect(getWeeksStyle(-12.5)).toBe("bg-gray-900 text-white font-bold");
  });

  it("warns in red below the 4-week safety floor", () => {
    expect(getWeeksStyle(0.5)).toBe("bg-red-600 text-white font-bold");
    expect(getWeeksStyle(3.99)).toBe("bg-red-600 text-white font-bold");
  });

  it("shows a healthy green band between 4 and 6 weeks (inclusive)", () => {
    expect(getWeeksStyle(4)).toBe("text-emerald-700 font-bold");
    expect(getWeeksStyle(5)).toBe("text-emerald-700 font-bold");
    expect(getWeeksStyle(6)).toBe("text-emerald-700 font-bold");
  });

  it("flags overstock above 6 weeks back to red", () => {
    expect(getWeeksStyle(6.01)).toBe("bg-red-600 text-white font-bold");
    expect(getWeeksStyle(50)).toBe("bg-red-600 text-white font-bold");
  });

  it("treats +Infinity (no IMS denominator) as a purple 'no demand' marker", () => {
    expect(getWeeksStyle(Number.POSITIVE_INFINITY)).toBe(
      "bg-purple-200 text-purple-900 font-bold",
    );
  });

  it("treats -Infinity as a dark critical cell", () => {
    expect(getWeeksStyle(Number.NEGATIVE_INFINITY)).toBe(
      "bg-gray-900 text-white font-bold",
    );
  });
});

describe("getClosingStockStyle", () => {
  it("highlights negative closing stock in red", () => {
    expect(getClosingStockStyle(-1)).toBe("bg-red-100 text-red-800 font-bold");
    expect(getClosingStockStyle(-1000)).toBe("bg-red-100 text-red-800 font-bold");
  });

  it("returns no styling for zero or positive closing stock", () => {
    expect(getClosingStockStyle(0)).toBe("");
    expect(getClosingStockStyle(1)).toBe("");
    expect(getClosingStockStyle(99999)).toBe("");
  });
});

// ── Per-SKU undo / redo state machine ──────────────────────────────────────

const makeEntry = (overrides: Partial<UndoEntry> = {}): UndoEntry => ({
  type: "planningFgCell",
  skuId: 1,
  periodId: 100,
  label: "Opening Stock",
  oldValue: "10",
  newValue: "20",
  skuName: "SKU-A",
  periodLabel: "Jan 2026",
  ...overrides,
});

describe("undo/redo helpers — pushEntry", () => {
  it("pushes an entry onto an empty stack and returns a new Map", () => {
    const empty: UndoStacks = new Map();
    const entry = makeEntry();
    const next = pushEntry(empty, entry);

    expect(next).not.toBe(empty);
    expect(empty.size).toBe(0); // input untouched
    expect(next.get(1)).toEqual([entry]);
  });

  it("appends to an existing per-SKU stack without mutating the original", () => {
    const e1 = makeEntry({ newValue: "20" });
    const e2 = makeEntry({ oldValue: "20", newValue: "30" });
    const before = pushEntry(new Map(), e1);
    const beforeStack = before.get(1);
    const after = pushEntry(before, e2);

    expect(after.get(1)).toEqual([e1, e2]);
    // original stack reference is not mutated in place
    expect(beforeStack).toEqual([e1]);
    expect(beforeStack).not.toBe(after.get(1));
  });
});

describe("undo/redo helpers — popEntry", () => {
  it("pops the most recent entry off and returns it", () => {
    const e1 = makeEntry({ newValue: "20" });
    const e2 = makeEntry({ oldValue: "20", newValue: "30" });
    const stacks = pushEntry(pushEntry(new Map(), e1), e2);

    const { stacks: next, entry } = popEntry(stacks, 1);

    expect(entry).toEqual(e2);
    expect(next.get(1)).toEqual([e1]);
    // source untouched
    expect(stacks.get(1)).toEqual([e1, e2]);
  });

  it("removes the SKU key entirely once its stack is emptied", () => {
    const stacks = pushEntry(new Map(), makeEntry());
    const { stacks: next, entry } = popEntry(stacks, 1);

    expect(entry).not.toBeNull();
    expect(next.has(1)).toBe(false);
    expect(next.size).toBe(0);
  });

  it("returns the input map and a null entry when popping an unknown SKU", () => {
    const stacks: UndoStacks = new Map();
    const result = popEntry(stacks, 42);

    expect(result.entry).toBeNull();
    expect(result.stacks).toBe(stacks);
  });

  it("returns a null entry when popping an empty stack and leaves other SKUs alone", () => {
    const stacks = pushEntry(new Map(), makeEntry({ skuId: 7 }));
    const { stacks: next, entry } = popEntry(stacks, 99);

    expect(entry).toBeNull();
    expect(next.get(7)).toHaveLength(1);
  });
});

describe("undo/redo helpers — clearStackForSku", () => {
  it("removes only the targeted SKU's stack", () => {
    const stacks = pushEntry(
      pushEntry(new Map(), makeEntry({ skuId: 1 })),
      makeEntry({ skuId: 2 }),
    );

    const next = clearStackForSku(stacks, 1);

    expect(next.has(1)).toBe(false);
    expect(next.get(2)).toHaveLength(1);
  });

  it("returns the same map reference when the SKU isn't present (cheap no-op)", () => {
    const stacks = pushEntry(new Map(), makeEntry({ skuId: 1 }));
    const next = clearStackForSku(stacks, 999);
    expect(next).toBe(stacks);
  });
});

describe("undo/redo helpers — peekTop / getStackForSku", () => {
  it("peekTop returns the most recently pushed entry", () => {
    const e1 = makeEntry({ newValue: "20" });
    const e2 = makeEntry({ oldValue: "20", newValue: "30" });
    const stacks = pushEntry(pushEntry(new Map(), e1), e2);
    expect(peekTop(stacks, 1)).toEqual(e2);
  });

  it("peekTop returns null for unknown / empty SKUs", () => {
    expect(peekTop(new Map(), 1)).toBeNull();
  });

  it("getStackForSku always returns an array, even for unknown SKUs", () => {
    expect(getStackForSku(new Map(), 1)).toEqual([]);
  });
});

describe("undo/redo helpers — recordEdit clears the redo branch", () => {
  it("pushes onto undo and clears the redo stack for that SKU only", () => {
    // Seed: SKU 1 has a redo entry queued, SKU 2 has its own redo entry.
    const redoSeed = pushEntry(
      pushEntry(new Map(), makeEntry({ skuId: 1, label: "old-redo" })),
      makeEntry({ skuId: 2, label: "other-sku-redo" }),
    );
    const newEdit = makeEntry({ skuId: 1, newValue: "999" });

    const { undoStacks, redoStacks } = recordEdit(new Map(), redoSeed, newEdit);

    expect(undoStacks.get(1)).toEqual([newEdit]);
    // SKU 1's redo branch was invalidated by the new edit…
    expect(redoStacks.has(1)).toBe(false);
    // …but SKU 2's redo branch is untouched.
    expect(redoStacks.get(2)).toHaveLength(1);
  });
});

describe("undo/redo helpers — applyUndo / applyRedo round-trips", () => {
  it("applyUndo pops from undo and mirror-pushes onto redo", () => {
    const entry = makeEntry({ newValue: "55" });
    const undoSeed = pushEntry(new Map(), entry);

    const result = applyUndo(undoSeed, new Map(), 1);

    expect(result.entry).toEqual(entry);
    expect(result.undoStacks.has(1)).toBe(false);
    expect(result.redoStacks.get(1)).toEqual([entry]);
  });

  it("applyUndo on an empty stack returns the inputs untouched and a null entry", () => {
    const undo: UndoStacks = new Map();
    const redo: UndoStacks = new Map();
    const result = applyUndo(undo, redo, 1);
    expect(result.entry).toBeNull();
    expect(result.undoStacks).toBe(undo);
    expect(result.redoStacks).toBe(redo);
  });

  it("applyRedo pops from redo and pushes back onto undo without clearing redo", () => {
    const entry = makeEntry();
    const redoSeed = pushEntry(new Map(), entry);

    const result = applyRedo(new Map(), redoSeed, 1);

    expect(result.entry).toEqual(entry);
    expect(result.undoStacks.get(1)).toEqual([entry]);
    expect(result.redoStacks.has(1)).toBe(false);
  });

  it("undo → redo → undo lands on the original undo state (idempotent round-trip)", () => {
    const entry = makeEntry({ newValue: "77" });
    const undo0 = pushEntry(new Map(), entry);
    const redo0: UndoStacks = new Map();

    const afterUndo = applyUndo(undo0, redo0, 1);
    const afterRedo = applyRedo(afterUndo.undoStacks, afterUndo.redoStacks, 1);
    const afterUndoAgain = applyUndo(afterRedo.undoStacks, afterRedo.redoStacks, 1);

    expect(afterUndoAgain.entry).toEqual(entry);
    expect(afterUndoAgain.undoStacks.has(1)).toBe(false);
    expect(afterUndoAgain.redoStacks.get(1)).toEqual([entry]);
  });

  it("a fresh edit AFTER an undo wipes the redo branch (no zombie redo)", () => {
    const e1 = makeEntry({ newValue: "10" });
    const e2 = makeEntry({ oldValue: "10", newValue: "20" });
    // Two edits stacked, then user undoes the second one.
    let undo = pushEntry(pushEntry(new Map(), e1), e2);
    let redo: UndoStacks = new Map();
    const undone = applyUndo(undo, redo, 1);
    undo = undone.undoStacks;
    redo = undone.redoStacks;
    expect(redo.get(1)).toEqual([e2]);

    // Now they make a brand-new edit on the same SKU.
    const e3 = makeEntry({ oldValue: "10", newValue: "999" });
    const after = recordEdit(undo, redo, e3);

    expect(after.undoStacks.get(1)).toEqual([e1, e3]);
    // The previously-undone e2 must NOT be re-doable anymore.
    expect(after.redoStacks.has(1)).toBe(false);
  });
});

describe("undo/redo helpers — per-SKU stack isolation", () => {
  it("pushing on one SKU never touches another SKU's stack", () => {
    const a1 = makeEntry({ skuId: 1, newValue: "1A" });
    const b1 = makeEntry({ skuId: 2, newValue: "2A" });
    const stacks = pushEntry(pushEntry(new Map(), a1), b1);

    expect(stacks.get(1)).toEqual([a1]);
    expect(stacks.get(2)).toEqual([b1]);
  });

  it("undoing one SKU does not consume another SKU's history", () => {
    const a1 = makeEntry({ skuId: 1 });
    const b1 = makeEntry({ skuId: 2 });
    const undoSeed = pushEntry(pushEntry(new Map(), a1), b1);

    const result = applyUndo(undoSeed, new Map(), 1);

    expect(result.entry).toEqual(a1);
    // SKU 1's undo emptied, SKU 2's still intact.
    expect(result.undoStacks.has(1)).toBe(false);
    expect(result.undoStacks.get(2)).toEqual([b1]);
    // Redo only got SKU 1's entry, not SKU 2's.
    expect(result.redoStacks.get(1)).toEqual([a1]);
    expect(result.redoStacks.has(2)).toBe(false);
  });

  it("recording an edit on SKU A does not clear SKU B's redo stack", () => {
    const redoSeed = pushEntry(new Map(), makeEntry({ skuId: 2, label: "B-redo" }));
    const newAEdit = makeEntry({ skuId: 1 });

    const after = recordEdit(new Map(), redoSeed, newAEdit);

    expect(after.redoStacks.get(2)).toHaveLength(1);
    expect(after.redoStacks.has(1)).toBe(false);
  });
});

// ── Special UndoEntry shapes survive round-trips ───────────────────────────
// These are the five `type` values the Planning FG grid actually emits. We
// don't replay them against the server here, but we DO verify the helpers
// preserve every field exactly so the React handlers can dispatch the right
// mutation with the right payload.

describe("undo/redo helpers — special entry types preserve their shape", () => {
  it("preserves a syncIms entry through undo and redo", () => {
    const entry: UndoEntry = {
      type: "syncIms",
      skuId: 11,
      periodId: 202,
      label: "IMS",
      oldValue: "100",
      newValue: "150",
      skuName: "SKU-Sync",
      periodLabel: "Feb 2026",
    };
    const undo = pushEntry(new Map(), entry);
    const undone = applyUndo(undo, new Map(), 11);
    const redone = applyRedo(undone.undoStacks, undone.redoStacks, 11);

    expect(undone.entry).toEqual(entry);
    expect(redone.entry).toEqual(entry);
    expect(redone.entry?.type).toBe("syncIms");
  });

  it("preserves an imsDirect entry (current-month IMS edit, no forecast sync)", () => {
    const entry: UndoEntry = {
      type: "imsDirect",
      skuId: 12,
      periodId: 203,
      label: "IMS",
      oldValue: "5",
      newValue: "8",
      skuName: "SKU-Direct",
      periodLabel: "Mar 2026",
    };
    const undo = pushEntry(new Map(), entry);
    const undone = applyUndo(undo, new Map(), 12);

    expect(undone.entry).toEqual(entry);
    expect(undone.entry?.type).toBe("imsDirect");
    // Round-trip back through redo → undo.
    const redone = applyRedo(undone.undoStacks, undone.redoStacks, 12);
    const undoneAgain = applyUndo(redone.undoStacks, redone.redoStacks, 12);
    expect(undoneAgain.entry).toEqual(entry);
  });

  it("preserves a syncArrival entry (Actual arrivals / Planned Orders)", () => {
    const entry: UndoEntry = {
      type: "syncArrival",
      skuId: 13,
      periodId: 204,
      label: "Actual arrivals / Planned Orders",
      oldValue: "0",
      newValue: "500",
      skuName: "SKU-Arrival",
      periodLabel: "Apr 2026",
    };
    const undo = pushEntry(new Map(), entry);
    const undone = applyUndo(undo, new Map(), 13);
    const redone = applyRedo(undone.undoStacks, undone.redoStacks, 13);
    expect(redone.entry).toEqual(entry);
    expect(redone.entry?.label).toBe("Actual arrivals / Planned Orders");
  });

  it("preserves a planningFgCell entry (Opening Stock / Adjustments)", () => {
    const entry: UndoEntry = {
      type: "planningFgCell",
      skuId: 14,
      periodId: 205,
      label: "Adjustments",
      oldValue: "-3",
      newValue: "7",
      skuName: "SKU-Adj",
      periodLabel: "May 2026",
    };
    const undo = pushEntry(new Map(), entry);
    const undone = applyUndo(undo, new Map(), 14);
    const redone = applyRedo(undone.undoStacks, undone.redoStacks, 14);
    expect(redone.entry).toEqual(entry);
    // Critically the label must survive — the React handler branches on
    // it to pick `openingStock` vs `adjustments` in the mutation payload.
    expect(redone.entry?.label).toBe("Adjustments");
  });

  it("preserves an invoicedSHP entry INCLUDING its oldWeeks weekly breakdown", () => {
    const entry: UndoEntry = {
      type: "invoicedSHP",
      skuId: 15,
      periodId: 206,
      label: "Invoiced (SHP)",
      oldValue: "400",
      newValue: "600",
      skuName: "SKU-SHP",
      periodLabel: "Jun 2026",
      oldWeeks: { week1: 100, week2: 100, week3: 100, week4: 100 },
    };
    const undo = pushEntry(new Map(), entry);
    const undone = applyUndo(undo, new Map(), 15);
    const redone = applyRedo(undone.undoStacks, undone.redoStacks, 15);

    expect(undone.entry?.oldWeeks).toEqual({ week1: 100, week2: 100, week3: 100, week4: 100 });
    expect(redone.entry?.oldWeeks).toEqual({ week1: 100, week2: 100, week3: 100, week4: 100 });
    // Whole entry survives unchanged.
    expect(redone.entry).toEqual(entry);
  });
});
