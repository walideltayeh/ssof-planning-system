import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FocMatchSku } from "@shared/focEntry";
import { FocSkuCombobox } from "./FocSkuCombobox";
import { RecordFocDialog } from "./RecordFocDialog";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@/contexts/UnitContext", () => ({ useUnit: () => ({ unit: "MC" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    focPlanning: {
      previewEntries: { useMutation: () => ({ isPending: false, mutateAsync: mocks.preview }) },
      commitEntries: { useMutation: () => ({ isPending: false, mutateAsync: mocks.commit }) },
    },
  },
}));
vi.mock("./FocImpactConfirmation", () => ({
  FocImpactConfirmation: ({ children, onConfirm, canConfirm }: any) => (
    <div role="dialog" aria-label="Review FOC entries">
      {children}
      <button type="button" disabled={!canConfirm} onClick={onConfirm}>Confirm and save</button>
      <button type="button">Back</button>
    </div>
  ),
}));

const skuFixtures: FocMatchSku[] = [
  { id: 7, name: "Mint", weight: "50g", packagingType: "Old", country: "Libya", isActive: true },
  { id: 2, name: "Apple", weight: "250g", packagingType: "New", country: "Libya", isActive: true },
  { id: 4, name: "Hidden", weight: "50g", packagingType: "New", country: "Libya", isActive: false },
  { id: 9, name: "Foreign", weight: "50g", packagingType: "New", country: "Syria", isActive: true },
];
const periods = [{ id: 31, label: "Sep 26", year: 2026, month: 9 }];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue({ token: "token", canSave: true, rows: [], impact: [], warnings: [] });
  mocks.commit.mockResolvedValue({ success: true, versionId: 12 });
});
afterEach(cleanup);

describe("FOC manual SKU selection", () => {
  it("defensively hides inactive and foreign SKUs without changing supplied order", () => {
    render(<FocSkuCombobox country="Libya" skus={skuFixtures} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "SKU" }));
    const options = screen.getAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      "Mint · 50g · Old",
      "Apple · 250g · New",
    ]);
    expect(screen.queryByText(/Hidden|Foreign/)).not.toBeInTheDocument();
  });

  it("searches the supplied choices and selects a canonical SKU; the same SKU remains selectable again", () => {
    const onSelect = vi.fn();
    render(<div>
      <FocSkuCombobox country="Libya" skus={skuFixtures} onSelect={onSelect} />
      <FocSkuCombobox country="Libya" skus={skuFixtures} onSelect={onSelect} />
    </div>);
    const triggers = screen.getAllByRole("combobox", { name: "SKU" });
    fireEvent.click(triggers[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "Search SKUs" }), { target: { value: "old" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "Mint · 50g · Old" }));
    expect(onSelect).toHaveBeenCalledWith(skuFixtures[0]);
    fireEvent.click(triggers[1]);
    expect(screen.getByRole("option", { name: "Mint · 50g · Old" })).toBeInTheDocument();
  });

  it("keeps pasted identity read-only until explicit selection and submits the selected skuId", async () => {
    render(<RecordFocDialog
      country="Libya"
      periods={periods}
      skus={skuFixtures}
      includeFoc
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Record FOC" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Paste sheet rows/ }), { target: { value:
      "Date\tAcc Type\tSales Manager\tFlavor\tWeight\tPackaging\tQuantity in MC\nSep-26\tExport\tR. Saleh\tMint\t50gr\tOld Packaging\t15" } });
    fireEvent.click(screen.getByRole("button", { name: "Use pasted rows" }));
    expect(screen.getByText("Pasted identity: Mint · 50gr · Old Packaging")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^(Flavor|Weight|Packaging)$/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Month")).toHaveValue("2026-09");
    expect(screen.getByLabelText("Month").tagName).toBe("SELECT");

    fireEvent.click(screen.getByRole("combobox", { name: "SKU" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search SKUs" }), { target: { value: "Mint" } });
    fireEvent.click(screen.getByRole("option", { name: "Mint · 50g · Old" }));
    expect(screen.queryByText("Pasted identity: Mint · 50gr · Old Packaging")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preview all entries/ }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    expect(mocks.preview.mock.calls[0][0].lines[0]).toEqual(expect.objectContaining({
      skuId: 7,
      flavor: "Mint",
      weight: "50g",
      packaging: "Old",
      date: "Sep-26",
      quantityMC: "15",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({ skuId: 7, flavor: "Mint", weight: "50g", packaging: "Old" })],
    })));
  });

  it("does not guess a pasted month into a selectable free-text option", () => {
    render(<RecordFocDialog country="Libya" periods={periods} skus={skuFixtures} includeFoc onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Record FOC" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Paste sheet rows/ }), { target: { value:
      "Date\tAcc Type\tSales Manager\tFlavor\tWeight\tPackaging\tQuantity in MC\nOct-26\tExport\tR. Saleh\tMint\t50gr\tOld Packaging\t15" } });
    fireEvent.click(screen.getByRole("button", { name: "Use pasted rows" }));
    expect(screen.getByText("Pasted month: Oct-26")).toBeInTheDocument();
    expect(screen.getByLabelText("Month")).toHaveValue("");
    expect(within(screen.getByLabelText("Month")).getAllByRole("option")).toHaveLength(2);
  });
});
