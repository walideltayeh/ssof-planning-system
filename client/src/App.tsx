import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation, useSearch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAppAuth } from "./contexts/AuthContext";
import { CountryProvider, useCountry } from "./contexts/CountryContext";
import { UnitProvider } from "./contexts/UnitContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import ForecastPage from "./pages/ForecastPage";
import ImsVsForecastPage from "./pages/ImsVsForecastPage";
import ShipmentPage from "./pages/ShipmentPage";
import ArrivalPage from "./pages/ArrivalPage";
import PlanningFgPage from "./pages/PlanningFgPage";
import SkuManagementPage from "./pages/SkuManagementPage";
import AddYearPage from "./pages/AddYearPage";
import UserManagementPage from "./pages/UserManagementPage";
import AuditTrailPage from "./pages/AuditTrailPage";
import DataVersionsPage from "./pages/DataVersionsPage";
import AnalysisPage from "./pages/AnalysisPage";
import ForecastVsForecastPage from "@/pages/ForecastVsForecastPage";
import IntlPlanningFgPage from "@/pages/IntlPlanningFgPage";
import IntlImsPage from "@/pages/IntlImsPage";
import IntlAnalysisPage from "@/pages/IntlAnalysisPage";
import ForecastSplitPage from "@/pages/ForecastSplitPage";
import ExpiryDashboardPage from "@/pages/ExpiryDashboardPage";
import CompetitorAnalysisPage from "@/pages/CompetitorAnalysisPage";
import AutoSaveReminder from "./components/AutoSaveReminder";
import LandingPage from "./pages/LandingPage";
import CountrySelectorPage from "./pages/CountrySelectorPage";
import { useNavigationLogger } from "./hooks/useAuditLog";

function Dashboard() {
  useNavigationLogger();
  return (
    <DashboardLayout>
      <AutoSaveReminder />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/forecast" component={ForecastPage} />
        <Route path="/ims-vs-forecast" component={ImsVsForecastPage} />
        <Route path="/shipment" component={ShipmentPage} />
        <Route path="/arrival" component={ArrivalPage} />
        <Route path="/planning-fg-50g">{() => <PlanningFgPage weight="50g" />}</Route>
        <Route path="/planning-fg-250g">{() => <PlanningFgPage weight="250g" />}</Route>
        <Route path="/planning-fg-1kg">{() => <PlanningFgPage weight="1kg" />}</Route>
        {/* Generic Planning FG route — accepts any weight string ("50g",
            "250g", "500g", "1kg", …). The sidebar generates these links per
            country based on the weights actually present in its SKUs. */}
        <Route path="/planning-fg/:weight">{(params) => <PlanningFgPage weight={decodeURIComponent(params.weight)} />}</Route>
        <Route path="/upload" component={DataVersionsPage} />
        <Route path="/sku-management" component={SkuManagementPage} />
        <Route path="/add-year" component={AddYearPage} />
        <Route path="/user-management" component={UserManagementPage} />
        <Route path="/audit-trail" component={AuditTrailPage} />
        <Route path="/versions" component={DataVersionsPage} />
        <Route path="/data-versions" component={DataVersionsPage} />
        <Route path="/analysis" component={AnalysisPage} />
        <Route path="/forecast-vs-forecast" component={ForecastVsForecastPage} />
        <Route path="/intl-planning-fg-50g">{() => <IntlPlanningFgPage weight="50g" />}</Route>
        <Route path="/intl-planning-fg-250g">{() => <IntlPlanningFgPage weight="250g" />}</Route>
        <Route path="/intl-planning-fg-1kg">{() => <IntlPlanningFgPage weight="1kg" />}</Route>
        {/* Generic Intl Planning FG route — see /planning-fg/:weight above. */}
        <Route path="/intl-planning-fg/:weight">{(params) => <IntlPlanningFgPage weight={decodeURIComponent(params.weight)} />}</Route>
        <Route path="/intl-planning-fg">{() => <IntlPlanningFgPage />}</Route>
        <Route path="/intl-ims" component={IntlImsPage} />
        <Route path="/intl-analysis" component={IntlAnalysisPage} />
        <Route path="/forecast-split" component={ForecastSplitPage} />
        <Route path="/expiry-dashboard" component={ExpiryDashboardPage} />
        <Route path="/competitor-analysis" component={CompetitorAnalysisPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function AppContent() {
  const { isAuthenticated, user, country } = useAppAuth();
  const [location] = useLocation();

  const pathname = location.split("?")[0];

  if (!isAuthenticated) return <LandingPage />;

  if (isAuthenticated && !country) return <CountrySelectorPage />;

  if (pathname === "/login") return <Redirect to="/" />;

  return <Dashboard />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <CountryProvider>
            <UnitProvider>
              <TooltipProvider>
                <Toaster />
                <AppContent />
              </TooltipProvider>
            </UnitProvider>
          </CountryProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
