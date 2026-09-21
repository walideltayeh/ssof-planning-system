/**
 * Lets the presenter hide/show and reorder slides. The layout is saved per user
 * and applies to the page order, Presentation Mode and the PDF.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import type { OrderedSection, SlideLayout } from "./sections";
import { performanceSections } from "./sections";

interface SlideLayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: OrderedSection[];
  isIntl: boolean;
  titleFor: (section: OrderedSection) => string;
}

export default function SlideLayoutDialog({ open, onOpenChange, sections, titleFor }: SlideLayoutDialogProps) {
  const utils = trpc.useUtils();
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const save = trpc.country.saveSlideLayout.useMutation({
    onSuccess: (layout: SlideLayout) => {
      utils.country.slideLayout.setData(undefined, layout);
      onOpenChange(false);
    },
  });

  // Seed the draft only when the dialog opens; a background refetch of the
  // pack must not wipe edits in progress.
  const latestSections = useRef(sections);
  latestSections.current = sections;
  useEffect(() => {
    if (!open) return;
    const current = latestSections.current;
    setOrder(current.map((s) => s.id));
    setHidden(new Set(current.filter((s) => s.hiddenFromSlides).map((s) => s.id)));
  }, [open]);

  const byId = new Map(sections.map((s) => [s.id, s]));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };
  const reset = () => {
    setOrder(performanceSections.map((s) => s.id).filter((id) => byId.has(id)));
    setHidden(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Arrange slides</DialogTitle>
          <DialogDescription>Choose which sections appear and in what order. Hidden sections stay on the page but are left out of Presentation Mode and the PDF. Saved for your account only.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-1">
          {order.map((id, index) => {
            const section = byId.get(id);
            if (!section) return null;
            const isHidden = hidden.has(id);
            return (
              <li key={id} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", isHidden && "opacity-60")}>
                <Checkbox
                  checked={!isHidden}
                  onCheckedChange={(checked) => setHidden((prev) => { const next = new Set(prev); if (checked) next.delete(id); else next.add(id); return next; })}
                  aria-label={`Show ${titleFor(section)}`}
                />
                <span className="w-6 text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <span className="flex-1 text-sm">{titleFor(section)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label="Move down"><ArrowDown /></Button>
              </li>
            );
          })}
        </ol>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={reset}><RotateCcw />Default order</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => save.mutate({ order, hidden: [...hidden] })} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save layout"}</Button>
          </div>
        </DialogFooter>
        {save.error && <p className="text-xs text-red-700">{save.error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}
