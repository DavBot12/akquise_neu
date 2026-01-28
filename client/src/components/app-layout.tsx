import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Building, ChartLine, TrendingUp, LogOut, User, Users, ListChecks, Archive, Activity, BarChart3, UserCog, Settings } from "lucide-react";
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
      adminOnly: true,
    },
    {
      path: "/analytics/team",
      label: "Team Performance",
      icon: Users,
      adminOnly: true,
    },
    {
      path: "/analytics/scraper",
      label: "Scraper Analytics",
      icon: ChartLine,
      adminOnly: true,
    },
    {
      path: "/admin/users",
      label: "Benutzerverwaltung",
      icon: UserCog,
      adminOnly: true,
    },
  ];

  // Filter nav items based on admin status
  const visibleNavItems = navItems.filter(item => !item.adminOnly || user.is_admin);

  return (
    <div className="flex h-screen bg-sira-background">
      {/* Sidebar - SIRA Minimalist Design */}
      <aside className="w-64 border-r border-sira-light-gray bg-white flex flex-col">
        {/* Logo/Header */}
        <div className="p-6 border-b border-sira-light-gray">
          <img
            src="/sira-logo.png"
            alt="SIRA Akquise"
            className="h-16 w-auto"
          />
          <div className="mt-3 text-sm text-sira-medium-gray">
            Akquise System
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path || location.startsWith(item.path + "/");

            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-md transition-smooth cursor-pointer text-sm",
                    isActive
                      ? "bg-sira-navy text-white"
                      : "text-sira-text-gray hover:bg-sira-background hover:text-sira-navy"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User Info & Logout */}
        <div className="p-4 border-t border-sira-light-gray space-y-3">
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="w-8 h-8 rounded-full bg-sira-light-gray flex items-center justify-center">
              <User className="w-4 h-4 text-sira-dark-gray" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sira-navy truncate">
                {user.username}
              </div>
              {user.is_admin && (
                <div className="text-xs text-sira-medium-gray">
                  Administrator
                </div>
              )}
            </div>
          </div>

          <Link href="/settings">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sira-text-gray hover:text-sira-navy hover:bg-sira-background transition-smooth text-xs"
            >
              <Settings className="w-3 h-3" />
              <span className="font-medium">Einstellungen</span>
            </Button>
          </Link>

          <Button
            variant="ghost"
            onClick={onLogout}
            className="w-full justify-start gap-3 text-sira-text-gray hover:text-sira-danger hover:bg-red-50 transition-smooth"
          >
            <LogOut className="w-4 h-4" />
            <span className="font-medium">Abmelden</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
