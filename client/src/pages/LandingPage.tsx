import { useState, useEffect, useRef, useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAppAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulsePhase: number;
  pulseSpeed: number;
}

interface DataPacket {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
  color: string;
}

function DataNetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const packetsRef = useRef<DataPacket[]>([]);
  const timeRef = useRef(0);

  const COLORS = [
    "rgba(16, 185, 129, 0.6)",
    "rgba(20, 184, 166, 0.5)",
    "rgba(59, 130, 246, 0.4)",
    "rgba(139, 92, 246, 0.35)",
  ];
  const PACKET_COLORS = [
    "#10b981",
    "#14b8a6",
    "#3b82f6",
    "#8b5cf6",
    "#f59e0b",
  ];
  const NODE_COUNT = 28;
  const CONNECTION_DIST = 180;

  const initNodes = useCallback((w: number, h: number) => {
    const nodes: Node[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: 2 + Math.random() * 3,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.02,
      });
    }
    nodesRef.current = nodes;
  }, []);

  const spawnPacket = useCallback(() => {
    const nodes = nodesRef.current;
    if (nodes.length < 2) return;
    const fromIdx = Math.floor(Math.random() * nodes.length);
    let toIdx = Math.floor(Math.random() * nodes.length);
    while (toIdx === fromIdx) toIdx = Math.floor(Math.random() * nodes.length);
    const dx = nodes[toIdx].x - nodes[fromIdx].x;
    const dy = nodes[toIdx].y - nodes[fromIdx].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > CONNECTION_DIST * 1.5) return;
    packetsRef.current.push({
      fromIdx,
      toIdx,
      progress: 0,
      speed: 0.008 + Math.random() * 0.012,
      color: PACKET_COLORS[Math.floor(Math.random() * PACKET_COLORS.length)],
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      if (nodesRef.current.length === 0) {
        initNodes(rect.width, rect.height);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      timeRef.current += 1;

      ctx.clearRect(0, 0, w, h);

      const nodes = nodesRef.current;
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;
        node.x = Math.max(0, Math.min(w, node.x));
        node.y = Math.max(0, Math.min(h, node.y));
        node.pulsePhase += node.pulseSpeed;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.15;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(16, 185, 129, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      for (const node of nodes) {
        const pulse = Math.sin(node.pulsePhase) * 0.4 + 0.6;
        const r = node.radius * (0.8 + pulse * 0.4);

        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(16, 185, 129, ${0.04 * pulse})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        const colorIdx = Math.floor(node.pulsePhase) % COLORS.length;
        ctx.fillStyle = COLORS[colorIdx];
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * pulse})`;
        ctx.fill();
      }

      if (timeRef.current % 12 === 0) {
        spawnPacket();
      }

      const packets = packetsRef.current;
      for (let p = packets.length - 1; p >= 0; p--) {
        const pkt = packets[p];
        pkt.progress += pkt.speed;
        if (pkt.progress >= 1) {
          const toNode = nodes[pkt.toIdx];
          if (toNode) {
            ctx.beginPath();
            ctx.arc(toNode.x, toNode.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = pkt.color.replace(")", ", 0.3)").replace("rgb", "rgba");
            ctx.fill();
          }
          packets.splice(p, 1);
          continue;
        }

        const from = nodes[pkt.fromIdx];
        const to = nodes[pkt.toIdx];
        if (!from || !to) { packets.splice(p, 1); continue; }

        const px = from.x + (to.x - from.x) * pkt.progress;
        const py = from.y + (to.y - from.y) * pkt.progress;

        const trailLen = 0.15;
        const trailStart = Math.max(0, pkt.progress - trailLen);
        const tx = from.x + (to.x - from.x) * trailStart;
        const ty = from.y + (to.y - from.y) * trailStart;
        const grad = ctx.createLinearGradient(tx, ty, px, py);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, pkt.color);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(px, py);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = pkt.color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = pkt.color.replace(")", ", 0.2)").replace("rgb", "rgba");
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [initNodes, spawnPacket]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ opacity: 0.7 }}
    />
  );
}

export default function LandingPage() {
  const { login } = useAppAuth();
  const [, navigate] = useLocation();
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const logAction = trpc.audit.logAction.useMutation();

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
      logAction.mutate({
        username: username || "unknown",
        action: "login_failed",
        details: `Failed login attempt for username: ${username}`,
      });
      return;
    }

    setIsLoading(false);
    navigate("/");
    toast.success(`Welcome back, ${username}!`);
    logAction.mutate({
      username: username.toLowerCase(),
      action: "login",
      details: `User logged in`,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-teal-50 overflow-hidden relative">
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
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
        <DataNetworkCanvas />
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
          Al Fakher &mdash; SSOF Planning System &copy; {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
