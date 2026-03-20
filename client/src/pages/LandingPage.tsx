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
    flag: "\u{1F1F1}\u{1F1E7}",
    label: "Lebanon",
    description: "Al Fakher Lebanon SSOF Planning",
    accentClass: "from-red-500 to-green-600",
    badgeClass: "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
    borderClass: "hover:border-red-300",
  },
  {
    country: "Syria",
    flag: "\u{1F1F8}\u{1F1FE}",
    label: "Syria",
    description: "Al Fakher Syria SSOF Planning",
    accentClass: "from-green-600 to-red-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100",
    borderClass: "hover:border-emerald-300",
  },
  {
    country: "Libya",
    flag: "\u{1F1F1}\u{1F1FE}",
    label: "Libya",
    description: "Al Fakher Libya SSOF Planning",
    accentClass: "from-blue-600 to-green-600",
    badgeClass: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
    borderClass: "hover:border-blue-300",
  },
];

export default function LandingPage() {
  const { setCountry } = useCountry();
  const [, navigate] = useLocation();
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleCountrySelect = (country: Country) => {
    setCountry(country);
    navigate("/login");
  };

  const handleSuperAdmin = () => {
    setCountry("Lebanon");
    navigate("/login?superadmin=1");
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-teal-50 overflow-hidden">
      <style>{`
        @keyframes float-slow {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.05); }
          66% { transform: translate(-20px, 15px) scale(0.97); }
        }
        @keyframes float-slow-reverse {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-25px, 20px) scale(0.96); }
          66% { transform: translate(15px, -25px) scale(1.04); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .bg-orb-1 { animation: float-slow 8s ease-in-out infinite; }
        .bg-orb-2 { animation: float-slow-reverse 10s ease-in-out infinite; }
        .bg-orb-3 { animation: float-slow 12s ease-in-out infinite 2s; }
        .landing-fade-up {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .landing-fade-up.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .landing-scale-in {
          opacity: 0;
          transform: scale(0.92) translateY(20px);
          transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .landing-scale-in.visible {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
        .shimmer-text {
          background: linear-gradient(90deg, #064e3b 0%, #10b981 40%, #064e3b 60%, #10b981 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 4s linear infinite;
        }
      `}</style>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="bg-orb-1 absolute -top-40 -right-40 w-96 h-96 bg-emerald-100/50 rounded-full blur-3xl" />
        <div className="bg-orb-2 absolute -bottom-40 -left-40 w-96 h-96 bg-teal-100/50 rounded-full blur-3xl" />
        <div className="bg-orb-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-50/40 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        <header className="pt-12 pb-6 text-center px-4">
          <div
            className={`landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "0ms" }}
          >
            <img
              src="https://files.manuscdn.com/user_upload_by_module/session_file/310419663029873001/tmVzGaqVMiJyhmCc.png"
              alt="Al Fakher"
              className="h-20 mx-auto mb-4 drop-shadow-lg"
            />
          </div>
          <h1
            className={`text-2xl font-bold tracking-tight landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "120ms" }}
          >
            <span className="shimmer-text">SSOF Planning System</span>
          </h1>
          <p
            className={`text-sm text-gray-500 mt-1 landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "200ms" }}
          >
            Sales, Stock, Orders &amp; Forecast
          </p>
          <div
            className={`mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-gray-200 text-xs text-gray-500 shadow-sm landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "300ms" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Select your country to sign in
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full max-w-3xl">
            {COUNTRY_CARDS.map((card, idx) => (
              <button
                key={card.country}
                onClick={() => handleCountrySelect(card.country)}
                className={`landing-scale-in ${mounted ? "visible" : ""} group relative overflow-hidden rounded-2xl border border-gray-200 ${card.borderClass} bg-white/80 backdrop-blur-sm shadow-lg hover:shadow-xl p-7 text-left transition-all duration-200 hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-emerald-400/50`}
                style={{ transitionDelay: `${450 + idx * 120}ms` }}
              >
                <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${card.accentClass} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/0 group-hover:to-emerald-50/30 transition-all duration-300" />
                <div className="relative">
                  <div className="text-4xl mb-3 leading-none group-hover:scale-110 transition-transform duration-300 inline-block">{card.flag}</div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-0.5">{card.label}</h2>
                  <p className="text-xs text-gray-500 mb-5">{card.description}</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${card.badgeClass}`}>
                    Sign in to {card.label}
                    <svg className="w-3 h-3 group-hover:translate-x-1 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div
            className={`mt-10 text-center landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "900ms" }}
          >
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

        <footer
          className={`text-center pb-8 text-xs text-gray-400 landing-fade-up ${mounted ? "visible" : ""}`}
          style={{ transitionDelay: "1000ms" }}
        >
          Al Fakher &mdash; SSOF Planning System &copy; {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
