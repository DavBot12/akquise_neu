import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building, TrendingUp, ChartLine } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import ListingCard from "@/components/listing-card";
import { useWebSocket } from "@/hooks/use-websocket";
import type { Listing } from "@shared/schema";

interface DashboardProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function Dashboard({ user }: DashboardProps) {
  const [regionFilter, setRegionFilter] = useState("Alle Regionen");
  const [bezirkFilter, setBezirkFilter] = useState("Alle Bezirke");
  const [categoryFilter, setCategoryFilter] = useState("Alle Kategorien");
  const [phoneFilter, setPhoneFilter] = useState("Alle");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1500000]);
  const [sortBy, setSortBy] = useState<"scraped_at" | "last_changed_at" | "first_seen_at">("last_changed_at");
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

  // Reset Bezirk filter when region changes to non-Wien
  useEffect(() => {
    if (regionFilter !== "wien") {
      setBezirkFilter("Alle Bezirke");
    }
  }, [regionFilter]);

  // Fetch active listings
  const { data: listings = [], isLoading: listingsLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", regionFilter, bezirkFilter, categoryFilter, phoneFilter, priceRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (regionFilter !== "Alle Regionen") params.append("region", regionFilter);
      if (bezirkFilter !== "Alle Bezirke") params.append("district", bezirkFilter);
      if (categoryFilter !== "Alle Kategorien") params.append("category", categoryFilter);
      if (phoneFilter === "Nur mit Telefonnummer") params.append("has_phone", "true");
      if (phoneFilter === "Nur ohne Telefonnummer") params.append("has_phone", "false");
      if (priceRange[0] > 0) params.append("min_price", priceRange[0].toString());
      if (priceRange[1] < 1500000) params.append("max_price", priceRange[1].toString());
      params.append("akquise_erledigt", "false");

      const url = `/api/listings${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch listings');
      return response.json();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

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

  // Sort listings
  const sortedListings = [...listings].sort((a, b) => {
    let aValue: number;
    let bValue: number;

    if (sortBy === "scraped_at") {
      aValue = new Date(a.scraped_at).getTime();
      bValue = new Date(b.scraped_at).getTime();
    } else if (sortBy === "first_seen_at") {
      aValue = new Date(a.first_seen_at).getTime();
      bValue = new Date(b.first_seen_at).getTime();
    } else {
      aValue = new Date(a.last_changed_at || a.scraped_at).getTime();
      bValue = new Date(b.last_changed_at || b.scraped_at).getTime();
    }

    return sortOrder === "desc" ? bValue - aValue : aValue - bValue;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Aktive Immobilien-Inserate</p>
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
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
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
                  {Array.from({ length: 23 }, (_, i) => i + 1).map(num => (
                    <SelectItem key={num} value={`${num}. Bezirk`}>{num}. Bezirk</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Alle Kategorien">Alle Kategorien</SelectItem>
                <SelectItem value="eigentumswohnung">Wohnung</SelectItem>
                <SelectItem value="haus">Haus</SelectItem>
                <SelectItem value="grundstueck">Grundstück</SelectItem>
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

          <div className="flex gap-4 mt-4">
            <Select value={sortBy} onValueChange={(val) => setSortBy(val as "scraped_at" | "last_changed_at" | "first_seen_at")}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="first_seen_at">Sortieren: Erstmals gesehen</SelectItem>
                <SelectItem value="scraped_at">Sortieren: Scrape-Datum</SelectItem>
                <SelectItem value="last_changed_at">Sortieren: Änderungsdatum</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortOrder} onValueChange={(val) => setSortOrder(val as "asc" | "desc")}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Neueste zuerst</SelectItem>
                <SelectItem value="asc">Älteste zuerst</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Listings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            {sortedListings.length} {sortedListings.length === 1 ? 'Inserat' : 'Inserate'}
          </h2>
        </div>

        {listingsLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Lade Inserate...</div>
          </div>
        ) : sortedListings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Building className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Keine Inserate gefunden</p>
            <p className="text-sm mt-2">Passe die Filter an oder starte einen Scraper</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedListings.map((listing) => (
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
  );
}
