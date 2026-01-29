import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  ExternalLink,
  Phone,
  Calendar,
  Maximize2,
  Home,
  Euro
} from "lucide-react";
import type { Listing } from "@shared/schema";

interface ListingDetailModalProps {
  listing: Listing | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ListingDetailModal({ listing, isOpen, onClose }: ListingDetailModalProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  if (!listing) return null;

  const hasImages = listing.images && listing.images.length > 0;
  const images = hasImages
    ? listing.images!
    : ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&h=600"];

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (date: Date) => {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getSourceBadge = () => {
    if (listing.source === 'derstandard') {
      return <Badge variant="outline" className="border-blue-500 text-blue-600">derStandard</Badge>;
    } else if (listing.source === 'immoscout') {
      return <Badge variant="outline" className="border-orange-500 text-orange-600">ImmoScout24</Badge>;
    } else {
      return <Badge variant="outline" className="border-green-500 text-green-600">Willhaben</Badge>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 bg-white z-10 px-6 py-4 border-b">
          <DialogTitle className="text-2xl font-bold pr-8">
            {listing.title}
          </DialogTitle>
          <div className="flex items-center gap-2 mt-2">
            {getSourceBadge()}
            <Badge variant="outline" className="text-primary">Privat</Badge>
          </div>
        </DialogHeader>

        {/* Image Gallery */}
        <div className="relative w-full h-[400px] bg-gray-100">
          <img
            src={images[currentImageIndex]}
            alt={`Bild ${currentImageIndex + 1}`}
            className="w-full h-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&h=600";
            }}
          />
          {hasImages && images.length > 1 && (
            <>
              <div className="absolute top-4 right-4 bg-black bg-opacity-60 text-white px-3 py-1 rounded-full text-sm font-medium">
                {currentImageIndex + 1} / {images.length}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-60 hover:bg-opacity-80 text-white h-12 w-12"
                onClick={prevImage}
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-60 hover:bg-opacity-80 text-white h-12 w-12"
                onClick={nextImage}
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </>
          )}
        </div>

        {/* Thumbnail Gallery */}
        {hasImages && images.length > 1 && (
          <div className="px-6 py-3 flex gap-2 overflow-x-auto">
            {images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentImageIndex(idx)}
                className={`flex-shrink-0 w-20 h-20 rounded border-2 transition-all ${
                  idx === currentImageIndex
                    ? 'border-primary ring-2 ring-primary ring-offset-2'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <img
                  src={img}
                  alt={`Thumbnail ${idx + 1}`}
                  className="w-full h-full object-cover rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&h=200";
                  }}
                />
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Price & Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-full">
                <Euro className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Preis</div>
                <div className="text-2xl font-bold text-primary">{formatPrice(listing.price)}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-3 rounded-full">
                <Maximize2 className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Fläche</div>
                <div className="text-xl font-bold">{listing.area ? `${listing.area} m²` : 'N/A'}</div>
                {listing.eur_per_m2 && (
                  <div className="text-sm text-gray-500">
                    {formatPrice(Number(listing.eur_per_m2))}/m²
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-green-100 p-3 rounded-full">
                <Home className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Kategorie</div>
                <div className="text-xl font-bold capitalize">
                  {listing.category === 'eigentumswohnung' ? 'Wohnung' :
                   listing.category === 'haus' ? 'Haus' :
                   listing.category}
                </div>
                <div className="text-sm text-gray-500 capitalize">{listing.region}</div>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="flex items-start gap-2 mb-4 text-gray-700">
            <MapPin className="h-5 w-5 mt-1 flex-shrink-0" />
            <span className="text-base">{listing.location}</span>
          </div>

          {/* Phone */}
          {listing.phone_number && (
            <div className="flex items-center gap-2 mb-4">
              <Phone className="h-5 w-5 text-primary" />
              <a
                href={`tel:${listing.phone_number}`}
                className="text-primary font-medium hover:underline"
              >
                {listing.phone_number}
              </a>
            </div>
          )}

          {/* Dates */}
          <div className="flex flex-wrap gap-4 mb-6 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Gescraped: {formatDate(listing.scraped_at)}</span>
            </div>
            {listing.first_seen_at && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Erstmals gesehen: {formatDate(listing.first_seen_at)}</span>
              </div>
            )}
            {listing.last_changed_at && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Zuletzt geändert: {formatDate(listing.last_changed_at)}</span>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-3">Beschreibung</h3>
            {listing.description ? (
              <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                  {listing.description}
                </p>
              </div>
            ) : (
              <p className="text-gray-500 italic">Keine Beschreibung verfügbar</p>
            )}
          </div>

          {/* External Link */}
          <div className="mt-6 pt-6 border-t">
            <Button asChild className="w-full" size="lg">
              <a href={listing.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-5 w-5" />
                Original-Inserat öffnen
              </a>
            </Button>
          </div>

          {/* Last Changed Info */}
          {listing.last_changed_at && (
            <div className="mt-4 pt-4 border-t text-center text-sm text-gray-500">
              <span>Zuletzt geändert am: {new Date(listing.last_changed_at).toLocaleDateString('de-AT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}</span>
              {listing.last_change_type && (
                <span className="ml-2 text-primary font-medium">
                  ({listing.last_change_type})
                </span>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
