import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building, TrendingUp, ChartLine, TrendingDown, ChevronLeft, ChevronRight, MapPin, Home, Globe, Phone, Euro, ArrowUpDown, LayoutGrid, X, Filter } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import ListingCard from "@/components/listing-card";
import { ListingDetailModal } from "@/components/listing-detail-modal";
import { useWebSocket } from "@/hooks/use-websocket";
import type { Listing } from "@shared/schema";

interface DashboardProps {
  user: { id: number; username: string; is_admin?: boolean };
}

interface PaginatedResponse {
  listings: Listing[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export default function Dashboard({ user }: DashboardProps) {
  const [regionFilter, setRegionFilter] = useState("Alle Regionen");
  const [bezirkFilter, setBezirkFilter] = useState("Alle Bezirke");
  const [categoryFilter, setCategoryFilter] = useState("Alle Kategorien");
  const [sourceFilter, setSourceFilter] = useState("Alle Plattformen");
  const [phoneFilter, setPhoneFilter] = useState("Alle");
  const [priceDropFilter, setPriceDropFilter] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5500000]);
  const [sortBy, setSortBy] = useState<"quality_score" | "scraped_at" | "first_seen_at" | "price" | "last_changed_at">("last_changed_at");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // URL parameter support for deep-linking to specific listings (e.g., from email alerts)
  const [urlListingId, setUrlListingId] = useState<number | null>(null);
  const [showUrlListingModal, setShowUrlListingModal] = useState(false);

  const queryClient = useQueryClient();

  // WebSocket connection for real-time updates
  useWebSocket("/ws", {
    onMessage: (data) => {
      if (data.type === "newListing") {
        queryClient.invalidateQueries({ queryKey: ["/api/listings/all"] });
        queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
      }
    },
  });

  // Reset Bezirk filter when region changes to non-Wien
  useEffect(() => {
    if (regionFilter !== "wien") {
      setBezirkFilter("Alle Bezirke");
    }
  }, [regionFilter]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [regionFilter, bezirkFilter, categoryFilter, sourceFilter, phoneFilter, priceDropFilter, priceRange, sortBy, perPage]);

