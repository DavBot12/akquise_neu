import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import StatsPage from "@/pages/stats";
import AdminPerformancePage from "@/pages/admin-performance";
import NotFound from "@/pages/not-found";

function Router({ user }: { user: { id: number; username: string; is_admin?: boolean } }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="flex h-16 items-center px-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold">Real Estate Tool</h1>
            <nav className="flex space-x-4">
              <a href="/" className="text-sm hover:text-primary">Dashboard</a>
              <a href="/stats" className="text-sm hover:text-primary">Statistiken</a>
              {user.is_admin && (
                <a href="/admin" className="text-sm hover:text-primary font-medium">Admin</a>
              )}
            </nav>
          </div>
          <div className="ml-auto flex items-center space-x-4">
            <span className="text-sm text-muted-foreground">
              Angemeldet als: {user.username}
              {user.is_admin && <span className="ml-1 text-blue-600 font-medium">(Admin)</span>}
            </span>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Abmelden
            </button>
          </div>
        </div>
      </div>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/stats">
          <StatsPage user={user} />
        </Route>
        {user.is_admin && (
          <Route path="/admin">
            <AdminPerformancePage />
          </Route>
        )}
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<{ id: number; username: string; is_admin?: boolean } | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {user ? (
          <Router user={user} />
        ) : (
          <LoginPage onLogin={setUser} />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
