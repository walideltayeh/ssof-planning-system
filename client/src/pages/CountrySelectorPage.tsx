import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry, COUNTRY_CONFIG, type Country } from "@/contexts/CountryContext";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogOut, Globe, ChevronRight } from "lucide-react";

const COUNTRY_DESCRIPTIONS: Record<Country, string> = {
  Lebanon: "Lebanon SSOF Planning — Forecast, IMS, Production & Arrivals",
  Syria: "Syria SSOF Planning — Forecast Production, Production & Arrivals",
  Libya: "Libya SSOF Planning — Forecast Production, Production & Arrivals",
};

export default function CountrySelectorPage() {
  const { user, logout, canAccessCountry } = useAppAuth();
  const { setCountry } = useCountry();
  const [, setLocation] = useLocation();

  const accessibleCountries = (["Lebanon", "Syria", "Libya"] as Country[]).filter(c =>
    canAccessCountry(c)
  );

  function handleSelect(country: Country) {
    setCountry(country);
    setLocation("/");
  }

  function handleLogout() {
    logout();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://files.manuscdn.com/user_upload_by_module/session_file/310419663029873001/tmVzGaqVMiJyhmCc.png"
              alt="Al Fakher"
              className="h-8 w-auto"
            />
            <div>
              <span className="font-semibold text-gray-900 text-sm">SSOF Planning System</span>
              <p className="text-xs text-gray-400 leading-none mt-0.5">Sales, Stock, Orders & Forecast</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-700">{user?.displayName}</p>
              <p className="text-xs text-gray-400">{user?.role === "admin" ? "Admin" : "Viewer"}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-gray-500 hover:text-red-600 gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 rounded-full px-4 py-1.5 text-sm font-medium mb-4">
            <Globe className="h-4 w-4" />
            Select your country environment
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome, {user?.displayName?.split(" ")[0]}
          </h1>
          <p className="text-gray-500 text-base">
            Choose a country to access its SSOF planning environment.
          </p>
        </div>

        <div className="grid gap-4 w-full max-w-2xl">
          {accessibleCountries.map((country) => {
            const cfg = COUNTRY_CONFIG[country];
            return (
              <button
                key={country}
                onClick={() => handleSelect(country)}
                className="group w-full text-left"
              >
                <Card className="border border-gray-200 hover:border-emerald-400 hover:shadow-md transition-all duration-200 bg-white group-hover:bg-emerald-50/30">
                  <CardContent className="p-5 flex items-center gap-4">
                    {/* Flag */}
                    <div className="text-4xl leading-none select-none">{cfg.flag}</div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900 text-lg">{cfg.label}</span>
                        {country !== "Lebanon" && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-blue-50 text-blue-600">
                            New
                          </Badge>
                        )}
                        {country === "Lebanon" && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-50 text-emerald-600">
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 truncate">{COUNTRY_DESCRIPTIONS[country]}</p>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-emerald-500 transition-colors shrink-0" />
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        {accessibleCountries.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p>You do not have access to any country environment.</p>
            <p className="text-sm mt-1">Please contact your administrator.</p>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 py-4 border-t bg-white/50">
        Al Fakher SSOF Planning System — Multi-Country Edition
      </footer>
    </div>
  );
}
