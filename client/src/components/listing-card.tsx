import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AkquiseModal } from "@/components/akquise-modal";
import { ListingDetailModal } from "@/components/listing-detail-modal";
import { MapPin, ExternalLink, Check, Clock, ChevronLeft, ChevronRight, Phone, Trash2, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import type { Listing } from "@shared/schema";

interface ListingCardProps {
  listing: Listing;
  onMarkCompleted: (id: number) => void;
  isMarkingCompleted: boolean;
  onDelete?: (id: number, reason?: string) => void;
  user?: { id: number; username: string };
}

export default function ListingCard({ listing, onMarkCompleted, isMarkingCompleted, onDelete, user }: ListingCardProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showAkquiseModal, setShowAkquiseModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const { toast } = useToast();
  
  const hasImages = listing.images && listing.images.length > 0;
  const images = hasImages ? listing.images! : ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=300"];
  
  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };
  
  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };
  const formatPrice = (price: number) => {
    if (price === 0) {
      return 'Preis auf Anfrage';
    }
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatScrapedAt = (date: Date) => {
    const scraped = date instanceof Date ? date : new Date(date);
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

  const formatLastChanged = (date: Date | null) => {
    if (!date) return null;
    const changed = date instanceof Date ? date : new Date(date);
    return changed.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFirstSeen = (date: Date) => {
    const firstSeen = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - firstSeen.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        return `vor ${diffMinutes}min`;
      }
      return `vor ${diffHours}h`;
    } else if (diffDays === 1) {
      return 'vor 1 Tag';
    } else {
      return `vor ${diffDays} Tagen`;
    }
  };

  const formatPublishedAt = (date: Date | null) => {
    if (!date) return null;
    const published = date instanceof Date ? date : new Date(date);
    return published.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPriceEvaluationBadge = (evaluation: string) => {
    switch (evaluation) {
      case "unter_schnitt":
        return (
          <Badge className="bg-sira-success text-white">
            Unter dem Schnitt
          </Badge>
        );
      case "ueber_schnitt":
        return (
          <Badge className="bg-sira-danger text-white">
            Über dem Schnitt
          </Badge>
        );
      default:
        return (
          <Badge className="bg-sira-warning text-white">
            Im Schnitt
          </Badge>
        );
    }
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-smooth h-full flex flex-col border-sira-light-gray">
      <div className="relative">
        <img
          src={images[currentImageIndex]}
          alt={listing.title}
          className="w-full h-48 object-cover"
        />
        {images.length > 1 && (
          <>
            <div className="absolute top-3 right-3">
              <span className="bg-black bg-opacity-60 text-white px-2 py-1 rounded text-xs">
                {currentImageIndex + 1}/{images.length}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white p-1 h-8 w-8"
              onClick={prevImage}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"  
              size="sm"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white p-1 h-8 w-8"
              onClick={nextImage}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <CardContent className="p-5 flex-1 flex flex-col">
        <h3 className="text-card-title text-sira-navy mb-4 line-clamp-2">
          {listing.title}
        </h3>

        <div className="flex items-center justify-between mb-4">
          <div className="text-2xl font-semibold text-sira-navy">
            {formatPrice(listing.price)}
          </div>
          <div className="text-right">
            <div className="text-xs text-sira-medium-gray">{listing.area ? `${listing.area} m²` : "N/A"}</div>
            <div className="text-sm font-semibold text-sira-text-gray">
              {listing.price === 0 ? "—" : listing.eur_per_m2 ? `${formatPrice(Number(listing.eur_per_m2))}/m²` : "N/A"}
            </div>
          </div>
        </div>

        <div className="flex items-center text-sira-text-gray mb-4">
          <MapPin className="mr-2 h-4 w-4 text-sira-medium-gray" />
          <span className="text-sm">{listing.location}</span>
        </div>

        <div className="flex items-center text-sira-text-gray mb-5">
          <Phone className="mr-2 h-4 w-4 text-sira-medium-gray" />
          {listing.phone_number ? (
            <a
              href={`tel:${listing.phone_number}`}
              className="text-sm text-sira-navy hover:underline transition-smooth"
            >
              {listing.phone_number}
            </a>
          ) : (
            <span className="text-sm text-sira-medium-gray">Anschreiben</span>
          )}
        </div>

        {listing.description && listing.description.length > 0 ? (
          <p className="text-sira-text-gray text-sm mb-4 line-clamp-3">
            {listing.description}
          </p>
        ) : (
          <p className="text-sira-medium-gray text-sm mb-4 italic">
            Keine Beschreibung verfügbar
          </p>
        )}

        <div className="flex flex-col gap-2 text-sm text-sira-medium-gray mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs">Gescraped: {formatScrapedAt(listing.scraped_at)}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-sira-navy">Privat</span>
              {listing.source === 'derstandard' ? (
                <Badge variant="outline" className="text-xs px-2 py-0.5 border-sira-info text-sira-info">
                  derStandard
                </Badge>
              ) : listing.source === 'immoscout' ? (
                <Badge variant="outline" className="text-xs px-2 py-0.5 border-sira-warning text-sira-warning">
                  ImmoScout24
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs px-2 py-0.5 border-sira-success text-sira-success">
                  Willhaben
                </Badge>
              )}
            </div>
          </div>
          {listing.first_seen_at && (
            <div className="text-xs text-sira-medium-gray">
              Erstmals gesehen: {formatFirstSeen(listing.first_seen_at)}
            </div>
          )}
          {listing.published_at && listing.source === 'willhaben' && (
            <div className="text-xs text-sira-medium-gray">
              Inserat veröffentlicht am: {formatPublishedAt(listing.published_at)}
            </div>
          )}
          {listing.last_changed_at && (
            <div className="text-xs text-sira-medium-gray">
              Zuletzt geändert: {formatLastChanged(listing.last_changed_at)}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-auto">
          <Button
            className="flex-1 bg-sira-navy hover:bg-sira-navy/90 text-white transition-smooth"
            onClick={() => setShowAkquiseModal(true)}
            disabled={isMarkingCompleted}
          >
            {listing.akquise_erledigt ? "Erledigt" : "Akquise erledigt"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetailModal(true)}
            title="Details anzeigen"
            className="border-sira-light-gray hover:bg-sira-background hover:text-sira-navy transition-smooth"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(listing.url, '_blank')}
            title="Original-Anzeige öffnen"
            className="border-sira-light-gray hover:bg-sira-background hover:text-sira-navy transition-smooth"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm("Dieses Inserat als unattraktiv markieren und ausblenden?")) {
                  onDelete(listing.id, "Unattraktiv");
                  toast({
                    title: "Inserat versteckt",
                    description: "Das Inserat wurde als unattraktiv markiert",
                  });
                }
              }}
              title="Als unattraktiv markieren"
              className="border-sira-light-gray hover:bg-red-50 hover:text-sira-danger transition-smooth"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>

      <ListingDetailModal
        listing={listing}
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
      />

      <AkquiseModal
        isOpen={showAkquiseModal}
        onClose={() => setShowAkquiseModal(false)}
        onSubmit={async (status, notes) => {
          if (!user) return;

          try {
            const response = await fetch("/api/acquisitions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: user.id,
                listing_id: listing.id,
                status,
                notes
              }),
            });

            if (!response.ok) {
              const error = await response.json();
              if (error.error && error.error.includes("duplicate")) {
                toast({
                  title: "Bereits erfasst",
                  description: "Sie haben diese Akquise bereits erfasst",
                  variant: "destructive",
                });
                return;
              }
              throw new Error(error.error || "Failed to create acquisition");
            }

            onMarkCompleted(listing.id);
            toast({
              title: "Akquise gespeichert",
              description: `Status: ${status === "erfolg" ? "Erfolgreich" : "Nicht erfolgreich"}`,
            });
          } catch (error) {
            toast({
              title: "Fehler",
              description: "Akquise konnte nicht gespeichert werden",
              variant: "destructive",
            });
          }
        }}
        listingTitle={listing.title}
      />
    </Card>
  );
}
