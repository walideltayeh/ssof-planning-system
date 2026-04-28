// ── Excel-matching conditional formatting for the Planning FG grid ──────────
// Extracted from PlanningFgPage so it can be unit-tested independently.

export function getWeeksStyle(weeks: number): string {
  if (!isFinite(weeks) && weeks > 0) return "bg-purple-200 text-purple-900 font-bold";
  if (!isFinite(weeks) && weeks < 0) return "bg-gray-900 text-white font-bold";
  if (weeks === 0)   return "bg-gray-200 text-gray-500 font-bold";
  if (weeks < 0)     return "bg-gray-900 text-white font-bold";
  if (weeks < 4)     return "bg-red-600 text-white font-bold";
  if (weeks <= 6)    return "text-emerald-700 font-bold";
  return "bg-red-600 text-white font-bold";
}

export function getClosingStockStyle(val: number): string {
  if (val < 0) return "bg-red-100 text-red-800 font-bold";
  return "";
}

// ── Per-SKU undo / redo state machine ───────────────────────────────────────
// The Planning FG grid keeps an independent undo and redo stack for every
// SKU, so a user editing rows for one product can undo their work without
// touching another product's history. The functions below are the *pure*
// pieces of that state machine — they take the current Map and return a new
// Map, so they are trivial to reason about and unit test. The React component
// composes them inside its setState callbacks.

export interface UndoEntry {
  type:
    | "planningFgCell"
    | "syncIms"
    | "invoicedSHP"
    | "imsDirect"
    | "syncArrival"
    // Syria/Libya (intl) Planning FG grid edits — same shape as Lebanon's
    // entries but routed through the country-scoped mutations on undo/redo.
    | "intlPlanningFgCell"
    | "intlIms"
    | "intlProduction";
  skuId: number;
  periodId: number;
  label: string;
  oldValue: string;
  newValue: string;
  skuName: string;
  periodLabel: string;
  // For invoicedSHP undo, store the old weekly breakdown so a redo can
  // restore the same per-week distribution the user originally typed.
  oldWeeks?: { week1: number; week2: number; week3: number; week4: number };
}

export type UndoStacks = Map<number, UndoEntry[]>;

/** Returns the (possibly empty) stack of entries for one SKU. */
export function getStackForSku(stacks: UndoStacks, skuId: number): UndoEntry[] {
  return stacks.get(skuId) ?? [];
}

/** Returns the most recent entry pushed onto a SKU's stack, or null. */
export function peekTop(stacks: UndoStacks, skuId: number): UndoEntry | null {
  const stack = stacks.get(skuId);
  if (!stack || stack.length === 0) return null;
  return stack[stack.length - 1];
}

/**
 * Immutably pushes an entry onto its SKU's stack and returns a new Map.
 * The input map is never mutated.
 */
export function pushEntry(stacks: UndoStacks, entry: UndoEntry): UndoStacks {
  const next = new Map(stacks);
  const stack = [...(next.get(entry.skuId) ?? []), entry];
  next.set(entry.skuId, stack);
  return next;
}

/**
 * Immutably removes the entire stack for one SKU. Used to clear the redo
 * stack whenever a brand-new edit is made (standard undo/redo semantics:
 * a fresh edit invalidates any pending redo branch).
 */
export function clearStackForSku(stacks: UndoStacks, skuId: number): UndoStacks {
  if (!stacks.has(skuId)) return stacks;
  const next = new Map(stacks);
  next.delete(skuId);
  return next;
}

/**
 * Pops the top entry off a SKU's stack. If the stack is empty, returns the
 * input map unchanged and a null entry. If the pop empties the stack, the
 * SKU key is removed entirely so callers can rely on `Map.size` / `.has()`
 * to know whether any history remains.
 */
export function popEntry(
  stacks: UndoStacks,
  skuId: number,
): { stacks: UndoStacks; entry: UndoEntry | null } {
  const stack = stacks.get(skuId);
  if (!stack || stack.length === 0) return { stacks, entry: null };
  const next = new Map(stacks);
  const newStack = stack.slice(0, -1);
  const entry = stack[stack.length - 1];
  if (newStack.length === 0) next.delete(skuId);
  else next.set(skuId, newStack);
  return { stacks: next, entry };
}

/**
 * Records a brand-new user edit: pushes onto the undo stack AND clears the
 * redo stack for that SKU (so the redo branch is invalidated, matching
 * familiar editor semantics).
 */
export function recordEdit(
  undoStacks: UndoStacks,
  redoStacks: UndoStacks,
  entry: UndoEntry,
): { undoStacks: UndoStacks; redoStacks: UndoStacks } {
  return {
    undoStacks: pushEntry(undoStacks, entry),
    redoStacks: clearStackForSku(redoStacks, entry.skuId),
  };
}

/**
 * Applies an undo for one SKU: pops the top of its undo stack and
 * mirror-pushes the same entry onto its redo stack. Returns the popped
 * entry so the caller can replay the inverse mutation against the server.
 * If the SKU has no undo history, both stacks come back unchanged and
 * `entry` is null.
 */
export function applyUndo(
  undoStacks: UndoStacks,
  redoStacks: UndoStacks,
  skuId: number,
): { undoStacks: UndoStacks; redoStacks: UndoStacks; entry: UndoEntry | null } {
  const popped = popEntry(undoStacks, skuId);
  if (!popped.entry) return { undoStacks, redoStacks, entry: null };
  return {
    undoStacks: popped.stacks,
    redoStacks: pushEntry(redoStacks, popped.entry),
    entry: popped.entry,
  };
}

/**
 * Applies a redo for one SKU: pops the top of its redo stack and pushes
 * the entry back onto its undo stack. Critically, this does NOT clear the
 * redo stack — we're inside a redo operation, not a fresh edit.
 */
export function applyRedo(
  undoStacks: UndoStacks,
  redoStacks: UndoStacks,
  skuId: number,
): { undoStacks: UndoStacks; redoStacks: UndoStacks; entry: UndoEntry | null } {
  const popped = popEntry(redoStacks, skuId);
  if (!popped.entry) return { undoStacks, redoStacks, entry: null };
  return {
    undoStacks: pushEntry(undoStacks, popped.entry),
    redoStacks: popped.stacks,
    entry: popped.entry,
  };
}
