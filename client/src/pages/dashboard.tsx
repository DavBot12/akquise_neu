import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

import { Building, ChartLine, TrendingUp, LogOut, User, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import ListingCard from "@/components/listing-card";
import ScraperConsole from "@/components/scraper-console";
import ScraperDualConsole from "@/components/scraper-dual-console";
import PriceMirror from "@/components/price-mirror";
import PriceMirrorControl from "@/components/price-mirror-control";
import PreisspiegelTest from "@/components/preisspiegel-test";
import TeamPerformance from "@/components/team-performance";
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
  const [bezirkFilter, setBezirkFilter] = useState("Alle Bezirke");
  const [categoryFilter, setCategoryFilter] = useState("Alle Kategorien");
  const [phoneFilter, setPhoneFilter] = useState("Alle");
  const [sourceFilter, setSourceFilter] = useState("Alle Quellen");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1500000]);
  const [sortBy, setSortBy] = useState<"scraped_at" | "last_changed_at">("last_changed_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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

  // Invalidate queries when switching tabs to ensure fresh data
  useEffect(() => {
    if (activeTab === "successful") {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/successful"] });
    } else if (activeTab === "deleted") {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/deleted-unsuccessful"] });
    }
  }, [activeTab, queryClient]);

  // Reset Bezirk filter when region changes to non-Wien
  useEffect(() => {
    if (regionFilter !== "wien") {
      setBezirkFilter("Alle Bezirke");
    }
  }, [regionFilter]);

  // Fetch listings with proper query parameters - HIDE COMPLETED ACQUISITIONS
  const { data: listings = [], isLoading: listingsLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", regionFilter, bezirkFilter, categoryFilter, phoneFilter, sourceFilter, priceRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (regionFilter !== "Alle Regionen") params.append("region", regionFilter);
      if (bezirkFilter !== "Alle Bezirke") params.append("district", bezirkFilter);
      if (categoryFilter !== "Alle Kategorien") params.append("category", categoryFilter);
      if (phoneFilter === "Nur mit Telefonnummer") params.append("has_phone", "true");
      if (phoneFilter === "Nur ohne Telefonnummer") params.append("has_phone", "false");
      if (sourceFilter !== "Alle Quellen") params.append("source", sourceFilter);
      if (priceRange[0] > 0) params.append("min_price", priceRange[0].toString());
      if (priceRange[1] < 1500000) params.append("max_price", priceRange[1].toString());
      // WICHTIG: Verstecke erledigte Akquisen vom Dashboard
      params.append("akquise_erledigt", "false");

      const url = `/api/listings${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch listings');
      return response.json();
    },
  });

  // Fetch deleted + unsuccessful listings for admin
  const { data: deletedListings = [], isLoading: deletedLoading } = useQuery<any[]>({
    queryKey: ["/api/listings/deleted-unsuccessful"],
    queryFn: async () => {
      const response = await fetch('/api/listings/deleted-unsuccessful');
      if (!response.ok) throw new Error('Failed to fetch deleted/unsuccessful listings');
      return response.json();
    },
    enabled: user?.is_admin && activeTab === "deleted", // Only fetch when admin views the tab
    refetchOnMount: 'always',
  });

  // Fetch successful acquisitions
  const { data: successfulListings = [], isLoading: successfulLoading } = useQuery<any[]>({
    queryKey: ["/api/listings/successful", user?.is_admin ? undefined : user?.id],
    queryFn: async () => {
      const url = user?.is_admin
        ? '/api/listings/successful'
        : `/api/listings/successful?userId=${user?.id}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch successful acquisitions');
      return response.json();
    },
    enabled: activeTab === "successful",
    refetchOnMount: 'always',
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
    mutationFn: async ({ id, reason, userId }: { id: number; reason?: string; userId?: number }) => {
      await apiRequest("DELETE", `/api/listings/${id}`, { reason, userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
    },
  });

  const handleDeleteListing = (id: number, reason?: string) => {
    deleteListingMutation.mutate({ id, reason, userId: user?.id });
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
                <Button
                  variant={activeTab === "preisspiegel-test" ? "default" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => setActiveTab("preisspiegel-test")}
                >
                  <TrendingUp className="mr-3 h-4 w-4" />
                  Preisspiegel
                </Button>
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
            <Button
              variant={activeTab === "successful" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("successful")}
            >
              <ChartLine className="mr-3 h-4 w-4" />
              Erfolgreiche Akquisen
            </Button>
            {user?.is_admin && (
              <Button
                variant={activeTab === "performance" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveTab("performance")}
              >
                <Users className="mr-3 h-4 w-4" />
                Team Performance
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
                <div className="flex flex-wrap gap-3">
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

                  {regionFilter === "wien" && (
                    <Select value={bezirkFilter} onValueChange={setBezirkFilter}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Alle Bezirke">Alle Bezirke</SelectItem>
                        <SelectItem value="1">1. Innere Stadt</SelectItem>
                        <SelectItem value="2">2. Leopoldstadt</SelectItem>
                        <SelectItem value="3">3. Landstraße</SelectItem>
                        <SelectItem value="4">4. Wieden</SelectItem>
                        <SelectItem value="5">5. Margareten</SelectItem>
                        <SelectItem value="6">6. Mariahilf</SelectItem>
                        <SelectItem value="7">7. Neubau</SelectItem>
                        <SelectItem value="8">8. Josefstadt</SelectItem>
                        <SelectItem value="9">9. Alsergrund</SelectItem>
                        <SelectItem value="10">10. Favoriten</SelectItem>
                        <SelectItem value="11">11. Simmering</SelectItem>
                        <SelectItem value="12">12. Meidling</SelectItem>
                        <SelectItem value="13">13. Hietzing</SelectItem>
                        <SelectItem value="14">14. Penzing</SelectItem>
                        <SelectItem value="15">15. Rudolfsheim-Fünfhaus</SelectItem>
                        <SelectItem value="16">16. Ottakring</SelectItem>
                        <SelectItem value="17">17. Hernals</SelectItem>
                        <SelectItem value="18">18. Währing</SelectItem>
                        <SelectItem value="19">19. Döbling</SelectItem>
                        <SelectItem value="20">20. Brigittenau</SelectItem>
                        <SelectItem value="21">21. Floridsdorf</SelectItem>
                        <SelectItem value="22">22. Donaustadt</SelectItem>
                        <SelectItem value="23">23. Liesing</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Kategorien">Alle Kategorien</SelectItem>
                      <SelectItem value="eigentumswohnung">Eigentumswohnung</SelectItem>
                      <SelectItem value="grundstueck">Grundstück</SelectItem>
                      <SelectItem value="haus">Haus</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={phoneFilter} onValueChange={setPhoneFilter}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle">Alle</SelectItem>
                      <SelectItem value="Nur mit Telefonnummer">Nur mit Telefonnummer</SelectItem>
                      <SelectItem value="Nur ohne Telefonnummer">Nur ohne Telefonnummer</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Quellen">Alle Quellen</SelectItem>
                      <SelectItem value="willhaben">Willhaben</SelectItem>
                      <SelectItem value="derstandard">derStandard</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="w-64 flex flex-col justify-center">
                    <label className="text-sm font-medium mb-2">
                      Preis: €{priceRange[0].toLocaleString()} - €{priceRange[1].toLocaleString()}
                    </label>
                    <Slider
                      value={priceRange}
                      onValueChange={(value) => setPriceRange(value as [number, number])}
                      min={0}
                      max={1500000}
                      step={10000}
                      className="w-full"
                    />
                  </div>
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
                  <div className="col-span-full mb-4 flex items-center justify-between">
                    <p className="text-sm text-gray-600">{listings.length} Listing{listings.length !== 1 ? 's' : ''} gefunden</p>
                    <div className="flex gap-2 items-center">
                      <Select value={sortBy} onValueChange={(val) => setSortBy(val as "scraped_at" | "last_changed_at")}>
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="last_changed_at">Zuletzt geändert</SelectItem>
                          <SelectItem value="scraped_at">Scraping-Datum</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
                      >
                        {sortOrder === "desc" ? "↓ Neueste" : "↑ Älteste"}
                      </Button>
                    </div>
                  </div>
                  {listings
                    .slice()
                    .sort((a, b) => {
                      const aDate = a[sortBy] ? new Date(a[sortBy]!).getTime() : 0;
                      const bDate = b[sortBy] ? new Date(b[sortBy]!).getTime() : 0;
                      return sortOrder === "desc" ? bDate - aDate : aDate - bDate;
                    })
                    .map((listing) => (
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

        {/* Preisspiegel Test Tab - Admin only */}
        {user?.is_admin && activeTab === "preisspiegel-test" && (
          <div className="h-full">
            <PreisspiegelTest />
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
                    <div key={listing.id} className="relative">
                      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${listing.source === 'deleted' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {listing.source === 'deleted' ? 'Gelöscht' : 'Nicht erfolgreich'}
                        </span>
                        {listing.username && (
                          <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                            User: {listing.username}
                          </span>
                        )}
                      </div>
                      <ListingCard
                        listing={listing}
                        onMarkCompleted={handleMarkCompleted}
                        isMarkingCompleted={markCompletedMutation.isPending}
                        user={user}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Team Performance Tab - Admin only */}
        {user?.is_admin && activeTab === "performance" && (
          <div className="h-full">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Team Performance</h2>
                  <p className="text-gray-600 mt-1">
                    Mitarbeiter-Erfolgsraten und Statistiken
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 h-full overflow-y-auto">
              <TeamPerformance />
            </div>
          </div>
        )}

        {/* Successful Acquisitions Tab */}
        {activeTab === "successful" && (
          <div className="h-full">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Erfolgreiche Akquisen</h2>
                  <p className="text-gray-600 mt-1">
                    {user?.is_admin ? 'Alle erfolgreichen Akquisitionen' : 'Ihre erfolgreichen Akquisitionen'}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 h-full overflow-y-auto">
              {successfulLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 animate-pulse">
                      <div className="h-48 bg-gray-200 rounded mb-4"></div>
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              ) : successfulListings.length === 0 ? (
                <div className="text-center py-12">
                  <ChartLine className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                  <p className="text-gray-500">Keine erfolgreichen Akquisen</p>
                  <p className="text-sm text-gray-400 mt-2">
                    {user?.is_admin ? 'Noch keine erfolgreichen Akquisitionen' : 'Sie haben noch keine erfolgreichen Akquisitionen'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  <div className="col-span-full mb-4">
                    <p className="text-sm text-gray-600">{successfulListings.length} erfolgreiche Akquise{successfulListings.length !== 1 ? 'n' : ''}</p>
                  </div>
                  {successfulListings.map((listing) => (
                    <div key={listing.id} className="relative">
                      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-700">
                          Erfolgreich
                        </span>
                        {user?.is_admin && listing.username && (
                          <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                            User: {listing.username}
                          </span>
                        )}
                        {listing.contacted_at && (
                          <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-700">
                            {new Date(listing.contacted_at).toLocaleDateString('de-DE')}
                          </span>
                        )}
                      </div>
                      <ListingCard
                        listing={listing}
                        onMarkCompleted={handleMarkCompleted}
                        isMarkingCompleted={markCompletedMutation.isPending}
                        user={user}
                      />
                      {listing.notes && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                          <p className="text-xs text-gray-600 font-medium mb-1">Notizen:</p>
                          <p className="text-sm text-gray-700">{listing.notes}</p>
                        </div>
                      )}
                    </div>
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
