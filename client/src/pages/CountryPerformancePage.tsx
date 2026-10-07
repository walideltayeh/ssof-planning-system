import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import BoardChangesSection from "@/components/performance/BoardChangesSection";
import DeepDiveDisclosure from "@/components/performance/DeepDiveDisclosure";
import { PerformanceProvider } from "@/components/performance/PerformanceContext";
import PerformanceHeader from "@/components/performance/PerformanceHeader";
import PresentationMode from "@/components/performance/PresentationMode";
import PresenterNote from "@/components/performance/PresenterNote";
import SlideLayoutDialog from "@/components/performance/SlideLayoutDialog";
import { arrangeSections, performanceSections, titleForSection, type OrderedSection } from "@/components/performance/sections";
import {
  getInitialPerformanceTab,
  PERFORMANCE_TABS,
  rememberPerformanceTab,
  accessiblePerformanceCountries,
  sectionsForPrint,
  sectionsForTab,
  type PerformanceTabId,
} from "@/components/performance/navigation";
import { SectionFrame } from "@/components/performance/shared";
import type { CompareMode, PerformanceCountry, PerformanceFilters, PerformanceRequest, PeriodPreset } from "@/components/performance/types";
import { useAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { formatUpdateTime, lastUpdateSentence, useLastUpdates } from "@/hooks/useLastUpdates";
import { trpc } from "@/lib/trpc";
import { Check } from "lucide-react";
import { useIncludeFoc } from "@/hooks/useIncludeFoc";

const LebanonDeepDive = lazy(() => import("@/pages/AnalysisPage"));
const IntlDeepDive = lazy(() => import("@/pages/IntlAnalysisPage"));

function cleanFilters(filters: PerformanceFilters): PerformanceFilters | undefined {
  const cleaned: PerformanceFilters = {};
  if (filters.weights?.length) cleaned.weights = filters.weights;
  if (filters.categories?.length) cleaned.categories = filters.categories;
  if (filters.packaging?.length) cleaned.packaging = filters.packaging;
  if (filters.flavours?.length) cleaned.flavours = filters.flavours;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

export default function CountryPerformancePage() {
  const { isAdminFor, user, canAccessCountry } = useAuth();
  const { country: appCountry, setCountry } = useCountry();
  // The page always shows the country selected in the sidebar — nothing else.
  const country = (appCountry ?? "Lebanon") as PerformanceCountry;
  const [preset, setPreset] = useState<PeriodPreset>("ytd");
  const [anchor, setAnchor] = useState<string>();
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [compare, setCompare] = useState<CompareMode>("plan");
  const [filters, setFilters] = useState<PerformanceFilters>({});
  const supportsFoc = country === "Libya" || country === "Syria";
  const focCountry = supportsFoc ? country as "Libya" | "Syria" : "Libya";
  const { includeFoc, setIncludeFoc } = useIncludeFoc(focCountry);
  const [refresh, setRefresh] = useState<true | undefined>();
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PerformanceTabId>(() =>
    getInitialPerformanceTab(user?.id, typeof window === "undefined" ? undefined : window.localStorage),
  );
  const tabUserId = useRef(user?.id);
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const layoutQuery = trpc.country.slideLayout.useQuery();
  const lastUpdates = useLastUpdates();

  const queryInput = {
    country,
    preset,
    ...(anchor ? { anchor } : {}),
    ...(preset === "custom" && from ? { from } : {}),
    ...(preset === "custom" && to ? { to } : {}),
    compare,
    ...(supportsFoc ? { includeFoc } : {}),
    ...(cleanFilters(filters) ? { filters: cleanFilters(filters) } : {}),
    ...(refresh ? { refresh: true as const } : {}),
  };
  const packQuery = trpc.country.performance.useQuery(queryInput, {
    // Keep the previous pack on screen while a period/filter change loads, but
    // never show one country's numbers under another country's name.
    placeholderData: (previous) => (previous && previous.meta.country === country ? previous : undefined),
  });
  const pack = packQuery.data;

  useEffect(() => {
    if (refresh && !packQuery.isFetching) setRefresh(undefined);
  }, [packQuery.isFetching, refresh]);

  const visibleSections = useMemo(
    () => arrangeSections(
      performanceSections.filter((section) => (!section.intlOnly || pack?.meta.isIntl) && (!section.available || !pack || section.available(pack))),
      layoutQuery.data,
    ),
    [layoutQuery.data, pack],
  );
  const slideSections = useMemo(() => visibleSections.filter((section) => !section.hiddenFromSlides), [visibleSections]);
  const activeSections = useMemo(() => sectionsForTab(visibleSections, activeTab), [visibleSections, activeTab]);
  const printableSections = useMemo(() => sectionsForPrint(visibleSections), [visibleSections]);
  const accessibleCountries = useMemo(
    () => accessiblePerformanceCountries(user, ["Lebanon", "Syria", "Libya", "KSA"], (name) => canAccessCountry(name as "Lebanon" | "Syria" | "Libya" | "KSA")),
    [user, canAccessCountry],
  );
  const canEdit = isAdminFor(country);
  const lastUpdate = lastUpdates.data?.find((row) => row.country === country);
  const request: PerformanceRequest = { country, preset, anchor, from: preset === "custom" ? from : undefined, to: preset === "custom" ? to : undefined, compare, filters: cleanFilters(filters), ...(supportsFoc ? { includeFoc } : {}) };


  const renderSection = useCallback((section: OrderedSection, presentation = false) => {
    if (!pack) return null;
    const content = section.id === "changes"
      ? <BoardChangesSection pack={pack} request={request} presentation={presentation} />
      : <section.Component pack={pack} presentation={presentation} />;
    return <>{pack.foc && <p className="mb-3 rounded-md border border-[#7f1d1d]/15 bg-[#7f1d1d]/[0.035] px-3 py-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Derived using {pack.foc.basisLabel}.</span> IMS and commercial values exclude planned FOC; actual stock reflects recorded movements only.</p>}{content}</>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, preset, compare, country, anchor, from, to, filters, includeFoc]);

  useEffect(() => {
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    if (tabUserId.current !== user?.id) {
      tabUserId.current = user?.id;
      setActiveTab(getInitialPerformanceTab(user?.id, storage));
      return;
    }
    rememberPerformanceTab(user?.id, activeTab, storage);
  }, [activeTab, user?.id]);

  const exportPdf = useCallback(() => {
    if (packQuery.isFetching || !pack || printingRef.current) return;
    printingRef.current = true;
    document.body.classList.add("perf-printing");
    const cleanup = () => {
      document.body.classList.remove("perf-printing");
      window.removeEventListener("afterprint", cleanup);
      printingRef.current = false;
      setPrinting(false);
    };
    window.addEventListener("afterprint", cleanup);
    flushSync(() => setPrinting(true));
    try {
      window.print();
    } catch {
      cleanup();
    }
  }, [pack, packQuery.isFetching]);

  const { unit } = useUnit();
  const exportExcel = useCallback(() => {
    const params = new URLSearchParams({ country, preset, compare, unit });
    if (packQuery.isFetching) return;
    if (supportsFoc) params.set("includeFoc", String(includeFoc));
    if (anchor) params.set("anchor", anchor);
    if (preset === "custom" && from) params.set("from", from);
    if (preset === "custom" && to) params.set("to", to);
    (["weights", "categories", "packaging", "flavours"] as const).forEach((key) => {
      if (filters[key]?.length) params.set(key, filters[key]!.join(","));
    });
    window.open(`/api/export-performance?${params.toString()}`, "_blank", "noopener,noreferrer");
  }, [anchor, compare, country, filters, from, preset, to, unit, supportsFoc, includeFoc, packQuery.isFetching]);

  const isForbidden = packQuery.error?.data?.code === "FORBIDDEN";
  const DeepDive = country === "Lebanon" ? LebanonDeepDive : IntlDeepDive;

  return (
    <PerformanceProvider country={country} periodKey={pack?.meta.periodKey ?? null} canEdit={canEdit}>
    <div className="space-y-8">
      <PerformanceHeader
        includeFoc={includeFoc}
        onIncludeFocChange={supportsFoc ? setIncludeFoc : undefined}
        preset={preset}
        anchor={anchor}
        from={from}
        to={to}
        compare={compare}
        filters={filters}
        meta={pack?.meta}
        lastUpdateText={lastUpdates.data ? lastUpdateSentence(lastUpdate) : undefined}
        isRefreshing={packQuery.isFetching}
        onPresetChange={(value) => { setPreset(value); setFrom(undefined); setTo(undefined); }}
        onAnchorChange={setAnchor}
        onFromChange={setFrom}
        onToChange={setTo}
        onCompareChange={setCompare}
        onFiltersChange={setFilters}
        onRefresh={() => setRefresh(true)}
        onPresentation={() => setPresentationOpen(true)}
        onArrangeSlides={() => setLayoutOpen(true)}
        onExportPdf={exportPdf}
        onExportExcel={exportExcel}
      />

      {pack && (
        <div className="perf-print-cover hidden border-t-8 border-[#7f1d1d] pt-8">
          <p className="text-xl font-semibold text-[#7f1d1d]">{country}</p>
          <h1 className="mt-2 text-5xl font-bold">Analysis</h1>
          <p className="mt-8 text-2xl">{pack.meta.window.label}</p>
          <p className="mt-2 text-xl">{pack.meta.compareLabel}</p>
          <p className="mt-12">Data as of {pack.meta.dataAsOf ? formatUpdateTime(pack.meta.dataAsOf) : "not recorded"}</p>
          {lastUpdates.data && <p className="mt-1">{lastUpdateSentence(lastUpdate)}</p>}
        </div>
      )}

      <header>
        <h1 className="text-2xl font-bold tracking-tight">Analysis — {country}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pack ? `${pack.meta.window.label} · ${pack.meta.compareLabel}` : "Plan to sell-out (IMS)"}
        </p>
      </header>

      {pack?.foc && (
        <p className="rounded-md border border-[#7f1d1d]/20 bg-[#7f1d1d]/[0.035] px-4 py-3 text-sm">
          <strong>FOC planning basis: {pack.foc.basisLabel}.</strong> {pack.foc.note}
        </p>
      )}
      {packQuery.isLoading && !pack && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-64 rounded-xl" />)}
        </div>
      )}

      {packQuery.error && !pack && (
        <Alert variant="destructive">
          <AlertTitle>Analysis could not be loaded</AlertTitle>
          <AlertDescription>{isForbidden ? "You do not have access to this country" : packQuery.error.message}</AlertDescription>
        </Alert>
      )}

      {pack && (
        <>
          <div className="perf-no-print sticky top-0 z-30 -mx-4 border-y border-[#7f1d1d]/15 bg-background/95 px-4 py-2 shadow-[0_8px_18px_-18px_rgba(75,18,31,0.75)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <nav className="mx-auto flex max-w-full gap-1 overflow-x-auto" role="tablist" aria-label="Analysis working groups">
              {PERFORMANCE_TABS.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`analysis-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="analysis-tab-panel"
                    tabIndex={selected ? 0 : -1}
                    className={`relative min-h-11 shrink-0 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f1d1d] ${selected ? "bg-[#7f1d1d] text-white shadow-sm" : "text-muted-foreground hover:bg-[#7f1d1d]/[0.07] hover:text-foreground"}`}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const index = PERFORMANCE_TABS.findIndex((item) => item.id === activeTab);
                      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? PERFORMANCE_TABS.length - 1
                        : (index + (event.key === "ArrowRight" ? 1 : -1) + PERFORMANCE_TABS.length) % PERFORMANCE_TABS.length;
                      const next = PERFORMANCE_TABS[nextIndex];
                      setActiveTab(next.id);
                      document.getElementById(`analysis-tab-${next.id}`)?.focus();
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div id="analysis-tab-panel" role="tabpanel" aria-labelledby={`analysis-tab-${activeTab}`} className="perf-screen-tree space-y-8 pt-2">
            {activeSections.map((section) => (
              <SectionFrame
                key={section.id}
                id={section.id}
                number={section.number}
                title={titleForSection(section, pack.meta.isIntl)}
                subtitle={section.hiddenFromSlides ? "hidden from slides and PDF" : undefined}
                hiddenFromSlides={section.hiddenFromSlides}
              >
                {renderSection(section)}
                <PresenterNote sectionId={section.id} />
              </SectionFrame>
            ))}

            {activeTab === "value" && (
              <section aria-labelledby="all-countries-heading" className="rounded-xl border border-[#7f1d1d]/15 bg-[#7f1d1d]/[0.025] p-4 md:p-5">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#7f1d1d]/20 pb-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7f1d1d]">Country access</p>
                    <h2 id="all-countries-heading" className="mt-1 text-lg font-bold">All Countries</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">Switch the active country to view its analysis. Only your permitted countries are shown.</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {accessibleCountries.map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-current={name === country ? "page" : undefined}
                      onClick={() => setCountry(name as "Lebanon" | "Syria" | "Libya" | "KSA")}
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition ${name === country ? "border-[#7f1d1d]/40 bg-[#7f1d1d]/10 text-[#7f1d1d]" : "border-border bg-background hover:border-[#7f1d1d]/35 hover:bg-[#7f1d1d]/[0.04]"}`}
                    >
                      {name === country && <Check className="h-4 w-4" aria-hidden="true" />}
                      {name}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          {printing && (
            <div className="perf-print-tree space-y-8">
              {printableSections.map((section) => (
                <SectionFrame
                  key={`print-${section.id}`}
                  id={`print-${section.id}`}
                  number={section.number}
                  title={titleForSection(section, pack.meta.isIntl)}
                  subtitle={section.hiddenFromSlides ? "hidden from slides and PDF" : undefined}
                  hiddenFromSlides={section.hiddenFromSlides}
                >
                  {renderSection(section)}
                  <PresenterNote sectionId={section.id} />
                </SectionFrame>
              ))}
            </div>
          )}
        </>
      )}

      <DeepDiveDisclosure>
        <Suspense fallback={<Skeleton className="h-80 w-full" />}><DeepDive /></Suspense>
      </DeepDiveDisclosure>

      {presentationOpen && pack && <PresentationMode pack={pack} sections={slideSections} lastUpdateText={lastUpdates.data ? lastUpdateSentence(lastUpdate) : undefined} onExit={() => setPresentationOpen(false)} renderSection={(section) => renderSection(section, true)} />}
      <SlideLayoutDialog open={layoutOpen} onOpenChange={setLayoutOpen} sections={visibleSections} isIntl={pack?.meta.isIntl ?? false} titleFor={(section) => titleForSection(section, pack?.meta.isIntl ?? false)} />
    </div>
    </PerformanceProvider>
  );
}