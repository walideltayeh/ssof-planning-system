import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry, COUNTRY_CONFIG } from "@/contexts/CountryContext";
import { useUnit, UnitType } from "@/contexts/UnitContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { LogOut, PanelLeft, Globe, Users, KeyRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Country } from "@/contexts/CountryContext";

// Lebanon menu items (original)
const LEBANON_MENU: Array<{ label: string; path: string; adminOnly: boolean; walidOnly?: boolean }> = [
  { label: "Dashboard", path: "/", adminOnly: false },
  { label: "Forecast", path: "/forecast", adminOnly: false },
  { label: "IMS vs Forecast", path: "/ims-vs-forecast", adminOnly: false },
  { label: "Shipment (Production)", path: "/shipment", adminOnly: false },
  { label: "Arrival to Regie", path: "/arrival", adminOnly: false },
  { label: "Planning FG 50g", path: "/planning-fg-50g", adminOnly: false },
  { label: "Planning FG 250g", path: "/planning-fg-250g", adminOnly: false },
  { label: "Planning FG 1kg", path: "/planning-fg-1kg", adminOnly: false },
  { label: "Analysis", path: "/analysis", adminOnly: false },
  { label: "Competitor Analysis", path: "/competitor-analysis", adminOnly: false },
  { label: "Recommended Forecast Split", path: "/forecast-split", adminOnly: false },
  { label: "Data & Versions", path: "/data-versions", adminOnly: true },
  { label: "SKU Management", path: "/sku-management", adminOnly: true },
  { label: "Add Year", path: "/add-year", adminOnly: true },
  { label: "User Management", path: "/user-management", adminOnly: true, walidOnly: true },
  { label: "Audit Trail", path: "/audit-trail", adminOnly: true, walidOnly: true },
];

