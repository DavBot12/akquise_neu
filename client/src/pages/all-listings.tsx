import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Building, TrendingDown, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import ListingCard from "@/components/listing-card";
import { Link } from "wouter";
import type { Listing } from "@shared/schema";

interface AllListingsProps {
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

export default function AllListings({ user }: AllListingsProps) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sortBy, setSortBy] = useState<"scraped_at" | "quality_score" | "first_seen_at" | "price">("quality_score");
  const [sourceFilter, setSourceFilter] = useState("Alle Plattformen");
  const [hasPriceDrop, setHasPriceDrop] = useState(false);

  const queryClient = useQueryClient();

  // Fetch paginated listings
  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ["/api/listings/all", page, perPage, sortBy, sourceFilter, hasPriceDrop],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("page", page.toString());
      params.append("per_page", perPage.toString());
      params.append("sortBy", sortBy);
      params.append("akquise_erledigt", "false");
      if (sourceFilter !== "Alle Plattformen") params.append("source", sourceFilter);
      if (hasPriceDrop) params.append("has_price_drop", "true");

      const url = `/api/listings/all?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch listings');
      return response.json();
    },
  });

  const listings = data?.listings || [];
  const pagination = data?.pagination || { page: 1, per_page: 50, total: 0, total_pages: 1 };

  // Mark listing as completed
  const markCompletedMutation = useMutation({
    mutationFn: async ({ id, akquise_erledigt }: { id: number; akquise_erledigt: boolean }) => {
      await apiRequest("PATCH", `/api/listings/${id}/akquise`, { akquise_erledigt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/all"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/listings/all"] });
    },
  });

  const handleDeleteListing = (id: number, reason?: string) => {
    deleteListingMutation.mutate({ id, reason, userId: user?.id });
  };

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [sortBy, sourceFilter, hasPriceDrop, perPage]);

  return (
    <div className="min-h-screen bg-sira-background">
      <div className="max-w-[1600px] mx-auto p-6 md:p-8 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </Link>
          <div>
            <h1 className="text-page-heading text-sira-navy">Alle Inserate</h1>
            <p className="text-sira-text-gray mt-1">
              {pagination.total} Inserate insgesamt
            </p>
          </div>
        </div>

        {/* Stats & Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inserate gesamt</CardTitle>
              <Building className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pagination.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sortierung</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quality_score">Qualität (beste zuerst)</SelectItem>
                  <SelectItem value="scraped_at">Gescraped (neueste zuerst)</SelectItem>
                  <SelectItem value="first_seen_at">Erstmals gesehen</SelectItem>
                  <SelectItem value="price">Preis (niedrigste zuerst)</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Plattform</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Alle Plattformen">Alle Plattformen</SelectItem>
                  <SelectItem value="willhaben">Willhaben</SelectItem>
                  <SelectItem value="derstandard">derStandard</SelectItem>
                  <SelectItem value="immoscout">ImmoScout24</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                Preissenkung
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant={hasPriceDrop ? "default" : "outline"}
                className="w-full"
                onClick={() => setHasPriceDrop(!hasPriceDrop)}
              >
                {hasPriceDrop ? "Nur Preissenkungen" : "Alle anzeigen"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Pagination Controls Top */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-sira-text-gray">
              Seite {pagination.page} von {pagination.total_pages}
            </span>
            <Select value={perPage.toString()} onValueChange={(v) => setPerPage(parseInt(v))}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-sira-text-gray">pro Seite</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Zurück
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
              size="sm"
              onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
              disabled={page === pagination.total_pages}
            >
              Weiter
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Listings Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(6).fill(0).map((_, i) => (
              <Card key={i} className="h-96 animate-pulse bg-gray-100" />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-sira-text-gray">Keine Inserate gefunden.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

        {/* Pagination Controls Bottom */}
        {listings.length > 0 && (
          <div className="flex items-center justify-center gap-2 pt-6">
            <Button
              variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Vorherige Seite
            </Button>

            <span className="px-4 text-sira-text-gray">
              Seite {pagination.page} von {pagination.total_pages}
            </span>

            <Button
              variant="outline"
              onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
              disabled={page === pagination.total_pages}
            >
              Nächste Seite
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
