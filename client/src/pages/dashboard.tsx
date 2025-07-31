import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building, ChartLine, Worm, NotebookTabs, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import ListingCard from "@/components/listing-card";
import ContactCard from "@/components/contact-card";
import ContactModal from "@/components/contact-modal";
import ScraperConsole from "@/components/scraper-console";
import ScraperDualConsole from "@/components/scraper-dual-console";
import PriceMirror from "../components/price-mirror";
import { useWebSocket } from "@/hooks/use-websocket";
import type { Listing, Contact } from "@shared/schema";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [regionFilter, setRegionFilter] = useState("Alle Regionen");
  const [priceFilter, setPriceFilter] = useState("Alle Preise");
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

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

  // Fetch listings with proper query parameters
  const { data: listings = [], isLoading: listingsLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", regionFilter, priceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (regionFilter !== "Alle Regionen") params.append("region", regionFilter);
      if (priceFilter !== "Alle Preise") params.append("price_evaluation", priceFilter);
      params.append("akquise_erledigt", "false");
      
      const url = `/api/listings${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch listings');
      return response.json();
    },
  });

  // Fetch stats
  const { data: stats } = useQuery<{
    activeListings: number;
    completedListings: number;
    lastScrape: string | null;
  }>({
    queryKey: ["/api/listings/stats"],
  });

  // Fetch contacts
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
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

  const formatLastScrape = (lastScrape: string | null) => {
    if (!lastScrape) return "nie";
    const date = new Date(lastScrape);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHours > 0) {
      return `vor ${diffHours}h`;
    } else {
      return `vor ${diffMinutes}min`;
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-lg">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800 flex items-center">
            <Building className="text-primary mr-2" />
            Immobilien Akquise
          </h1>
        </div>
        
        <nav className="mt-6">
          <div className="px-4 space-y-2">
            <Button
              variant={activeTab === "dashboard" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("dashboard")}
            >
              <ChartLine className="mr-3 h-4 w-4" />
              Dashboard
            </Button>
            <Button
              variant={activeTab === "scraper" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("scraper")}
            >
              <Worm className="mr-3 h-4 w-4" />
              Scraper Console
            </Button>
            <Button
              variant={activeTab === "contacts" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("contacts")}
            >
              <NotebookTabs className="mr-3 h-4 w-4" />
              Kontakte
            </Button>
            <Button
              variant={activeTab === "price-mirror" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("price-mirror")}
            >
              <TrendingUp className="mr-3 h-4 w-4" />
              Preisspiegel
            </Button>
          </div>
        </nav>

        {/* Stats Summary */}
        <div className="p-4 mt-8 border-t border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Übersicht</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Aktive Listings:</span>
              <span className="font-medium">{stats?.activeListings || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Erledigt:</span>
              <span className="font-medium">{stats?.completedListings || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Letzter Scrape:</span>
              <span className="font-medium text-xs">{formatLastScrape(stats?.lastScrape || null)}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="h-full m-0">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
                  <p className="text-gray-600 mt-1">Aktuelle Immobilien-Listings verwalten</p>
                </div>
                <div className="flex space-x-3">
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
                  <Select value={priceFilter} onValueChange={setPriceFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Alle Preise">Alle Preise</SelectItem>
                      <SelectItem value="Unter dem Schnitt">Unter dem Schnitt</SelectItem>
                      <SelectItem value="Im Schnitt">Im Schnitt</SelectItem>
                      <SelectItem value="Über dem Schnitt">Über dem Schnitt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="p-6 h-full overflow-y-auto">
              {listingsLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 animate-pulse">
                      <div className="h-48 bg-gray-200 rounded mb-4"></div>
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              ) : listings.length === 0 ? (
                <div className="text-center py-12">
                  <Building className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                  <p className="text-gray-500">Keine Listings gefunden</p>
                  <p className="text-sm text-gray-400 mt-2">Starten Sie den Scraper um neue Listings zu finden</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  <div className="col-span-full mb-4">
                    <p className="text-sm text-gray-600">{listings.length} Listing{listings.length !== 1 ? 's' : ''} gefunden</p>
                  </div>
                  {listings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      onMarkCompleted={handleMarkCompleted}
                      isMarkingCompleted={markCompletedMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Scraper Console Tab */}
          <TabsContent value="scraper" className="h-full m-0">
            <ScraperDualConsole />
          </TabsContent>

          {/* Contacts Tab */}
          <TabsContent value="contacts" className="h-full m-0">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">🏗️ Wichtige Kontakte</h2>
                  <p className="text-gray-600 mt-1">Immobilienentwickler und Investoren verwalten</p>
                </div>
                <Button onClick={() => setIsContactModalOpen(true)}>
                  Neuer Kontakt
                </Button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {contacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    onEdit={(contact) => {
                      setEditingContact(contact);
                      setIsContactModalOpen(true);
                    }}
                  />
                ))}
                
                {/* Add New Contact Card */}
                <div 
                  className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center text-gray-500 hover:border-primary hover:text-primary transition-colors cursor-pointer"
                  onClick={() => setIsContactModalOpen(true)}
                >
                  <Building className="h-8 w-8 mb-3" />
                  <span className="font-medium">Neuen Kontakt hinzufügen</span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Price Mirror Tab */}
          <TabsContent value="price-mirror" className="h-full m-0">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">📊 Immobilienpreis Spiegel</h2>
                  <p className="text-gray-600 mt-1">Durchschnittspreise nach Bezirken und Regionen</p>
                </div>
              </div>
            </div>

            <div className="p-6 h-full overflow-y-auto">
              <PriceMirror />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Contact Modal */}
      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => {
          setIsContactModalOpen(false);
          setEditingContact(null);
        }}
        contact={editingContact}
      />
    </div>
  );
}
