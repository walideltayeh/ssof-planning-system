import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import BoardChangesSection from "@/components/performance/BoardChangesSection";
import { PerformanceProvider } from "@/components/performance/PerformanceContext";
import PerformanceHeader from "@/components/performance/PerformanceHeader";
import PresentationMode from "@/components/performance/PresentationMode";
import PresenterNote from "@/components/performance/PresenterNote";
import ScorecardSection from "@/components/performance/ScorecardSection";
import SlideLayoutDialog from "@/components/performance/SlideLayoutDialog";
import { arrangeSections, performanceSections, titleForSection, type OrderedSection } from "@/components/performance/sections";
import { SectionFrame } from "@/components/performance/shared";
import type { CompareMode, PerformanceCountry, PerformanceFilters, PerformanceRequest, PeriodPreset } from "@/components/performance/types";
import { useAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { trpc } from "@/lib/trpc";
import { ChevronDown } from "lucide-react";

const LebanonDeepDive = lazy(() => import("@/pages/AnalysisPage"));
const IntlDeepDive = lazy(() => import("@/pages/IntlAnalysisPage"));
const ALL_COUNTRIES: PerformanceCountry[] = ["Lebanon", "Syria", "Libya", "KSA"];

function cleanFilters(filters: PerformanceFilters): PerformanceFilters | undefined {
  const cleaned: PerformanceFilters = {};
  if (filters.weights?.length) cleaned.weights = filters.weights;
  if (filters.categories?.length) cleaned.categories = filters.categories;
  if (filters.packaging?.length) cleaned.packaging = filters.packaging;
  if (filters.flavours?.length) cleaned.flavours = filters.flavours;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

export default function CountryPerformancePage() {
  const { user, isOwner, isAdminFor } = useAuth();
  const { country: appCountry } = useCountry();
  const countries = useMemo(() => {
    if (isOwner) return ALL_COUNTRIES;
    const allowed = new Set((user?.countries ?? []).map((country) => country.toLowerCase()));
    return ALL_COUNTRIES.filter((country) => allowed.has(country.toLowerCase()));
  }, [isOwner, user?.countries]);
  const initialCountry = (appCountry && countries.includes(appCountry as PerformanceCountry) ? appCountry : countries[0] ?? "Lebanon") as PerformanceCountry;
  const [country, setCountry] = useState<PerformanceCountry>(initialCountry);
  const [preset, setPreset] = useState<PeriodPreset>("ytd");
  const [anchor, setAnchor] = useState<string>();
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [compare, setCompare] = useState<CompareMode>("plan");
  const [filters, setFilters] = useState<PerformanceFilters>({});
  const [refresh, setRefresh] = useState<true | undefined>();
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [deepDiveOpen, setDeepDiveOpen] = useState(false);
  const layoutQuery = trpc.country.slideLayout.useQuery();

  const queryInput = {
    country,
    preset,
    ...(anchor ? { anchor } : {}),
    ...(preset === "custom" && from ? { from } : {}),
    ...(preset === "custom" && to ? { to } : {}),
    compare,
    ...(cleanFilters(filters) ? { filters: cleanFilters(filters) } : {}),
    ...(refresh ? { refresh: true as const } : {}),
  };
  const packQuery = trpc.country.performance.useQuery(queryInput, {
    placeholderData: (previous) => previous,
  });
  const pack = packQuery.data;

  useEffect(() => {
    if (refresh && !packQuery.isFetching) setRefresh(undefined);
  }, [packQuery.isFetching, refresh]);

  const visibleSections = useMemo(
    () => arrangeSections(
      performanceSections.filter((section) => (!section.intlOnly || pack?.meta.isIntl) && (!section.minCountries || countries.length >= section.minCountries) && (!section.available || !pack || section.available(pack))),
      layoutQuery.data,
    ),
    [countries.length, layoutQuery.data, pack],
  );
  const slideSections = useMemo(() => visibleSections.filter((section) => !section.hiddenFromSlides), [visibleSections]);
  const canEdit = isAdminFor(country);
  const request: PerformanceRequest = { country, preset, anchor, from: preset === "custom" ? from : undefined, to: preset === "custom" ? to : undefined, compare, filters: cleanFilters(filters) };


  const openCountry = useCallback((nextCountry: PerformanceCountry) => {
    setCountry(nextCountry);
    setAnchor(undefined);
    setFrom(undefined);
    setTo(undefined);
    setFilters({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const renderSection = useCallback((section: OrderedSection, presentation = false) => {
    if (!pack) return null;
    if (section.id === "scorecard") return <ScorecardSection pack={pack} preset={preset} compare={compare} onOpenCountry={openCountry} presentation={presentation} />;
    if (section.id === "changes") return <BoardChangesSection pack={pack} request={request} presentation={presentation} />;
    return <section.Component pack={pack} presentation={presentation} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, preset, compare, country, anchor, from, to, filters]);

  const exportPdf = useCallback(() => {
    document.body.classList.add("perf-printing");
    const cleanup = () => {
      document.body.classList.remove("perf-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }, []);

  const exportExcel = useCallback(() => {
    const params = new URLSearchParams({ country, preset, compare });
    if (anchor) params.set("anchor", anchor);
    if (preset === "custom" && from) params.set("from", from);
    if (preset === "custom" && to) params.set("to", to);
    (["weights", "categories", "packaging", "flavours"] as const).forEach((key) => {
      if (filters[key]?.length) params.set(key, filters[key]!.join(","));
    });
    window.open(`/api/export-performance?${params.toString()}`, "_blank", "noopener,noreferrer");
  }, [anchor, compare, country, filters, from, preset, to]);

  const isForbidden = packQuery.error?.data?.code === "FORBIDDEN";
  const DeepDive = country === "Lebanon" ? LebanonDeepDive : IntlDeepDive;

  return (
    <PerformanceProvider country={country} periodKey={pack?.meta.periodKey ?? null} canEdit={canEdit}>
    <div className="space-y-8">
      <PerformanceHeader
        country={country}
        countries={countries}
        preset={preset}
        anchor={anchor}
        from={from}
        to={to}
        compare={compare}
        filters={filters}
        meta={pack?.meta}
        isRefreshing={packQuery.isFetching}
        onCountryChange={openCountry}
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
          <h1 className="mt-2 text-5xl font-bold">Country Performance</h1>
          <p className="mt-8 text-2xl">{pack.meta.window.label}</p>
          <p className="mt-2 text-xl">{pack.meta.compareLabel}</p>
          <p className="mt-12">Data as of {pack.meta.dataAsOf ?? "not recorded"}</p>
        </div>
      )}

      <header>
        <h1 className="text-2xl font-bold tracking-tight">Country Performance — {country}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pack ? `${pack.meta.window.label} · ${pack.meta.compareLabel}` : "Plan to sell-out (IMS)"}
        </p>
      </header>

      {pack && (
        <nav className="perf-no-print flex flex-wrap gap-x-4 gap-y-2 border-y py-3" aria-label="Performance pack sections">
          {visibleSections.map((section) => (
            <button key={section.id} type="button" className="text-sm font-medium text-muted-foreground hover:text-[#7f1d1d]" onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth" })}>
              {String(section.number).padStart(2, "0")} {titleForSection(section, pack.meta.isIntl)}
            </button>
          ))}
        </nav>
      )}

      {packQuery.isLoading && !pack && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-64 rounded-xl" />)}
        </div>
      )}

      {packQuery.error && !pack && (
        <Alert variant="destructive">
          <AlertTitle>Country Performance could not be loaded</AlertTitle>
          <AlertDescription>{isForbidden ? "You do not have access to this country" : packQuery.error.message}</AlertDescription>
        </Alert>
      )}

      {pack && (
        <div className="space-y-12">
          {visibleSections.map((section) => {
            const title = titleForSection(section, pack.meta.isIntl);
            return (
              <SectionFrame key={section.id} id={section.id} number={section.number} title={title} subtitle={section.hiddenFromSlides ? "hidden from slides and PDF" : undefined} hiddenFromSlides={section.hiddenFromSlides}>
                {renderSection(section)}
                <PresenterNote sectionId={section.id} />
              </SectionFrame>
            );
          })}
        </div>
      )}

      <section className="perf-no-print border-t pt-6">
        <Collapsible open={deepDiveOpen} onOpenChange={setDeepDiveOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between text-base">
              Deep Dive — existing analysis <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            {appCountry !== country && <p className="mb-3 text-sm text-muted-foreground">Deep Dive shows the app&apos;s active country ({appCountry ?? "not selected"})</p>}
            <Suspense fallback={<Skeleton className="h-80 w-full" />}><DeepDive /></Suspense>
          </CollapsibleContent>
        </Collapsible>
      </section>

      {presentationOpen && pack && <PresentationMode pack={pack} sections={slideSections} onExit={() => setPresentationOpen(false)} renderSection={(section) => renderSection(section, true)} />}
      <SlideLayoutDialog open={layoutOpen} onOpenChange={setLayoutOpen} sections={visibleSections} isIntl={pack?.meta.isIntl ?? false} titleFor={(section) => titleForSection(section, pack?.meta.isIntl ?? false)} />
    </div>
    </PerformanceProvider>
  );
}