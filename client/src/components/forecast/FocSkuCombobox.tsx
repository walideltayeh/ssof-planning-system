import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { FocMatchSku } from "@shared/focEntry";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function focSkuLabel(sku: FocMatchSku) {
  return `${sku.name} · ${sku.weight} · ${sku.packagingType ?? "New"}`;
}

export function FocSkuCombobox({
  country,
  skus,
  selectedSkuId,
  onSelect,
}: {
  country: string;
  skus: FocMatchSku[];
  selectedSkuId?: number;
  onSelect: (sku: FocMatchSku | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const availableSkus = useMemo(
    () => skus.filter(sku => sku.isActive !== false && (!sku.country || sku.country === country)),
    [country, skus],
  );
  const matchingSkus = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return availableSkus;
    return availableSkus.filter(sku => focSkuLabel(sku).toLocaleLowerCase().includes(query));
  }, [availableSkus, search]);
  const selected = availableSkus.find(sku => sku.id === selectedSkuId);

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="SKU"
          aria-expanded={open}
          className="mt-1 h-7 w-full justify-between gap-1 rounded px-2 text-left text-xs font-normal"
        >
          <span className="truncate">{selected ? focSkuLabel(selected) : "Select SKU"}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={3}
        className="z-[70] w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
      >
        <Command label="Search SKUs" shouldFilter={false} className="max-h-[min(20rem,45vh)]">
            <CommandInput
              aria-label="Search SKUs"
              placeholder="Search name, weight, packaging…"
              value={search}
              onValueChange={setSearch}
              className="h-8 text-xs"
            />
          <CommandList className="max-h-[min(17rem,40vh)]">
            <CommandEmpty className="py-4 text-xs">No matching SKU. Choose from the listed country SKUs.</CommandEmpty>
            <CommandGroup>
              {matchingSkus.map(sku => (
                <CommandItem
                  key={sku.id}
                  value={String(sku.id)}
                  onSelect={() => { onSelect(sku); setOpen(false); setSearch(""); }}
                  className="min-h-8 text-xs"
                >
                  <span className="truncate">{focSkuLabel(sku)}</span>
                  <Check className={`ml-auto h-3.5 w-3.5 shrink-0 ${selectedSkuId === sku.id ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
