import React, { useCallback, useEffect, useState } from "react";
import type { OrderedSection } from "./sections";
import { titleForSection } from "./sections";
import type { PerformancePack } from "./types";
import PresenterNote from "./PresenterNote";
import { formatUpdateTime } from "./LastUpdatesStrip";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

interface PresentationModeProps {
  pack: PerformancePack;
  /** Slides in presenter order; hidden sections are already filtered out. */
  sections: OrderedSection[];
  onExit: () => void;
  renderSection?: (section: OrderedSection) => React.ReactNode;
  /** "Last update <time> by <user>" for the cover slide. */
  lastUpdateText?: string;
}

export default function PresentationMode({ pack, sections, onExit, renderSection, lastUpdateText }: PresentationModeProps) {
  const [slide, setSlide] = useState(0);
  const total = sections.length + 1;
  const previous = useCallback(() => setSlide((value) => Math.max(0, value - 1)), []);
  const next = useCallback(() => setSlide((value) => Math.min(total - 1, value + 1)), [total]);
  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onExit();
  }, [onExit]);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (["ArrowRight", " ", "PageDown"].includes(event.key)) { event.preventDefault(); next(); }
      else if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); previous(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [close, next, previous]);

  const section = slide > 0 ? sections[slide - 1] : null;
  const SectionComponent = section?.Component;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      <div className="flex min-h-screen flex-col p-6 md:p-10">
        {slide === 0 ? (
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center border-t-8 border-[#7f1d1d]">
            <p className="mt-8 text-xl font-semibold text-[#7f1d1d]">{pack.meta.country}</p>
            <h1 className="mt-3 text-5xl font-bold tracking-tight md:text-7xl">Country Performance</h1>
            <p className="mt-8 text-2xl">{pack.meta.window.label}</p>
            <p className="mt-2 text-xl text-muted-foreground">{pack.meta.compareLabel}</p>
            <div className="mt-16 grid gap-2 text-base text-muted-foreground">
              <p>Data as of {pack.meta.dataAsOf ? formatUpdateTime(pack.meta.dataAsOf) : "not recorded"}</p>
              {lastUpdateText && <p>{lastUpdateText}</p>}
              <p>Generated {new Date(pack.meta.generatedAt).toLocaleString()}</p>
            </div>
          </div>
        ) : section && SectionComponent ? (
          <div className="mx-auto w-full max-w-[1500px] flex-1">
            <header className="mb-6 flex items-baseline gap-4 border-t-8 border-[#7f1d1d] pt-4">
              <span className="text-lg font-bold tracking-widest text-[#7f1d1d]">{String(slide).padStart(2, "0")}</span>
              <h1 className="text-3xl font-bold">{titleForSection(section, pack.meta.isIntl)}</h1>
            </header>
            <div className="text-base">{renderSection ? renderSection(section) : <SectionComponent pack={pack} presentation />}</div>
            <div className="mt-6"><PresenterNote sectionId={section.id} presentation /></div>
          </div>
        ) : null}
        <footer className="mt-6 flex items-center gap-2 border-t pt-3">
          <span className="mr-auto text-sm text-muted-foreground">{slide + 1} / {total} · Data as of {pack.meta.dataAsOf ? formatUpdateTime(pack.meta.dataAsOf) : "not recorded"}</span>
          <Button variant="outline" onClick={previous} disabled={slide === 0}><ArrowLeft />Prev</Button>
          <Button variant="outline" onClick={next} disabled={slide === total - 1}>Next<ArrowRight /></Button>
          <Button variant="outline" onClick={close}><X />Exit</Button>
        </footer>
      </div>
    </div>
  );
}