  // Handle URL parameter for deep-linking to specific listings (e.g., from email alerts)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const listingParam = params.get('listing');
    if (listingParam) {
      const id = parseInt(listingParam, 10);
      if (!isNaN(id)) {
        setUrlListingId(id);
        setShowUrlListingModal(true);
        // Remove the param from URL after reading it
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  // Fetch specific listing from URL parameter
  const { data: urlListing } = useQuery<Listing>({
    queryKey: ["/api/listings/by-id", urlListingId],
    queryFn: async () => {
      const response = await fetch(`/api/listings/by-id/${urlListingId}`);
      if (!response.ok) throw new Error('Failed to fetch listing');
      return response.json();
    },
    enabled: !!urlListingId,
  });

  // Fetch paginated listings
  const { data, isLoading: listingsLoading } = useQuery<PaginatedResponse>({
    queryKey: ["/api/listings/all", page, perPage, sortBy, regionFilter, bezirkFilter, categoryFilter, sourceFilter, phoneFilter, priceDropFilter, priceRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("page", page.toString());
      params.append("per_page", perPage.toString());
      params.append("sortBy", sortBy);
      params.append("akquise_erledigt", "false");

      if (regionFilter !== "Alle Regionen") params.append("region", regionFilter);
      if (bezirkFilter !== "Alle Bezirke") params.append("district", bezirkFilter);
      if (categoryFilter !== "Alle Kategorien") params.append("category", categoryFilter);
      if (sourceFilter !== "Alle Plattformen") params.append("source", sourceFilter);
      if (phoneFilter === "Nur mit Telefonnummer") params.append("has_phone", "true");
      if (phoneFilter === "Nur ohne Telefonnummer") params.append("has_phone", "false");
      if (priceDropFilter) params.append("has_price_drop", "true");
      if (priceRange[0] > 0) params.append("min_price", priceRange[0].toString());
      if (priceRange[1] < 5500000) params.append("max_price", priceRange[1].toString());

      const url = `/api/listings/all?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch listings');
      return response.json();
    },
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });

  const listings = data?.listings || [];
  const pagination = data?.pagination || { page: 1, per_page: 50, total: 0, total_pages: 1 };

  // Fetch stats
  const { data: stats } = useQuery<{
    activeListings: number;
    completedListings: number;
    lastScrape: string | null;
  }>({
    queryKey: ["/api/listings/stats"],
    refetchInterval: 30000,
  });

  // Mark listing as completed
  const markCompletedMutation = useMutation({
    mutationFn: async ({ id, akquise_erledigt, is_success }: { id: number; akquise_erledigt: boolean; is_success?: boolean }) => {
      await apiRequest("PATCH", `/api/listings/${id}/akquise`, { akquise_erledigt, is_success, userId: user?.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
    },
  });

  const handleMarkCompleted = (id: number, isSuccess?: boolean) => {
    markCompletedMutation.mutate({ id, akquise_erledigt: true, is_success: isSuccess });
  };

  // Delete listing mutation
  const deleteListingMutation = useMutation({
    mutationFn: async ({ id, reason, userId, deleteType }: { id: number; reason?: string; userId?: number; deleteType?: string }) => {
      await apiRequest("DELETE", `/api/listings/${id}`, { reason, userId, deleteType });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings/stats"] });
    },
  });

  const handleDeleteListing = (id: number, reason?: string, deleteType?: string) => {
    deleteListingMutation.mutate({ id, reason, userId: user?.id, deleteType });
  };

  return (
    <div className="min-h-screen bg-sira-background">
      <div className="max-w-[1600px] mx-auto p-6 md:p-8 space-y-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-page-heading text-sira-navy">Dashboard</h1>
          <p className="text-sira-text-gray mt-2">Aktive Immobilien-Inserate</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Aktive Inserate</CardTitle>
              <Building className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.activeListings ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Erledigte Akquisen (ganzes Team)</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.completedListings ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Letzter Scrape</CardTitle>
              <ChartLine className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                {stats?.lastScrape
                  ? new Date(stats.lastScrape).toLocaleString("de-DE")
                  : "Noch kein Scrape"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            {/* Main Filters Row */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-6">
              {/* Left Section - Location & Property */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <MapPin className="h-4 w-4" />
                  <span>Standort & Objekt</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger className="w-[140px] h-9 text-sm">
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
                      <SelectTrigger className="w-[130px] h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Alle Bezirke">Alle Bezirke</SelectItem>
                        {Array.from({ length: 23 }, (_, i) => i + 1).map(num => (
                          <SelectItem key={num} value={`${num}`}>{num}. Bezirk</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[130px] h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Kategorien">Alle Kategorien</SelectItem>
                      <SelectItem value="eigentumswohnung">Wohnung</SelectItem>
                      <SelectItem value="haus">Haus</SelectItem>
                      <SelectItem value="grundstueck">Grundstück</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Middle Section - Source & Phone */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <Globe className="h-4 w-4" />
                  <span>Quelle & Kontakt</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[140px] h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Plattformen">Alle Plattformen</SelectItem>
                      <SelectItem value="willhaben">Willhaben</SelectItem>
                      <SelectItem value="derstandard">derStandard</SelectItem>
                      <SelectItem value="immoscout">ImmoScout24</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={phoneFilter} onValueChange={setPhoneFilter}>
                    <SelectTrigger className="w-[160px] h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle">Alle Telefon</SelectItem>
                      <SelectItem value="Nur mit Telefonnummer">Mit Telefon</SelectItem>
                      <SelectItem value="Nur ohne Telefonnummer">Ohne Telefon</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant={priceDropFilter ? "default" : "outline"}
                    size="sm"
                    className={`h-9 ${priceDropFilter ? 'bg-red-500 hover:bg-red-600 text-white border-red-500' : 'hover:bg-red-50 hover:text-red-600 hover:border-red-200'}`}
                    onClick={() => setPriceDropFilter(!priceDropFilter)}
                  >
                    <TrendingDown className="h-3.5 w-3.5 mr-1.5" />
                    Preissenkung
                  </Button>
                </div>
              </div>

              {/* Right Section - Price Range */}
              <div className="space-y-4 min-w-[280px]">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <Euro className="h-4 w-4" />
                  <span>Preisbereich</span>
                </div>
                <div className="px-1">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium">€ {priceRange[0].toLocaleString('de-DE')}</span>
                    <span className="font-medium">€ {priceRange[1].toLocaleString('de-DE')}</span>
                  </div>
                  <Slider
                    value={priceRange}
                    onValueChange={(value) => setPriceRange(value as [number, number])}
                    min={0}
                    max={5500000}
                    step={10000}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Min</span>
                    <span>Max</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t my-5" />

            {/* Bottom Row - Sort & Display */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ArrowUpDown className="h-4 w-4" />
                </div>
                <Select value={sortBy} onValueChange={(val) => setSortBy(val as typeof sortBy)}>
                  <SelectTrigger className="w-[180px] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last_changed_at">Zuletzt geändert</SelectItem>
                    <SelectItem value="quality_score">Qualität (Beste)</SelectItem>
                    <SelectItem value="first_seen_at">Erstmals gesehen</SelectItem>
                    <SelectItem value="price">Preis (Niedrigste)</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2 text-sm text-muted-foreground ml-2">
                  <LayoutGrid className="h-4 w-4" />
                </div>
                <Select value={perPage.toString()} onValueChange={(v) => setPerPage(parseInt(v))}>
                  <SelectTrigger className="w-[100px] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">pro Seite</span>
              </div>

              {/* Active Filters / Reset */}
              {(regionFilter !== "Alle Regionen" || categoryFilter !== "Alle Kategorien" || sourceFilter !== "Alle Plattformen" || phoneFilter !== "Alle" || priceDropFilter || priceRange[0] > 0 || priceRange[1] < 5500000) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setRegionFilter("Alle Regionen");
                    setBezirkFilter("Alle Bezirke");
                    setCategoryFilter("Alle Kategorien");
                    setSourceFilter("Alle Plattformen");
                    setPhoneFilter("Alle");
                    setPriceDropFilter(false);
                    setPriceRange([0, 5500000]);
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Filter zurücksetzen
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pagination Top */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {pagination.total} {pagination.total === 1 ? 'Inserat' : 'Inserate'}
            {priceDropFilter && <span className="text-red-500 ml-2">(mit Preissenkung)</span>}
          </h2>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <span className="text-sm text-sira-text-gray px-2">
              Seite {pagination.page} von {pagination.total_pages}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
              disabled={page === pagination.total_pages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Listings */}
        {listingsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array(6).fill(0).map((_, i) => (
              <Card key={i} className="h-96 animate-pulse bg-gray-100" />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Building className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Keine Inserate gefunden</p>
            <p className="text-sm mt-2">Passe die Filter an oder starte einen Scraper</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

        {/* Pagination Bottom */}
        {listings.length > 0 && pagination.total_pages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Vorherige
            </Button>

            {/* Page Numbers */}
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.total_pages) }, (_, i) => {
                let pageNum: number;
                if (pagination.total_pages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= pagination.total_pages - 2) {
                  pageNum = pagination.total_pages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(pageNum)}
                    className="w-10"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
              disabled={page === pagination.total_pages}
            >
              Nächste
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </div>

      {/* Modal for URL-linked listing (from email alerts) */}
      {urlListing && (
        <ListingDetailModal
          listing={urlListing}
          isOpen={showUrlListingModal}
          onClose={() => {
            setShowUrlListingModal(false);
            setUrlListingId(null);
          }}
        />
      )}
    </div>
  );
}
