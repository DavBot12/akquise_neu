import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Database, Play, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function PriceMirrorControl() {
  const queryClient = useQueryClient();

  // Fetch price mirror data
  const { data: priceMirrorData = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/price-mirror-data"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Start price mirror scraper mutation
  const startPriceMirrorMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/scraper/price-mirror", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-mirror-data"] });
    },
  });

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString('de-AT');
  };

  const getCategoryLabel = (category: string) => {
    const labels: { [key: string]: string } = {
      'eigentumswohnung': 'Eigentumswohnung',
      'haus': 'Haus',
      'grundstuecke': 'Grundstücke'
    };
    return labels[category] || category;
  };

  const getRegionLabel = (region: string) => {
    const labels: { [key: string]: string } = {
      'wien': 'Wien',
      'niederoesterreich': 'Niederösterreich',
      'oberoesterreich': 'Oberösterreich',
      'salzburg': 'Salzburg',
      'tirol': 'Tirol',
      'vorarlberg': 'Vorarlberg',
      'kaernten': 'Kärnten',
      'steiermark': 'Steiermark',
      'burgenland': 'Burgenland'
    };
    return labels[region] || region;
  };

  // Group data by category and region
  const groupedData = priceMirrorData.reduce((acc: any, item: any) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Preisspiegel Scraper</h2>
          <p className="text-muted-foreground">
            Tägliche Marktdaten-Erfassung für den Immobilienpreisspiegel
          </p>
        </div>
        <Button 
          onClick={() => startPriceMirrorMutation.mutate()}
          disabled={startPriceMirrorMutation.isPending}
        >
          <Play className="mr-2 h-4 w-4" />
          {startPriceMirrorMutation.isPending ? "Läuft..." : "Jetzt scrapen"}
        </Button>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Letzte Aktualisierung</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {priceMirrorData.length > 0 
                ? formatDate(priceMirrorData[0].scraped_at)
                : "Nie"}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Regionen erfasst</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(priceMirrorData.map((item: any) => item.region)).size}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kategorien erfasst</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Object.keys(groupedData).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Overview */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Aktuelle Marktdaten</h3>
        
        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground">
                Lade Preisspiegel-Daten...
              </div>
            </CardContent>
          </Card>
        ) : priceMirrorData.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground">
                Noch keine Preisspiegel-Daten verfügbar. 
                <br />
                Klicken Sie auf "Jetzt scrapen" um zu starten.
              </div>
            </CardContent>
          </Card>
        ) : (
          Object.entries(groupedData).map(([category, items]: [string, any]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {getCategoryLabel(category)}
                  <Badge variant="secondary">{items.length} Regionen</Badge>
                </CardTitle>
                <CardDescription>
                  Durchschnittspreise nach Region
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {items
                    .sort((a: any, b: any) => a.region.localeCompare(b.region))
                    .map((item: any) => (
                    <div 
                      key={`${item.category}-${item.region}`}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="font-medium">{getRegionLabel(item.region)}</div>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <div>Ø Preis: <strong>{formatPrice(item.average_price || 0)}</strong></div>
                        {item.average_area && (
                          <div>Ø Fläche: <strong>{item.average_area}m²</strong></div>
                        )}
                        {item.price_per_sqm && (
                          <div>Ø €/m²: <strong>{formatPrice(item.price_per_sqm)}</strong></div>
                        )}
                        <div>Objekte: <strong>{item.sample_size || 0}</strong></div>
                        <div className="text-xs">
                          {formatDate(item.scraped_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Schedule Info */}
      <Card>
        <CardHeader>
          <CardTitle>Automatischer Zeitplan</CardTitle>
          <CardDescription>
            Der Preisspiegel-Scraper läuft automatisch täglich um 3:00 Uhr und aktualisiert die Marktdaten
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div>• <strong>Täglich:</strong> 3:00 Uhr automatische Aktualisierung</div>
            <div>• <strong>Kategorien:</strong> Eigentumswohnungen, Häuser, Grundstücke</div>
            <div>• <strong>Regionen:</strong> Alle österreichischen Bundesländer</div>
            <div>• <strong>Datenquellen:</strong> Willhaben.at (ohne PRIVAT-Filter)</div>
            <div>• <strong>Verwendung:</strong> Marktpreise für Preisspiegel-Tab</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}