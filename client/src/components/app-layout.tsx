import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Building, ChartLine, TrendingUp, LogOut, User, Users, ListChecks, Archive, Activity, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  user: { id: number; username: string; is_admin?: boolean };
  onLogout: () => void;
  children: React.ReactNode;
}

export default function AppLayout({ user, onLogout, children }: AppLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    {
      path: "/dashboard",
      label: "Dashboard",
      icon: Building,
      adminOnly: false,
    },
    {
      path: "/listings/successful",
      label: "Erfolgreiche Akquisen",
      icon: ListChecks,
      adminOnly: false,
    },
    {
      path: "/listings/archived",
      label: "Archivierte Inserate",
      icon: Archive,
      adminOnly: true,
    },
    {
      path: "/scraper/dual",
      label: "Dual Scraper",
      icon: Activity,
      adminOnly: true,
    },
    {
      path: "/analytics/preisspiegel",
      label: "Preisspiegel",
      icon: BarChart3,
      adminOnly: true, // Kann in analytics-preisspiegel.tsx konfiguriert werden
    },
    {
      path: "/analytics/team",
      label: "Team Performance",
      icon: Users,
      adminOnly: true,
    },
  ];

  // Filter nav items based on admin status
  const visibleNavItems = navItems.filter(item => !item.adminOnly || user.is_admin);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        {/* Logo/Header */}
        <div className="p-6 border-b">
          <div className="flex items-center gap-2">
            <Building className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold">SIRA Akquise System</h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path || location.startsWith(item.path + "/");

            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User Info & Logout */}
        <div className="p-4 border-t">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{user.username}</span>
            </div>
            {user.is_admin && (
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                Admin
              </span>
            )}
          </div>
          <Button
            variant="outline"
            onClick={onLogout}
            className="w-full"
            size="sm"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
