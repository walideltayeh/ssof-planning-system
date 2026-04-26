import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry, COUNTRY_CONFIG } from "@/contexts/CountryContext";
import type { Country } from "@/contexts/CountryContext";
import { useLocation } from "wouter";

export default function LoginPage() {
  const { login } = useAppAuth();
  const { country, setCountry, clearCountry } = useCountry();
  const [, navigate] = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Detect super admin mode from URL query param
  const isSuperAdminMode = typeof window !== "undefined" && window.location.search.includes("superadmin=1");

  const countryConfig = country ? COUNTRY_CONFIG[country] : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const loginCountry = isSuperAdminMode ? "Lebanon" : country;
    if (!loginCountry) {
      setError("Please select a country first.");
      setIsLoading(false);
      return;
    }

    const err = await login(username, password, loginCountry as import("@/contexts/AuthContext").Country);

    if (err) {
      setError(err);
      setIsLoading(false);
      return;
    }

    // Login succeeded
    const userKey = username.toLowerCase();
    if (isSuperAdminMode) setCountry("Lebanon");
    setIsLoading(false);
    navigate("/");
    toast.success(`Welcome back, ${userKey}!`);
  };

  const handleBackToLanding = () => {
    clearCountry();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-100/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Logo / Title */}
        <div className="text-center mb-8">
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
        </div>

        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-4 pt-6 px-6">
            {isSuperAdminMode ? (
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold border border-amber-200">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Super Admin Access
                </span>
              </div>
            ) : countryConfig ? (
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-2xl">{countryConfig.flag}</span>
                <span className="text-base font-semibold text-gray-700">
                  Sign in to {countryConfig.label}
                </span>
              </div>
            ) : null}
            <h2 className="text-lg font-semibold text-center text-gray-800">
              {isSuperAdminMode ? "Super Admin Sign In" : "Sign in to your account"}
            </h2>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium text-gray-700">
                  Username
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder={isSuperAdminMode ? "Super Admin username" : "Enter your username"}
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(""); }}
                  className="h-11 bg-white border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    className="h-11 bg-white border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                />
                <Label htmlFor="remember" className="text-sm text-gray-600 cursor-pointer select-none">
                  Remember me
                </Label>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-medium shadow-md hover:shadow-lg transition-all"
                disabled={isLoading || !username || !password}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>


            {/* Back to country selection */}
            <div className="mt-4 pt-4 border-t border-gray-100 text-center">
              <button
                onClick={handleBackToLanding}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
              >
                ← Back to country selection
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-400 mt-6">
          Al Fakher SSOF Planning System
        </p>
      </div>
    </div>
  );
}
