import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import ListingsSuccessful from "@/pages/listings-successful";
import ListingsArchived from "@/pages/listings-archived";
import ScraperDual from "@/pages/scraper-dual";
import AnalyticsPreisspiegel from "@/pages/analytics-preisspiegel";
import AnalyticsTeam from "@/pages/analytics-team";
import LoginPage from "@/pages/login";
import AppLayout from "@/components/app-layout";


function Router({ user, onLogout }: { user: { id: number; username: string; is_admin?: boolean }; onLogout: () => void }) {
  return (
    <AppLayout user={user} onLogout={onLogout}>
      <Switch>
        <Route path="/" component={() => <Dashboard user={user} />} />
        <Route path="/dashboard" component={() => <Dashboard user={user} />} />
        <Route path="/listings/successful" component={() => <ListingsSuccessful user={user} />} />
        <Route path="/listings/archived" component={() => <ListingsArchived user={user} />} />
        <Route path="/scraper/dual" component={() => <ScraperDual user={user} />} />
        <Route path="/analytics/preisspiegel" component={() => <AnalyticsPreisspiegel user={user} />} />
        <Route path="/analytics/team" component={() => <AnalyticsTeam user={user} />} />
        <Route>
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-2">404</h1>
              <p className="text-muted-foreground">Seite nicht gefunden</p>
            </div>
          </div>
        </Route>
      </Switch>
    </AppLayout>
  );
}

function App() {
  const [user, setUser] = useState<{ id: number; username: string; is_admin?: boolean } | null>(() => {
    // Restore user from localStorage
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (userData: { id: number; username: string; is_admin?: boolean }) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {user ? (
          <Router user={user} onLogout={handleLogout} />
        ) : (
          <LoginPage onLogin={handleLogin} />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
