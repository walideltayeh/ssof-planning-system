import { useCountry } from "@/contexts/CountryContext";
import type { Country } from "@/contexts/CountryContext";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";

const COUNTRY_CARDS: {
  country: Country;
  flag: string;
  label: string;
  description: string;
  accentClass: string;
  badgeClass: string;
  borderClass: string;
}[] = [
  {
    country: "Lebanon",
    flag: "🇱🇧",
    label: "Lebanon",
    description: "Al Fakher Lebanon SSOF Planning",
    accentClass: "from-red-500 to-green-600",
    badgeClass: "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
    borderClass: "hover:border-red-300",
  },
  {
    country: "Syria",
    flag: "🇸🇾",
    label: "Syria",
    description: "Al Fakher Syria SSOF Planning",
    accentClass: "from-green-600 to-red-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100",
    borderClass: "hover:border-emerald-300",
  },
  {
    country: "Libya",
    flag: "🇱🇾",
    label: "Libya",
    description: "Al Fakher Libya SSOF Planning",
    accentClass: "from-blue-600 to-green-600",
    badgeClass: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
    borderClass: "hover:border-blue-300",
  },
];

const MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const MAX_WEEKS = 13;
const MIN_HEALTHY = 4;
const MAX_HEALTHY = 8;
const CHART_H = 130;

const CHAOTIC_WEEKS = [1.5, 10.5, 2, 11.5, 2.5, 9.5];
const HEALTHY_WEEKS = [5, 6.5, 5.5, 7, 6, 5.5];

const toH = (w: number) => (w / MAX_WEEKS) * CHART_H;

const BAND_BOTTOM = toH(MIN_HEALTHY);
const BAND_HEIGHT = toH(MAX_HEALTHY) - toH(MIN_HEALTHY);

type Phase = "init" | "chaotic" | "healthy" | "resetting";

