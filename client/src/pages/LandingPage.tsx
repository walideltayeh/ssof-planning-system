import { useCountry } from "@/contexts/CountryContext";
import type { Country } from "@/contexts/CountryContext";
import { useLocation } from "wouter";
import { useState } from "react";

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

function FlowAnimation() {
  return (
    <div className="w-full max-w-2xl mx-auto px-4 mb-8">
      <style>{`
        @keyframes ssof-fade-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ssof-flow-wrap {
          animation: ssof-fade-up 0.7s ease-out 0.3s both;
        }
        @keyframes ssof-node-in {
          from { opacity: 0; transform: scale(0.7); }
          to   { opacity: 1; transform: scale(1); }
        }
        .ssof-n1 { animation: ssof-node-in 0.4s cubic-bezier(.34,1.56,.64,1) 0.4s both; }
        .ssof-n2 { animation: ssof-node-in 0.4s cubic-bezier(.34,1.56,.64,1) 0.65s both; }
        .ssof-n3 { animation: ssof-node-in 0.4s cubic-bezier(.34,1.56,.64,1) 0.9s both; }
        .ssof-n4 { animation: ssof-node-in 0.4s cubic-bezier(.34,1.56,.64,1) 1.15s both; }
        @keyframes ssof-connector-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .ssof-c1 { animation: ssof-connector-in 0.3s ease 0.8s both; }
        .ssof-c2 { animation: ssof-connector-in 0.3s ease 1.05s both; }
        .ssof-c3 { animation: ssof-connector-in 0.3s ease 1.3s both; }
        @keyframes ssof-glow {
          0%, 100% { filter: drop-shadow(0 0 0px transparent); }
          50%       { filter: drop-shadow(0 0 6px currentColor); }
        }
      `}</style>

      <p className="text-center text-[10px] tracking-widest uppercase text-gray-400 font-semibold mb-3">
        Integrated Planning Flow
      </p>

      <div className="ssof-flow-wrap rounded-2xl border border-white/70 bg-white/55 backdrop-blur-sm shadow-md p-3 overflow-visible">
        <svg
          viewBox="0 0 640 104"
          className="w-full overflow-visible"
          style={{ height: "clamp(72px, 15vw, 104px)" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <path id="ssof-p1" d="M 103,44 L 211,44" />
            <path id="ssof-p2" d="M 269,44 L 377,44" />
            <path id="ssof-p3" d="M 435,44 L 543,44" />

            <filter id="ssof-glow-orange" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="ssof-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="ssof-glow-purple" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* ── Connector 1: Sales → Stock ───────────────────────── */}
          <g className="ssof-c1">
            <line x1="103" y1="44" x2="205" y2="44" stroke="#fed7aa" strokeWidth="2.5" strokeLinecap="round" />
            <polygon points="213,44 204,39 204,49" fill="#fdba74" />
            <circle r="5.5" fill="#f97316" filter="url(#ssof-glow-orange)">
              <animateMotion dur="1.7s" repeatCount="indefinite" begin="0.8s">
                <mpath href="#ssof-p1" />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.9;0.9;0" dur="1.7s" repeatCount="indefinite" begin="0.8s" />
            </circle>
            <circle r="4" fill="#f97316" opacity="0.5">
              <animateMotion dur="1.7s" repeatCount="indefinite" begin="-0.05s">
                <mpath href="#ssof-p1" />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.5;0.5;0" dur="1.7s" repeatCount="indefinite" begin="-0.05s" />
            </circle>
          </g>

          {/* ── Connector 2: Stock → Orders ──────────────────────── */}
          <g className="ssof-c2">
            <line x1="269" y1="44" x2="371" y2="44" stroke="#bfdbfe" strokeWidth="2.5" strokeLinecap="round" />
            <polygon points="379,44 370,39 370,49" fill="#93c5fd" />
            <circle r="5.5" fill="#3b82f6" filter="url(#ssof-glow-blue)">
              <animateMotion dur="1.7s" repeatCount="indefinite" begin="1.05s">
                <mpath href="#ssof-p2" />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.9;0.9;0" dur="1.7s" repeatCount="indefinite" begin="1.05s" />
            </circle>
            <circle r="4" fill="#3b82f6" opacity="0.5">
              <animateMotion dur="1.7s" repeatCount="indefinite" begin="0.2s">
                <mpath href="#ssof-p2" />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.5;0.5;0" dur="1.7s" repeatCount="indefinite" begin="0.2s" />
            </circle>
          </g>

          {/* ── Connector 3: Orders → Forecast ───────────────────── */}
          <g className="ssof-c3">
            <line x1="435" y1="44" x2="537" y2="44" stroke="#ddd6fe" strokeWidth="2.5" strokeLinecap="round" />
            <polygon points="545,44 536,39 536,49" fill="#c4b5fd" />
            <circle r="5.5" fill="#8b5cf6" filter="url(#ssof-glow-purple)">
              <animateMotion dur="1.7s" repeatCount="indefinite" begin="1.3s">
                <mpath href="#ssof-p3" />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.9;0.9;0" dur="1.7s" repeatCount="indefinite" begin="1.3s" />
            </circle>
            <circle r="4" fill="#8b5cf6" opacity="0.5">
              <animateMotion dur="1.7s" repeatCount="indefinite" begin="0.4s">
                <mpath href="#ssof-p3" />
              </animateMotion>
              <animate attributeName="opacity" values="0;0.5;0.5;0" dur="1.7s" repeatCount="indefinite" begin="0.4s" />
            </circle>
          </g>

          {/* ── Node 1: Sales ────────────────────────────────────── */}
          <g className="ssof-n1">
            <circle cx="75" cy="44" r="29" fill="#fff7ed" stroke="#f97316" strokeWidth="2.2" />
            <text x="75" y="50" textAnchor="middle" dominantBaseline="middle" fill="#f97316" fontSize="17" fontWeight="800" fontFamily="system-ui, sans-serif">S</text>
            <text x="75" y="82" textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Sales</text>
            <text x="75" y="96" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="system-ui, sans-serif">IMS &amp; Invoiced</text>
          </g>

          {/* ── Node 2: Stock ────────────────────────────────────── */}
          <g className="ssof-n2">
            <circle cx="241" cy="44" r="29" fill="#eff6ff" stroke="#3b82f6" strokeWidth="2.2" />
            <text x="241" y="50" textAnchor="middle" dominantBaseline="middle" fill="#3b82f6" fontSize="17" fontWeight="800" fontFamily="system-ui, sans-serif">S</text>
            <text x="241" y="82" textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Stock</text>
            <text x="241" y="96" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="system-ui, sans-serif">Opening &amp; Closing</text>
          </g>

          {/* ── Node 3: Orders ───────────────────────────────────── */}
          <g className="ssof-n3">
            <circle cx="407" cy="44" r="29" fill="#f5f3ff" stroke="#8b5cf6" strokeWidth="2.2" />
            <text x="407" y="50" textAnchor="middle" dominantBaseline="middle" fill="#8b5cf6" fontSize="17" fontWeight="800" fontFamily="system-ui, sans-serif">O</text>
            <text x="407" y="82" textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Orders</text>
            <text x="407" y="96" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="system-ui, sans-serif">Arrivals &amp; Production</text>
          </g>

          {/* ── Node 4: Forecast ─────────────────────────────────── */}
          <g className="ssof-n4">
            <circle cx="573" cy="44" r="29" fill="#ecfdf5" stroke="#10b981" strokeWidth="2.2" />
            <text x="573" y="50" textAnchor="middle" dominantBaseline="middle" fill="#10b981" fontSize="17" fontWeight="800" fontFamily="system-ui, sans-serif">F</text>
            <text x="573" y="82" textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Forecast</text>
            <text x="573" y="96" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="system-ui, sans-serif">Demand Planning</text>
          </g>
        </svg>
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

        {/* Flow animation */}
        <FlowAnimation />

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
