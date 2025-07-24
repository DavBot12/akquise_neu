import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, TrendingUp, TrendingDown, Euro, Home, TreePine } from "lucide-react";
import { useState } from "react";

interface PriceStats {
  region: string;
  category: string;
  avgPrice: number;
  avgPricePerM2: number;
  totalListings: number;
  privateListings: number;
  commercialListings: number;
  priceRange: {
    min: number;
    max: number;
  };
}

export default function PriceMirror() {
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Fetch price statistics
  const { data: priceStats = [], isLoading } = useQuery<PriceStats[]>({
    queryKey: ["/api/price-stats", { region: selectedRegion, category: selectedCategory }],
  });

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-AT', { 
      style: 'currency', 
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  const formatPricePerM2 = (price: number) => {
    return new Intl.NumberFormat('de-AT', { 
      style: 'currency', 
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price) + '/m²';
  };

  const getCategoryIcon = (category: string) => {
    if (category.includes('eigentumswohnung')) {
      return <Home className="h-5 w-5 text-blue-500" />;
    }
    return <TreePine className="h-5 w-5 text-green-500" />;
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'eigentumswohnung':
        return 'Eigentumswohnungen';
      case 'grundstuecke':
        return 'Grundstücke';
      default:
        return category;
    }
  };

  const getRegionLabel = (region: string) => {
    switch (region) {
      case 'wien':
        return 'Wien';
      case 'niederoesterreich':
        return 'Niederösterreich';
      default:
        return region;
    }
  };

  const getTrendIndicator = (current: number, avg: number) => {
    const diff = ((current - avg) / avg) * 100;
    if (Math.abs(diff) < 5) return null;
    
    return diff > 0 ? (
      <TrendingUp className="h-4 w-4 text-red-500" />
    ) : (
      <TrendingDown className="h-4 w-4 text-green-500" />
    );
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                <div className="h-4 bg-gray-200 rounded w-4/6"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Filter Controls */}
      <div className="flex space-x-4 mb-6">
        <Select value={selectedRegion} onValueChange={setSelectedRegion}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Regionen</SelectItem>
            <SelectItem value="wien">Wien</SelectItem>
            <SelectItem value="niederoesterreich">Niederösterreich</SelectItem>
          </SelectContent>
        </Select>
        
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kategorien</SelectItem>
            <SelectItem value="eigentumswohnung">Eigentumswohnungen</SelectItem>
            <SelectItem value="grundstuecke">Grundstücke</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Price Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {priceStats.map((stat, index) => (
          <Card key={index} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {getCategoryIcon(stat.category)}
                  <span className="text-lg font-semibold">
                    {getCategoryLabel(stat.category)}
                  </span>
                </div>
                <Badge variant="outline" className="flex items-center space-x-1">
                  <MapPin className="h-3 w-3" />
                  <span>{getRegionLabel(stat.region)}</span>
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Average Price per m² */}
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Euro className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">Ø Preis/m²:</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-lg font-bold text-blue-900">
                    {formatPricePerM2(stat.avgPricePerM2)}
                  </span>
                </div>
              </div>

              {/* Average Total Price */}
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Euro className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-900">Ø Gesamtpreis:</span>
                </div>
                <span className="text-lg font-bold text-green-900">
                  {formatPrice(stat.avgPrice)}
                </span>
              </div>

              {/* Price Range */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Preisspanne:</span>
                  <span className="font-medium">
                    {formatPrice(stat.priceRange.min)} - {formatPrice(stat.priceRange.max)}
                  </span>
                </div>
              </div>

              {/* Listing Statistics */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900">{stat.totalListings}</div>
                  <div className="text-xs text-gray-600">Gesamt</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{stat.privateListings}</div>
                  <div className="text-xs text-gray-600">Privat</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-600">{stat.commercialListings}</div>
                  <div className="text-xs text-gray-600">Gewerblich</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        
        {priceStats.length === 0 && (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-500">Keine Preisdaten verfügbar</p>
            <p className="text-sm text-gray-400 mt-2">
              Starten Sie den Scraper um Preisdaten zu sammeln
            </p>
          </div>
        )}
      </div>
    </>
  );
}