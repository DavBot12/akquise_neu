import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import StatsPage from "@/pages/stats";
import NotFound from "@/pages/not-found";

function Router({ user }: { user: { id: number; username: string } }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="flex h-16 items-center px-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold">Real Estate Tool</h1>
            <span className="text-sm text-muted-foreground">
              Angemeldet als: {user.username}
            </span>
          </div>
          <div className="ml-auto">
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
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<{ id: number; username: string } | null>(null);

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
