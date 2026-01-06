import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Building, ChartLine, TrendingUp, LogOut, User } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import ListingCard from "@/components/listing-card";
import ScraperConsole from "@/components/scraper-console";
import ScraperDualConsole from "@/components/scraper-dual-console";
import PriceMirror from "@/components/price-mirror";
import PriceMirrorControl from "@/components/price-mirror-control";
import Statistics from "@/pages/statistics";
import { useWebSocket } from "@/hooks/use-websocket";
import type { Listing, Contact } from "@shared/schema";

interface DashboardProps {
  user?: { id: number; username: string; is_admin?: boolean };
  onLogout?: () => void;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [regionFilter, setRegionFilter] = useState("Alle Regionen");
  const [priceFilter, setPriceFilter] = useState("Alle Preise");

  const queryClient = useQueryClient();

  // WebSocket connection for real-time updates
  useWebSocket("/ws", {
    onMessage: (data) => {
      if (data.type === "newListing") {
        queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
      }
    },
  });

  // Fetch listings with proper query parameters - HIDE COMPLETED ACQUISITIONS
  const { data: listings = [], isLoading: listingsLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", regionFilter, priceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (regionFilter !== "Alle Regionen") params.append("region", regionFilter);
      if (priceFilter !== "Alle Preise") params.append("price_evaluation", priceFilter);
      // WICHTIG: Verstecke erledigte Akquisen vom Dashboard
      params.append("akquise_erledigt", "false");

      const url = `/api/listings${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch listings');
      return response.json();
    },
  });

  // Fetch deleted listings for admin
  const { data: deletedListings = [], isLoading: deletedLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", "deleted"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("is_deleted", "true");

      const url = `/api/listings?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch deleted listings');
      return response.json();
    },
    enabled: user?.is_admin && activeTab === "deleted", // Only fetch when admin views the tab
  });

  // Fetch stats
  const { data: stats } = useQuery<{
    activeListings: number;
    completedListings: number;
    lastScrape: string | null;
  }>({
    queryKey: ["/api/listings/stats"],
  });

  // Mark listing as completed
  const markCompletedMutation = useMutation({
    mutationFn: async ({ id, akquise_erledigt }: { id: number; akquise_erledigt: boolean }) => {
      await apiRequest("PATCH", `/api/listings/${id}/akquise`, { akquise_erledigt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
    },
  });

  const handleMarkCompleted = (id: number) => {
    markCompletedMutation.mutate({ id, akquise_erledigt: true });
  };

  // Delete listing mutation
  const deleteListingMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      await apiRequest("DELETE", `/api/listings/${id}`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
    },
  });

  const handleDeleteListing = (id: number, reason?: string) => {
    deleteListingMutation.mutate({ id, reason });
  };

  const formatLastScrape = (lastScrape: string | null) => {
    if (!lastScrape) return "nie";
    const date = new Date(lastScrape);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHours > 0) {
      return `vor ${diffHours}h`;
    } else {
      return `vor ${diffMinutes}min`;
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Main Sidebar */}
      <aside className="w-64 bg-white shadow-lg">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800 flex items-center">
            <Building className="text-primary mr-2" />
            Immobilien Akquise
          </h1>
        </div>
        
        <nav className="mt-6">
          <div className="px-4 space-y-2">
            <Button
              variant={activeTab === "dashboard" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("dashboard")}
            >
              <ChartLine className="mr-3 h-4 w-4" />
              Dashboard
            </Button>
            {user?.is_admin && (
              <>
                <Button
                  variant={activeTab === "scraper" ? "default" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => setActiveTab("scraper")}
                >
                  <Building className="mr-3 h-4 w-4" />
                  Scraper Console
                </Button>
                {/* V10: Preisspiegel Scraper ausgeblendet */}
                {/* <Button
                  variant={activeTab === "price-scraper" ? "default" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => setActiveTab("price-scraper")}
                >
                  <TrendingUp className="mr-3 h-4 w-4" />
                  Preisspiegel Scraper
                </Button> */}
              </>
            )}
            {/* V10: Preisspiegel ausgeblendet */}
            {/* <Button
              variant={activeTab === "preisspiegel" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("preisspiegel")}
            >
              <TrendingUp className="mr-3 h-4 w-4" />
              Preisspiegel
            </Button> */}
            {/* V10: Statistiken ausgeblendet */}
            {/* <Button
              variant={activeTab === "statistiken" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("statistiken")}
            >
              <ChartLine className="mr-3 h-4 w-4" />
              Statistiken
            </Button> */}
            {user?.is_admin && (
              <Button
                variant={activeTab === "deleted" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveTab("deleted")}
              >
                <Building className="mr-3 h-4 w-4" />
                Gelöschte Inserate
              </Button>
            )}
          </div>
        </nav>

        {/* Stats Summary */}
        <div className="p-4 mt-8 border-t border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Übersicht</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Aktive Listings:</span>
              <span className="font-medium">{stats?.activeListings || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Erledigt:</span>
              <span className="font-medium">{stats?.completedListings || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Letzter Scrape:</span>
              <span className="font-medium text-xs">{formatLastScrape(stats?.lastScrape || null)}</span>
            </div>
          </div>
        </div>

        {/* User Info and Logout */}
        <div className="mt-auto p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3 mb-3">
            <User className="h-5 w-5 text-gray-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{user?.username}</p>
              {user?.is_admin && (
                <p className="text-xs text-blue-600 font-medium">Admin</p>
              )}
            </div>
          </div>
          {onLogout && (
            <Button
              variant="ghost"
              className="w-full justify-start text-gray-600 hover:text-gray-900"
              onClick={onLogout}
            >
              <LogOut className="mr-3 h-4 w-4" />
              Abmelden
            </Button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div className="h-full">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
                  <p className="text-gray-600 mt-1">Aktuelle Immobilien-Listings verwalten</p>
                </div>
                <div className="flex space-x-3">
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Regionen">Alle Regionen</SelectItem>
                      <SelectItem value="wien">Wien</SelectItem>
                      <SelectItem value="niederoesterreich">Niederösterreich</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={priceFilter} onValueChange={setPriceFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Preise">Alle Preise</SelectItem>
                      <SelectItem value="Unter dem Schnitt">Unter dem Schnitt</SelectItem>
                      <SelectItem value="Im Schnitt">Im Schnitt</SelectItem>
                      <SelectItem value="Über dem Schnitt">Über dem Schnitt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="p-6 h-full overflow-y-auto">
              {listingsLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 animate-pulse">
                      <div className="h-48 bg-gray-200 rounded mb-4"></div>
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              ) : listings.length === 0 ? (
                <div className="text-center py-12">
                  <Building className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                  <p className="text-gray-500">Keine Listings gefunden</p>
                  <p className="text-sm text-gray-400 mt-2">Starten Sie den Scraper um neue Listings zu finden</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  <div className="col-span-full mb-4">
                    <p className="text-sm text-gray-600">{listings.length} Listing{listings.length !== 1 ? 's' : ''} gefunden</p>
                  </div>
                  {listings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      onMarkCompleted={handleMarkCompleted}
                      isMarkingCompleted={markCompletedMutation.isPending}
                      onDelete={handleDeleteListing}
                      user={user}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scraper Console Tab - Admin only */}
        {user?.is_admin && activeTab === "scraper" && (
          <div className="h-full">
            <ScraperDualConsole />
          </div>
        )}

        {/* Price Spiegel Tab
        {activeTab === "preisspiegel" && (
          <div className="h-full">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">📊 Immobilienpreis Spiegel</h2>
                  <p className="text-gray-600 mt-1">Durchschnittspreise nach Bezirken und Regionen</p>
                </div>
              </div>
            </div>
            <div className="p-6 h-full overflow-y-auto">
              <PriceMirror />
            </div>
          </div>
        )} */}

        {/* Statistics Tab
        {activeTab === "statistiken" && (
          <div className="h-full">
            <Statistics user={user!} />
          </div>
        )} */}

        {/* Price Scraper Tab - Admin only
        {user?.is_admin && activeTab === "price-scraper" && (
          <div className="h-full">
            <div className="p-6">
              <PriceMirrorControl />
            </div>
          </div>
        )} */}

        {/* Deleted Listings Tab - Admin only */}
        {user?.is_admin && activeTab === "deleted" && (
          <div className="h-full">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Gelöschte / Unattraktive Inserate</h2>
                  <p className="text-gray-600 mt-1">Vom User als unattraktiv markierte Listings</p>
                </div>
              </div>
            </div>

            <div className="p-6 h-full overflow-y-auto">
              {deletedLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 animate-pulse">
                      <div className="h-48 bg-gray-200 rounded mb-4"></div>
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              ) : deletedListings.length === 0 ? (
                <div className="text-center py-12">
                  <Building className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                  <p className="text-gray-500">Keine gelöschten Inserate</p>
                  <p className="text-sm text-gray-400 mt-2">Inserate die als unattraktiv markiert wurden erscheinen hier</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  <div className="col-span-full mb-4">
                    <p className="text-sm text-gray-600">{deletedListings.length} gelöschte Listing{deletedListings.length !== 1 ? 's' : ''}</p>
                  </div>
                  {deletedListings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      onMarkCompleted={handleMarkCompleted}
                      isMarkingCompleted={markCompletedMutation.isPending}
                      user={user}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
