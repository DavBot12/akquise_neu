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

function Router({ user, onLogout }: { user: { id: number; username: string; is_admin?: boolean }; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <Dashboard user={user} onLogout={onLogout} />
    </div>
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
