import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MapPin,
  Ban,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

interface GeoBlockedListing {
  id: number;
  title: string;
  price: number;
  location: string;
  area: string | null;
  eur_per_m2: string | null;
  url: string;
  category: string;
  region: string;
  source: string;
  block_reason: string;
  blocked_at: string;
  plz: string | null;
  ort: string | null;
}

interface GeoBlockedStats {
  total: number;
  by_reason: Record<string, number>;
  by_region: Record<string, number>;
  by_source: Record<string, number>;
}

export default function BlockedListings({ user }: { user: { id: number; username: string; is_admin?: boolean } }) {
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");

  // Fetch blocked listings
  const { data: listings, isLoading: listingsLoading } = useQuery<GeoBlockedListing[]>({
    queryKey: ["geo-blocked-listings", sourceFilter, regionFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.append("source", sourceFilter);
      if (regionFilter !== "all") params.append("region", regionFilter);
      params.append("limit", "200");
      const res = await fetch(`/api/geo-blocked-listings?${params}`);
      if (!res.ok) throw new Error("Failed to fetch blocked listings");
      return res.json();
    },
  });

  // Fetch stats
  const { data: stats } = useQuery<GeoBlockedStats>({
    queryKey: ["geo-blocked-stats"],
    queryFn: async () => {
      const res = await fetch("/api/geo-blocked-stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("de-AT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case "willhaben": return "bg-orange-500";
      case "derstandard": return "bg-blue-500";
      case "immoscout": return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Zurück zu Settings
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Ban className="w-6 h-6 text-red-500" />
              Blockierte Listings
            </h1>
            <p className="text-muted-foreground text-sm">
              Listings die aufgrund des Geo-Filters nicht angezeigt werden
            </p>
          </div>
        </div>

        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Gesamt Blockiert</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-500">{stats.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Nach Quelle</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {Object.entries(stats.by_source).map(([source, count]) => (
                  <div key={source} className="flex justify-between text-sm">
                    <span className="capitalize">{source}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Nach Region</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {Object.entries(stats.by_region).map(([region, count]) => (
                  <div key={region} className="flex justify-between text-sm">
                    <span className="capitalize">{region}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Top Block-Gründe</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {Object.entries(stats.by_reason)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([reason, count]) => (
                    <div key={reason} className="flex justify-between text-sm">
                      <span className="truncate max-w-[150px]" title={reason}>{reason}</span>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filter</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            <div className="w-48">
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Quelle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Quellen</SelectItem>
                  <SelectItem value="willhaben">Willhaben</SelectItem>
                  <SelectItem value="derstandard">Der Standard</SelectItem>
                  <SelectItem value="immoscout">ImmoScout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Regionen</SelectItem>
                  <SelectItem value="wien">Wien</SelectItem>
                  <SelectItem value="niederoesterreich">Niederösterreich</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Listings Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Blockierte Listings ({listings?.length || 0})</CardTitle>
            <CardDescription>Zeigt die letzten 200 blockierten Listings</CardDescription>
          </CardHeader>
          <CardContent>
            {listingsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Lade...</div>
            ) : listings && listings.length > 0 ? (
              <div className="space-y-2">
                {listings.map((listing) => (
                  <div
                    key={listing.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getSourceColor(listing.source)} variant="secondary">
                          {listing.source}
                        </Badge>
                        <span className="font-semibold">{formatPrice(listing.price)}</span>
                        {listing.area && (
                          <span className="text-sm text-muted-foreground">
                            {listing.area} m²
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium truncate">{listing.title}</div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {listing.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <Ban className="w-3 h-3 text-red-500" />
                          {listing.block_reason}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(listing.blocked_at)}
                      </span>
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Keine blockierten Listings gefunden
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
