import { useQuery } from "@tanstack/react-query";
import ListingCard from "@/components/listing-card";
import { Loader2 } from "lucide-react";

interface ListingsArchivedProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function ListingsArchived({ user }: ListingsArchivedProps) {
  // Only admins can access this page
  const { data: deletedListings = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/listings/deleted-unsuccessful"],
    queryFn: async () => {
      const response = await fetch('/api/listings/deleted-unsuccessful');
      if (!response.ok) throw new Error('Failed to fetch deleted/unsuccessful listings');
      return response.json();
    },
    enabled: user?.is_admin,
    refetchInterval: 60000, // Auto-refresh alle 60 Sekunden
  });

  if (!user?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-lg font-medium">Zugriff verweigert</p>
        <p className="text-sm mt-2">Nur Administratoren können diese Seite sehen.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (deletedListings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-lg font-medium">Keine archivierten Inserate</p>
        <p className="text-sm mt-2">Gelöschte und nicht erfolgreiche Akquisen erscheinen hier.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sira-background">
      <div className="max-w-[1600px] mx-auto p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-page-heading text-sira-navy">Archivierte Inserate</h1>
            <p className="text-sira-text-gray mt-2">
              {deletedListings.length} {deletedListings.length === 1 ? 'Inserat' : 'Inserate'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {deletedListings.map((listing: any) => (
          <div key={listing.id} className="relative">
            <ListingCard
              listing={listing}
              onMarkCompleted={() => {}}
              isMarkingCompleted={false}
              user={user}
            />
            <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
              <div className={`${listing.source === 'deleted' ? 'bg-red-500' : 'bg-orange-500'} text-white px-2 py-1 rounded text-xs font-medium`}>
                {listing.source === 'deleted' ? 'Gelöscht' : 'Nicht erfolgreich'}
              </div>
              {listing.username && (
                <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-medium">
                  User: {listing.username}
                </div>
              )}
              {(listing.deleted_at || listing.result_date) && (
                <div className="bg-purple-500 text-white px-2 py-1 rounded text-xs font-medium">
                  {new Date(listing.deleted_at || listing.result_date).toLocaleDateString('de-DE', {
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
