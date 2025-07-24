import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, ExternalLink, Check, Clock } from "lucide-react";

interface ListingCardProps {
  listing: {
    id: number;
    title: string;
    price: number;
    location: string;
    area: number;
    eur_per_m2: number;
    description: string;
    images: string[];
    url: string;
    scraped_at: string;
    price_evaluation: "unter_schnitt" | "im_schnitt" | "ueber_schnitt";
  };
  onMarkCompleted: (id: number) => void;
  isMarkingCompleted: boolean;
}

export default function ListingCard({ listing, onMarkCompleted, isMarkingCompleted }: ListingCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatScrapedAt = (date: string) => {
    const scraped = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - scraped.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `vor ${diffMinutes}min`;
    } else if (diffHours < 24) {
      return `vor ${diffHours}h`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `vor ${diffDays}d`;
    }
  };

  const getPriceEvaluationBadge = (evaluation: string) => {
    switch (evaluation) {
      case "unter_schnitt":
        return (
          <Badge className="bg-success text-white">
            <Check className="mr-1 h-3 w-3" />
            Unter dem Schnitt
          </Badge>
        );
      case "ueber_schnitt":
        return (
          <Badge className="bg-error text-white">
            <ExternalLink className="mr-1 h-3 w-3" />
            Über dem Schnitt
          </Badge>
        );
      default:
        return (
          <Badge className="bg-warning text-white">
            <Clock className="mr-1 h-3 w-3" />
            Im Schnitt
          </Badge>
        );
    }
  };

  const displayImage = listing.images && listing.images.length > 0 
    ? listing.images[0] 
    : "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=300";

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="relative">
        <img 
          src={displayImage} 
          alt={listing.title}
          className="w-full h-48 object-cover"
        />
        <div className="absolute top-3 left-3">
          {getPriceEvaluationBadge(listing.price_evaluation)}
        </div>
        {listing.images && listing.images.length > 1 && (
          <div className="absolute top-3 right-3">
            <span className="bg-black bg-opacity-60 text-white px-2 py-1 rounded text-xs">
              1/{listing.images.length}
            </span>
          </div>
        )}
      </div>
      
      <CardContent className="p-4">
        <h3 className="font-semibold text-lg text-gray-800 mb-2 line-clamp-2">
          {listing.title}
        </h3>
        
        <div className="flex items-center justify-between mb-3">
          <div className="text-2xl font-bold text-primary">
            {formatPrice(listing.price)}
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">{listing.area} m²</div>
            <div className="text-lg font-semibold text-gray-800">
              {formatPrice(listing.eur_per_m2)}/m²
            </div>
          </div>
        </div>
        
        <div className="flex items-center text-gray-600 mb-3">
          <MapPin className="mr-2 h-4 w-4 text-gray-400" />
          <span className="text-sm">{listing.location}</span>
        </div>
        
        <p className="text-gray-600 text-sm mb-4 line-clamp-3">
          {listing.description || "Keine Beschreibung verfügbar"}
        </p>
        
        <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
          <span>Gescraped: {formatScrapedAt(listing.scraped_at)}</span>
          <span className="text-primary">Privat</span>
        </div>
        
        <div className="flex space-x-2">
          <Button 
            className="flex-1" 
            onClick={() => onMarkCompleted(listing.id)}
            disabled={isMarkingCompleted}
          >
            <Check className="mr-1 h-4 w-4" />
            Akquise erledigt
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.open(listing.url, '_blank')}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
