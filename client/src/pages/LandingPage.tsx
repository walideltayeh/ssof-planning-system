import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAppAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function LandingPage() {
  const { login } = useAppAuth();
  const [, navigate] = useLocation();
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setIsLoading(true);
    setError("");

    const err = await login(username, password);

    if (err) {
      setError(err);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    navigate("/");
    toast.success(`Welcome back, ${username}!`);
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

      <div className="relative z-10 flex flex-col flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
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
              <span className="shimmer-text">SSOF Planning</span>
            </h1>
            <p
              className={`text-sm text-gray-500 mt-1 landing-fade-up ${mounted ? "visible" : ""}`}
              style={{ transitionDelay: "200ms" }}
            >
              Sales, Stock, Orders &amp; Forecast
            </p>
          </div>

          <div
            className={`landing-fade-up ${mounted ? "visible" : ""}`}
            style={{ transitionDelay: "350ms" }}
          >
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/60 p-6">
              <h2 className="text-lg font-semibold text-center text-gray-800 mb-5">
                Sign in to your account
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="username" className="text-sm font-medium text-gray-700">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); setError(""); }}
                    className="w-full h-11 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    autoFocus
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      className="w-full h-11 px-3 pr-10 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
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

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !username || !password}
                  className="w-full h-11 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-sm font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Signing in...
                    </span>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>

        <footer
          className={`mt-10 text-center text-xs text-gray-400 landing-fade-up ${mounted ? "visible" : ""}`}
          style={{ transitionDelay: "500ms" }}
        >
          Developed by Walid El Tayeh
          <br />
          Al Fakher &mdash; SSOF Planning System &copy; {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