// Syria / Libya menu items
const INTL_MENU: Array<{ label: string; path: string; adminOnly: boolean; walidOnly?: boolean }> = [
  { label: "Dashboard", path: "/", adminOnly: false },
  { label: "Forecast Production", path: "/forecast", adminOnly: false },
  { label: "Forecast Production vs Actual", path: "/forecast-vs-forecast", adminOnly: false },
  { label: "Production", path: "/shipment", adminOnly: false },
  { label: "Arrival", path: "/arrival", adminOnly: false },
  { label: "IMS", path: "/intl-ims", adminOnly: false },
  { label: "Planning FG 50g", path: "/intl-planning-fg-50g", adminOnly: false },
  { label: "Planning FG 250g", path: "/intl-planning-fg-250g", adminOnly: false },
  { label: "Planning FG 1kg", path: "/intl-planning-fg-1kg", adminOnly: false },
  { label: "Analysis", path: "/intl-analysis", adminOnly: false },
  { label: "Competitor Analysis", path: "/competitor-analysis", adminOnly: false },
  { label: "Recommended Forecast Split", path: "/forecast-split", adminOnly: false },
  { label: "Product Expiry Dashboard", path: "/expiry-dashboard", adminOnly: false },
  { label: "Data & Versions", path: "/data-versions", adminOnly: true },
  { label: "SKU Management", path: "/sku-management", adminOnly: true },
  { label: "Add Year", path: "/add-year", adminOnly: true },
  { label: "User Management", path: "/user-management", adminOnly: true, walidOnly: true },
  { label: "Audit Trail", path: "/audit-trail", adminOnly: true, walidOnly: true },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const { isAdmin, user: appUser, isAuthenticated: isAppAuthenticated } = useAppAuth();
  const { country } = useCountry();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading && !isAppAuthenticated) {
    return <DashboardLayoutSkeleton />
  }

  if (!user && !isAppAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              SSOF Planning System
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Sign in to access the planning dashboard.
            </p>
          </div>
          <Button
            onClick={() => { window.location.href = getLoginUrl(); }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  // Choose menu based on country
  const baseMenuItems = country === "Lebanon" ? LEBANON_MENU : INTL_MENU;
  const menuItems = baseMenuItems.filter(item => {
    if (item.walidOnly && appUser?.username.toLowerCase() !== 'walid') return false;
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth} menuItems={menuItems}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
  menuItems: { label: string; path: string; adminOnly: boolean; walidOnly?: boolean }[];
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
  menuItems,
}: DashboardLayoutContentProps) {
  const { user, logout: oauthLogout } = useAuth();
  const { user: appUser, logout: appLogout, canAccessCountry } = useAppAuth();
  const { country, setCountry, clearCountry } = useCountry();
  const { unit, setUnit } = useUnit();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);

  // Change password dialog state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpError, setCpError] = useState("");

  const changePasswordMutation = trpc.appUsers.changePassword.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Password changed successfully");
        setShowChangePassword(false);
        setCpCurrent(""); setCpNew(""); setCpConfirm(""); setCpError("");
      } else {
        setCpError(result.error ?? "Failed to change password");
      }
    },
    onError: (err) => setCpError(err.message),
  });

  const handleChangePassword = useCallback(() => {
    setCpError("");
    if (!cpCurrent || !cpNew || !cpConfirm) { setCpError("All fields are required"); return; }
    if (cpNew !== cpConfirm) { setCpError("New passwords do not match"); return; }
    if (!appUser?.id) { setCpError("Not authenticated"); return; }
    changePasswordMutation.mutate({ userId: appUser.id, currentPassword: cpCurrent, newPassword: cpNew, confirmPassword: cpConfirm });
  }, [cpCurrent, cpNew, cpConfirm, appUser, changePasswordMutation]);

  const isMobile = useIsMobile();
  const displayName = appUser?.displayName || user?.name || "-";
  const displayRole = appUser?.role || "admin";
  const displayInitial = displayName.charAt(0).toUpperCase();

  const accessibleCountries = (["Lebanon", "Syria", "Libya"] as Country[]).filter(c =>
    canAccessCountry(c)
  );

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const logAction = trpc.audit.logAction.useMutation();

  // Presence: heartbeat every 30s
  const heartbeat = trpc.presence.heartbeat.useMutation();
  const leavePresence = trpc.presence.leave.useMutation();
  const { data: onlineUsers = [] } = trpc.presence.online.useQuery(undefined, {
    refetchInterval: 15000, // refresh every 15s
    enabled: !!(appUser || user),
  });

  // Page label map for human-readable page names
  const PAGE_LABELS: Record<string, string> = {
    "/": "Dashboard",
    "/forecast": "Forecast",
    "/forecast-vs-forecast": "Forecast vs Actual",
    "/shipment": "Production",
    "/arrival": "Arrival",
    "/ims-vs-forecast": "IMS vs Forecast",
    "/intl-ims": "IMS",
    "/planning-fg-50g": "Planning FG 50g",
    "/planning-fg-250g": "Planning FG 250g",
    "/planning-fg-1kg": "Planning FG 1kg",
    "/intl-planning-fg-50g": "Planning FG 50g",
    "/intl-planning-fg-250g": "Planning FG 250g",
    "/intl-planning-fg-1kg": "Planning FG 1kg",
    "/analysis": "Analysis",
    "/intl-analysis": "Analysis",
    "/data-versions": "Data & Versions",
    "/sku-management": "SKU Management",
    "/add-year": "Add Year",
    "/user-management": "User Management",
    "/audit-trail": "Audit Trail",
    "/forecast-split": "Recommended Forecast Split",
  };

  useEffect(() => {
    const currentUser = appUser || (user ? { username: user.openId, displayName: user.name || user.openId } : null);
    if (!currentUser) return;
    const username = appUser?.username || user?.openId || "";
    const displayNameVal = appUser?.displayName || user?.name || username;
    const countryVal = country || "Unknown";
    const pageVal = PAGE_LABELS[location] || location;

    // Send heartbeat immediately on mount/page change
    heartbeat.mutate({ username, displayName: displayNameVal, country: countryVal, currentPage: pageVal });

    // Then every 30s
    const interval = setInterval(() => {
      heartbeat.mutate({ username, displayName: displayNameVal, country: countryVal, currentPage: pageVal });
    }, 30000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, appUser?.username, user?.openId, country]);

  const handleLogout = () => {
    const username = appUser?.username || user?.openId;
    if (appUser) {
      logAction.mutate({ action: "logout", details: `User logged out` });
    }
    if (username) {
      leavePresence.mutate({ username });
    }
    setTimeout(() => {
      appLogout();
      oauthLogout();
      clearCountry();
      setLocation("/");
    }, 200);
  };

  const handleSwitchCountry = (c: Country) => {
    setCountry(c);
    setLocation("/");
  };

  const handleBackToSelector = () => {
    clearCountry();
    setLocation("/");
  };

  const countryCfg = country ? COUNTRY_CONFIG[country] : null;

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                {isCollapsed ? (
                  <PanelLeft className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <img
                    src="https://files.manuscdn.com/user_upload_by_module/session_file/310419663029873001/tmVzGaqVMiJyhmCc.png"
                    alt="Al Fakher"
                    className="h-7 w-auto"
                  />
                )}
              </button>
              {!isCollapsed ? (
                <div className="flex-1 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-sm block">
                    SSOF Planning
                  </span>
                  {countryCfg && (
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {countryCfg.flag} {country}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-9 transition-all font-normal text-[13px]"
                    >
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3 space-y-1">
            {/* Who's Online panel */}
            {!isCollapsed && onlineUsers.length > 0 && (
              <div className="rounded-lg border bg-muted/30 px-2 py-1.5 mb-1">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Users className="h-3 w-3 text-emerald-500" />
                  <span className="text-[11px] font-medium text-muted-foreground">Online</span>
                  <span className="ml-auto text-[10px] bg-emerald-500 text-white rounded-full px-1.5 py-0.5 font-medium">{onlineUsers.length}</span>
                </div>
                <div className="space-y-1">
                  {onlineUsers.map(u => (
                    <div key={u.username} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-[11px] font-medium truncate flex-1">{u.displayName}</span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[70px]">{u.currentPage}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Unit toggle (MC / KG / Tons) */}
            {!isCollapsed && (
              <div className="rounded-lg border bg-muted/30 px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Display Unit</p>
                <div className="flex gap-1">
                  {(["MC", "KG", "Tons"] as UnitType[]).map(u => (
                    <button
                      key={u}
                      onClick={() => setUnit(u)}
                      className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${unit === u ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent text-muted-foreground"}`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Country switcher — only show if user has access to multiple countries */}
            {accessibleCountries.length > 1 && !isCollapsed && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50 transition-colors w-full text-left text-xs text-muted-foreground focus:outline-none">
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{countryCfg ? `${countryCfg.flag} ${country}` : "Select Country"}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {accessibleCountries.map(c => (
                    <DropdownMenuItem
                      key={c}
                      onClick={() => handleSwitchCountry(c)}
                      className={`cursor-pointer text-sm ${c === country ? "font-medium" : ""}`}
                    >
                      {COUNTRY_CONFIG[c].flag} {c}
                      {c === country && <span className="ml-auto text-emerald-600 text-xs">✓</span>}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleBackToSelector} className="cursor-pointer text-xs text-muted-foreground">
                    Back to selector
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {displayInitial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate leading-none">{displayName}</p>
                      <Badge
                        variant={displayRole === "admin" ? "default" : "secondary"}
                        className={`text-[10px] px-1.5 py-0 h-4 ${displayRole === "admin" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : ""}`}
                      >
                        {displayRole === "admin" ? "Admin" : "Viewer"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">{user?.email || appUser?.username || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {accessibleCountries.length > 1 && (
                  <>
                    {accessibleCountries.map(c => (
                      <DropdownMenuItem
                        key={c}
                        onClick={() => handleSwitchCountry(c)}
                        className="cursor-pointer text-sm"
                      >
                        {COUNTRY_CONFIG[c].flag} {c}
                        {c === country && <span className="ml-auto text-emerald-600 text-xs">✓</span>}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {appUser && (
                  <>
                    <DropdownMenuItem
                      onClick={() => { setCpCurrent(""); setCpNew(""); setCpConfirm(""); setCpError(""); setShowChangePassword(true); }}
                      className="cursor-pointer"
                    >
                      <KeyRound className="mr-2 h-4 w-4" />
                      <span>Change Password</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Change Password Dialog */}
            <Dialog open={showChangePassword} onOpenChange={setShowChangePassword}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Change Password</DialogTitle>
                  <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Current Password</label>
                    <input
                      type="password"
                      className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      value={cpCurrent}
                      onChange={e => setCpCurrent(e.target.value)}
                      placeholder="Current password"
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">New Password</label>
                    <input
                      type="password"
                      className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      value={cpNew}
                      onChange={e => setCpNew(e.target.value)}
                      placeholder="New password"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Confirm New Password</label>
                    <input
                      type="password"
                      className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      value={cpConfirm}
                      onChange={e => setCpConfirm(e.target.value)}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      onKeyDown={e => { if (e.key === "Enter") handleChangePassword(); }}
                    />
                  </div>
                  {cpError && <p className="text-xs text-destructive font-medium">{cpError}</p>}
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowChangePassword(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={handleChangePassword}
                    disabled={changePasswordMutation.isPending}
                  >
                    {changePasswordMutation.isPending ? "Saving..." : "Change Password"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (isCollapsed) return; setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground">{activeMenuItem?.label ?? "Menu"}</span>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