function StockAnimation() {
  const [phase, setPhase] = useState<Phase>("init");

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      setPhase("init");
      timers.push(setTimeout(() => setPhase("chaotic"), 120));
      timers.push(setTimeout(() => setPhase("healthy"), 2800));
      timers.push(setTimeout(() => setPhase("resetting"), 5400));
      timers.push(setTimeout(run, 5900));
    };

    run();
    return () => timers.forEach(clearTimeout);
  }, []);

  const isHealthy = phase === "healthy";
  const isResetting = phase === "resetting";
  const isInit = phase === "init";

  return (
    <div className="w-full max-w-2xl mx-auto px-4 mb-8">
      <style>{`
        @keyframes land-fadein {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .land-card { animation: land-fadein 0.6s ease-out 0.2s both; }
        @keyframes land-check-pop {
          0%   { transform: scale(0.5); opacity: 0; }
          70%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .land-check { animation: land-check-pop 0.4s cubic-bezier(.34,1.56,.64,1) both; }
        @keyframes land-line-draw {
          from { stroke-dashoffset: 200; }
          to   { stroke-dashoffset: 0; }
        }
        .land-minline { animation: land-line-draw 0.6s ease 0.3s both; stroke-dasharray: 200; }
        .land-maxline { animation: land-line-draw 0.6s ease 0.5s both; stroke-dasharray: 200; }
      `}</style>

      <div className="land-card rounded-2xl border border-white/70 bg-white/60 backdrop-blur-sm shadow-lg px-5 pt-4 pb-3 overflow-hidden">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm font-bold text-gray-800 leading-tight">Closing Stock Health</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Weeks of coverage · target range: {MIN_HEALTHY}–{MAX_HEALTHY} wks</p>
          </div>
          <div
            key={phase}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors duration-500 ${
              isHealthy
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : isResetting || isInit
                ? "bg-gray-50 text-gray-400 border-gray-200"
                : "bg-red-50 text-red-600 border-red-200"
            }`}
          >
            {isHealthy ? (
              <span className="land-check inline-flex items-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5.5" fill="#10b981" />
                  <path d="M3.5 6l1.8 1.8 3-3.6" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Healthy range
              </span>
            ) : isResetting || isInit ? (
              "Analysing…"
            ) : (
              <>
                <svg className="w-3 h-3 text-red-500" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 1L11.2 10H.8L6 1z" />
                  <path d="M6 4.5v2.5M6 8.5h.01" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
                Needs planning
              </>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="relative" style={{ height: `${CHART_H}px` }}>
          {/* Healthy zone band */}
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ bottom: `${BAND_BOTTOM}px`, height: `${BAND_HEIGHT}px`, backgroundColor: "rgba(209,250,229,0.55)", borderTop: "1.5px dashed #6ee7b7", borderBottom: "1.5px dashed #6ee7b7" }}
          />

          {/* Max label */}
          <span
            className="absolute right-0 text-[9px] font-semibold text-emerald-600"
            style={{ bottom: `${BAND_BOTTOM + BAND_HEIGHT}px`, transform: "translateY(50%)" }}
          >
            {MAX_HEALTHY} wks
          </span>

          {/* Min label */}
          <span
            className="absolute right-0 text-[9px] font-semibold text-emerald-600"
            style={{ bottom: `${BAND_BOTTOM}px`, transform: "translateY(50%)" }}
          >
            {MIN_HEALTHY} wks
          </span>

          {/* Bars */}
          <div className="absolute inset-0 flex items-end justify-around pr-9">
            {CHAOTIC_WEEKS.map((chaosW, i) => {
              const healthyH = toH(HEALTHY_WEEKS[i]);
              const chaoticH = toH(chaosW);

              let targetH: number;
              if (isInit) targetH = 0;
              else if (isResetting) targetH = 0;
              else if (isHealthy) targetH = healthyH;
              else targetH = chaoticH;

              const isAbove = chaosW > MAX_HEALTHY;
              const barColor = isHealthy
                ? "#10b981"
                : isResetting || isInit
                ? "#d1d5db"
                : isAbove
                ? "#f97316"
                : "#ef4444";

              const delay = isResetting
                ? `${(CHAOTIC_WEEKS.length - 1 - i) * 50}ms`
                : `${i * 90}ms`;

              const duration = isResetting ? "250ms" : isHealthy ? "500ms" : "450ms";
              const easing = isResetting
                ? "ease-in"
                : "cubic-bezier(0.34, 1.4, 0.64, 1)";

              return (
                <div
                  key={i}
                  className="rounded-t-sm"
                  style={{
                    width: "13.5%",
                    height: `${targetH}px`,
                    backgroundColor: barColor,
                    transition: `height ${duration} ${easing} ${delay}, background-color 0.45s ease ${delay}`,
                    willChange: "height",
                    minWidth: "28px",
                    maxWidth: "52px",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Month labels */}
        <div className="flex justify-around pr-9 mt-1.5">
          {MONTHS.map((m) => (
            <span
              key={m}
              className="text-[10px] text-gray-400 text-center font-medium"
              style={{ width: "13.5%", minWidth: "28px", maxWidth: "52px" }}
            >
              {m}
            </span>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 border-t border-gray-100 pt-2.5">
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
            Understocked
          </span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />
            Overstocked
          </span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            In target range
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { setCountry } = useCountry();
  const [, navigate] = useLocation();
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);

  const handleCountrySelect = (country: Country) => {
    setCountry(country);
    navigate("/login");
  };

  const handleSuperAdmin = () => {
    setCountry("Lebanon");
    navigate("/login?superadmin=1");
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-teal-50">
      {/* Background decorative blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-100/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-50/30 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        {/* Header */}
        <header className="pt-12 pb-6 text-center px-4">
          <img
            src="https://files.manuscdn.com/user_upload_by_module/session_file/310419663029873001/tmVzGaqVMiJyhmCc.png"
            alt="Al Fakher"
            className="h-20 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            SSOF Planning System
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Sales, Stock, Orders &amp; Forecast
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-gray-200 text-xs text-gray-500 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Select your country to sign in
          </div>
        </header>

        {/* Stock animation */}
        <StockAnimation />

        {/* Country Cards */}
        <main className="flex flex-col items-center justify-center px-4 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full max-w-3xl">
            {COUNTRY_CARDS.map((card) => (
              <button
                key={card.country}
                onClick={() => handleCountrySelect(card.country)}
                className={`group relative overflow-hidden rounded-2xl border border-gray-200 ${card.borderClass} bg-white/80 backdrop-blur-sm shadow-lg hover:shadow-xl p-7 text-left transition-all duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-emerald-400/50`}
              >
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${card.accentClass} opacity-70 group-hover:opacity-100 transition-opacity`} />
                <div className="text-4xl mb-3 leading-none">{card.flag}</div>
                <h2 className="text-lg font-semibold text-gray-800 mb-0.5">{card.label}</h2>
                <p className="text-xs text-gray-500 mb-5">{card.description}</p>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${card.badgeClass}`}>
                  Sign in to {card.label}
                  <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            ))}
          </div>

          {/* Super Admin entry */}
          <div className="mt-10 text-center">
            {!showSuperAdmin ? (
              <button
                onClick={() => setShowSuperAdmin(true)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-4"
              >
                Super Admin Access
              </button>
            ) : (
              <div className="flex flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="bg-white/80 backdrop-blur-sm border border-amber-200 rounded-xl px-5 py-4 shadow-md max-w-xs w-full text-center">
                  <p className="text-xs text-gray-500 mb-3">
                    Super Admin access grants visibility across all three countries.
                  </p>
                  <button
                    onClick={handleSuperAdmin}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow hover:from-amber-600 hover:to-orange-600 hover:shadow-lg transition-all hover:scale-[1.02]"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Sign in as Super Admin
                  </button>
                  <button
                    onClick={() => setShowSuperAdmin(false)}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="text-center pb-8 text-xs text-gray-400">
          Al Fakher &mdash; SSOF Planning System &copy; {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
