import { useState, useEffect } from "react";
import { useAppAuth } from "@/contexts/AuthContext";
import type { Country } from "@/contexts/AuthContext";
import { COUNTRY_CONFIG } from "@/contexts/CountryContext";
import { useLocation } from "wouter";

const ALL_COUNTRIES: Country[] = ["Lebanon", "Syria", "Libya"];

const CARD_STYLES: Record<Country, { accentClass: string; badgeClass: string; borderClass: string }> = {
  Lebanon: {
    accentClass: "from-red-500 to-green-600",
    badgeClass: "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
    borderClass: "hover:border-red-300",
  },
  Syria: {
    accentClass: "from-green-600 to-red-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100",
    borderClass: "hover:border-emerald-300",
  },
  Libya: {
    accentClass: "from-blue-600 to-green-600",
    badgeClass: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
    borderClass: "hover:border-blue-300",
  },
};

export default function CountrySelectorPage() {
  const { user, setCountry, logout } = useAppAuth();
  const [, navigate] = useLocation();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  if (!user) return null;

  const userCountries = user.isOwner
    ? ALL_COUNTRIES
    : ALL_COUNTRIES.filter(c => user.countries.includes(c));

  const handleSelect = (country: Country) => {
    setCountry(country);
    navigate("/");
  };

  const gridCols = userCountries.length === 2 ? "md:grid-cols-2" : userCountries.length >= 3 ? "md:grid-cols-3" : "";

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
        .bg-orb-1 { animation: float-slow 8s ease-in-out infinite; }
        .bg-orb-2 { animation: float-slow-reverse 10s ease-in-out infinite; }
        .landing-scale-in {
          opacity: 0;
          transform: scale(0.92) translateY(20px);
          transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .landing-scale-in.visible {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
        .landing-fade-up {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .landing-fade-up.visible {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="bg-orb-1 absolute -top-40 -right-40 w-96 h-96 bg-emerald-100/50 rounded-full blur-3xl" />
        <div className="bg-orb-2 absolute -bottom-40 -left-40 w-96 h-96 bg-teal-100/50 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col flex-1 items-center justify-center px-4">
        <div className="text-center mb-8">
          <div
            className={`landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "0ms" }}
          >
            <img
              src="https://files.manuscdn.com/user_upload_by_module/session_file/310419663029873001/tmVzGaqVMiJyhmCc.png"
              alt="Al Fakher"
              className="h-16 mx-auto mb-3 drop-shadow-lg"
            />
          </div>
          <h1
            className={`text-xl font-bold tracking-tight text-gray-800 landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "100ms" }}
          >
            Welcome, {user.displayName}
          </h1>
          <p
            className={`text-sm text-gray-500 mt-1 landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "180ms" }}
          >
            {userCountries.length === 0
              ? "No countries are available for your account"
              : "Select a country to continue"}
          </p>
        </div>

        {userCountries.length === 0 ? (
          <div
            className={`landing-scale-in ${mounted ? "visible" : ""} w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/80 backdrop-blur-sm shadow-lg p-7 text-center`}
            style={{ transitionDelay: "300ms" }}
            role="status"
            data-testid="no-countries-empty-state"
          >
            <div className="text-4xl mb-3 leading-none">🔒</div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">
              You don't have access to any countries yet
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Ask your workspace owner to grant you access to a country before
              you can continue.
            </p>
            <a
              href="mailto:?subject=Requesting%20country%20access%20for%20SSOF%20Planning&body=Hi%2C%0A%0ACould%20you%20please%20grant%20me%20access%20to%20a%20country%20in%20the%20SSOF%20Planning%20app%3F%20Thanks!"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 transition-all"
              data-testid="link-contact-owner"
            >
              Contact the workspace owner
            </a>
          </div>
        ) : (
        <div className={`grid grid-cols-1 ${gridCols} gap-5 w-full max-w-3xl`}>
          {userCountries.map((country, idx) => {
            const config = COUNTRY_CONFIG[country];
            const styles = CARD_STYLES[country];
            return (
              <button
                key={country}
                onClick={() => handleSelect(country)}
                className={`landing-scale-in ${mounted ? "visible" : ""} group relative overflow-hidden rounded-2xl border border-gray-200 ${styles.borderClass} bg-white/80 backdrop-blur-sm shadow-lg hover:shadow-xl p-7 text-left transition-all duration-200 hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-emerald-400/50`}
                style={{ transitionDelay: `${300 + idx * 120}ms` }}
              >
                <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${styles.accentClass} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/0 group-hover:to-emerald-50/30 transition-all duration-300" />
                <div className="relative">
                  <div className="text-4xl mb-3 leading-none group-hover:scale-110 transition-transform duration-300 inline-block">
                    {config.flag}
                  </div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-0.5">{config.label}</h2>
                  <p className="text-xs text-gray-500 mb-5">Al Fakher {config.label} SSOF Planning</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${styles.badgeClass}`}>
                    Enter {config.label}
                    <svg className="w-3 h-3 group-hover:translate-x-1 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        )}

        <div
          className={`mt-8 landing-fade-up ${mounted ? "visible" : ""}`}
          style={{ transitionDelay: "700ms" }}
        >
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
          >
            Sign out
          </button>
        </div>

        <footer
          className={`mt-6 text-center text-xs text-gray-400 landing-fade-up ${mounted ? "visible" : ""}`}
          style={{ transitionDelay: "800ms" }}
        >
          Al Fakher &mdash; SSOF Planning System &copy; {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
