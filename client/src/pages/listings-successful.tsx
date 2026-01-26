import { useQuery } from "@tanstack/react-query";
import ListingCard from "@/components/listing-card";
import { Loader2 } from "lucide-react";

interface ListingsSuccessfulProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function ListingsSuccessful({ user }: ListingsSuccessfulProps) {
  // Fetch successful acquisitions
  const { data: successfulListings = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/listings/successful", user?.is_admin ? undefined : user?.id],
    queryFn: async () => {
      const url = user?.is_admin
        ? '/api/listings/successful'
        : `/api/listings/successful?userId=${user?.id}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch successful acquisitions');
      return response.json();
    },
    refetchInterval: 60000, // Auto-refresh alle 60 Sekunden
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (successfulListings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-lg font-medium">Keine erfolgreichen Akquisen vorhanden</p>
        <p className="text-sm mt-2">Sobald du Akquisen als erfolgreich markierst, erscheinen sie hier.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sira-background">
      <div className="max-w-[1600px] mx-auto p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-page-heading text-sira-navy">Erfolgreiche Akquisen</h1>
            <p className="text-sira-text-gray mt-2">
              {successfulListings.length} {successfulListings.length === 1 ? 'Erfolg' : 'Erfolge'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {successfulListings.map((listing: any) => (
          <div key={listing.id} className="relative">
            <ListingCard
              listing={listing}
              onMarkCompleted={() => {}}
              isMarkingCompleted={false}
              user={user}
            />
            <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
              <div className="bg-green-500 text-white px-2 py-1 rounded text-xs font-medium">
                Erfolgreich
              </div>
              {listing.username && (
                <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-medium">
                  User: {listing.username}
                </div>
              )}
              {listing.result_date && (
                <div className="bg-purple-500 text-white px-2 py-1 rounded text-xs font-medium">
                  {new Date(listing.result_date).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
