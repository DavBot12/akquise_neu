import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Terminal, Settings, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";

export default function ScraperDualConsole() {
  const [scraperSource, setScraperSource] = useState<"willhaben" | "derstandard" | "immoscout">("willhaben");
  const [selectedCategories, setSelectedCategories] = useState([
    "eigentumswohnung-wien",
    "haus-wien",
    "eigentumswohnung-niederoesterreich",
    "haus-niederoesterreich"
    // Grundstücke standardmäßig DEAKTIVIERT
  ]);
  const [maxPages, setMaxPages] = useState(3);
  const [delay, setDelay] = useState(2000);
  const [keyword, setKeyword] = useState("privat");
  const [logs, setLogs] = useState<string[]>([
    "[INFO] Triple-Scraper System bereit - Filtert ausschließlich Privatverkäufe",
  ]);
  const [scraperStatus, setScraperStatus] = useState("Bereit");
  const [scraper247Status, setScraper247Status] = useState({
    isRunning: false,
    currentCycle: 0
  });
  const [newestScraperStatus, setNewestScraperStatus] = useState<{ isRunning: boolean, currentCycle: number, nextCycleTime: string | null }>({ isRunning: false, currentCycle: 0, nextCycleTime: null });

  const logContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Reset Kategorien beim Wechsel der Source
  useEffect(() => {
    if (scraperSource === "derstandard") {
      setSelectedCategories(["wien-kaufen-wohnung"]);
    } else if (scraperSource === "immoscout") {
      setSelectedCategories(["wien-wohnung-kaufen"]);
    } else {
      setSelectedCategories([
        "eigentumswohnung-wien",
        "haus-wien",
        "eigentumswohnung-niederoesterreich",
        "haus-niederoesterreich"
      ]);
    }
  }, [scraperSource]);

  // Fetch 24/7 scraper status on mount to restore state after reload
  const { data: status247 } = useQuery<{ isRunning: boolean; currentCycle: number }>({
    queryKey: ["/api/scraper/status-247"],
    refetchInterval: 5000, // Poll every 5 seconds to keep status in sync
  });

  // Poll Newest Scraper status
  const { data: newestStatus } = useQuery<{ isRunning: boolean, currentCycle: number, nextCycleTime: string | null }>({
    queryKey: ["newest-scraper-status"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/scraper/status-newest");
      return await response.json();
    },
    refetchInterval: 5000,
  });

  // Update scraper247Status when backend status changes
  useEffect(() => {
    if (status247) {
      setScraper247Status(status247);
    }
  }, [status247]);

  useEffect(() => {
    if (newestStatus) {
      setNewestScraperStatus(newestStatus);
    }
  }, [newestStatus]);

  // WebSocket for real-time scraper updates
  useWebSocket("/ws", {
    onMessage: (data) => {
      if (data.type === "log" || data.type === "scraperUpdate") {
        const message = data.message || data.data;
        setLogs(prev => [...prev, message]);
        scrollToBottom();

        // Extract cycle number from [24/7] CYCLE messages
        const cycleMatch = message.match(/\[24\/7\]\s+CYCLE\s+(\d+)/i);
        if (cycleMatch) {
          const cycleNum = parseInt(cycleMatch[1]);
          setScraper247Status(prev => ({ ...prev, currentCycle: cycleNum }));
        }
      } else if (data.type === "scraperStatus") {
        setScraperStatus(data.status);
      } else if (data.type === "newListing") {
        toast({
          title: "Neue Anzeige gefunden",
          description: `${data.listing.title} - €${data.listing.price.toLocaleString()}`,
        });
      }
    },
  });

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      // ScrollArea verwendet einen internen Viewport - finde ihn
      const viewport = logContainerRef.current.closest('[data-radix-scroll-area-viewport]')
        || logContainerRef.current.parentElement;
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // V3 Scraper (manual)
  const startPrivatScrapingMutation = useMutation({
    mutationFn: async () => {
      // Willhaben: manueller Scraper
      if (scraperSource === "willhaben") {
        return await apiRequest("POST", "/api/scraper/start", {
          categories: selectedCategories,
          maxPages,
          delay,
          keyword,
        });
      }

      // derStandard & ImmoScout: manueller Scraper mit Kategorien
      const endpoint = scraperSource === "derstandard"
        ? "/api/derstandard-scraper/start"
        : "/api/immoscout-scraper/start";

      return await apiRequest("POST", endpoint, {
        intervalMinutes: 0, // 0 = einmalig ausführen (one-time execution)
        maxPages,
        categories: selectedCategories, // Pass selected categories to backend
      });
    },
    onSuccess: () => {
      setScraperStatus("Läuft");
      toast({
        title: "V3 Scraper gestartet",
        description: scraperSource === "willhaben"
          ? `Scraper läuft mit keyword="${keyword}"`
          : `${scraperSource} Scraper gestartet`,
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Privatverkauf-Scraper konnte nicht gestartet werden.",
        variant: "destructive",
      });
    },
  });

  // 24/7 Continuous Scraper
  const start247ScrapingMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/scraper/start-247", {});
    },
    onSuccess: () => {
      setScraper247Status(prev => ({ ...prev, isRunning: true }));
      toast({
        title: "24/7 Scraper gestartet",
        description: "Kontinuierlicher Scraper läuft im Hintergrund.",
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "24/7 Scraper konnte nicht gestartet werden.",
        variant: "destructive",
      });
    },
  });

  const stop247ScrapingMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/scraper/stop-247", {});
    },
    onSuccess: () => {
      setScraper247Status(prev => ({ ...prev, isRunning: false }));
      toast({
        title: "24/7 Scraper gestoppt",
        description: "Kontinuierlicher Scraper wurde gestoppt.",
      });
    },
  });

  // Newest Scraper Mutations
  const startNewestScraperMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scraper/start-newest", {
        intervalMinutes: 30,
        maxPages: 3
      });
      return await res.json();
    },
    onSuccess: () => {
      setNewestScraperStatus(prev => ({ ...prev, isRunning: true }));
      toast({
        title: "Newest Scraper gestartet",
        description: "Neueste Inserate werden alle 30 Min gescrapt.",
      });
    },
    onError: (error: any) => {
      console.error('[NEWEST-SCRAPER] Start error:', error);
      toast({
        title: "Fehler",
        description: error?.message || "Newest Scraper konnte nicht gestartet werden.",
        variant: "destructive",
      });
    },
  });

  const stopNewestScraperMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scraper/stop-newest", {});
      return await res.json();
    },
    onSuccess: () => {
      setNewestScraperStatus(prev => ({ ...prev, isRunning: false }));
      toast({
        title: "Newest Scraper gestoppt",
        description: "Scraper wurde gestoppt.",
      });
    },
    onError: (error: any) => {
      console.error('[NEWEST-SCRAPER] Stop error:', error);
      toast({
        title: "Fehler",
        description: error?.message || "Newest Scraper konnte nicht gestoppt werden.",
        variant: "destructive",
      });
    },
  });

  const handleCategoryChange = (category: string, checked: boolean) => {
    if (checked) {
      setSelectedCategories(prev => [...prev, category]);
    } else {
      setSelectedCategories(prev => prev.filter(c => c !== category));
    }
  };

  const clearLogs = () => {
    setLogs(["[INFO] Log gelöscht..."]);
  };

  // Kategorien basierend auf Source
  const categories = scraperSource === "derstandard"
    ? [
      { id: "wien-kaufen-wohnung", label: "Eigentumswohnungen Wien" },
      { id: "noe-kaufen-wohnung", label: "Eigentumswohnungen NÖ" },
      { id: "noe-kaufen-haus", label: "Häuser NÖ" },
    ]
    : scraperSource === "immoscout"
    ? [
      { id: "wien-wohnung-kaufen", label: "Eigentumswohnungen Wien" },
      { id: "noe-wohnung-kaufen", label: "Eigentumswohnungen NÖ" },
      { id: "noe-haus-kaufen", label: "Häuser NÖ" },
    ]
    : scraperSource === "willhaben"
    ? [
      { id: "eigentumswohnung-wien", label: "Eigentumswohnungen Wien" },
      { id: "haus-wien", label: "Häuser Wien" },
      { id: "grundstueck-wien", label: "Grundstücke Wien" },
      { id: "eigentumswohnung-niederoesterreich", label: "Eigentumswohnungen NÖ" },
      { id: "haus-niederoesterreich", label: "Häuser NÖ" },
      { id: "grundstueck-niederoesterreich", label: "Grundstücke NÖ" },
    ]
    : [
      { id: "eigentumswohnung-wien", label: "Eigentumswohnungen Wien" },
      { id: "haus-wien", label: "Häuser Wien" },
      { id: "eigentumswohnung-niederoesterreich", label: "Eigentumswohnungen NÖ" },
      { id: "haus-niederoesterreich", label: "Häuser NÖ" },
    ];

  return (
    <>
      <div className="p-8 border-b border-sira-light-gray bg-white">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-page-heading text-sira-navy">Triple Scraper System</h1>
            <p className="text-sira-text-gray mt-2">Automatisierte Erfassung von Privatverkäufen</p>
          </div>
          <div className="flex gap-3">
            <Badge
              variant="outline"
              className={`px-3 py-1.5 ${scraperStatus === "Läuft"
                ? "border-sira-info text-sira-info bg-blue-50"
                : "border-sira-medium-gray text-sira-medium-gray"
                }`}
            >
              Privatverkauf: {scraperStatus}
            </Badge>
            <Badge
              variant="outline"
              className={`px-3 py-1.5 ${scraper247Status.isRunning
                ? "border-sira-success text-sira-success bg-green-50"
                : "border-sira-medium-gray text-sira-medium-gray"
                }`}
            >
              24/7: {scraper247Status.isRunning ? "Läuft" : "Gestoppt"}
            </Badge>
            <Badge
              variant="outline"
              className={`px-3 py-1.5 ${newestScraperStatus.isRunning
                ? "border-sira-info text-sira-info bg-blue-50"
                : "border-sira-medium-gray text-sira-medium-gray"
                }`}
            >
              Newest: {newestScraperStatus.isRunning ? "Läuft" : "Gestoppt"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="p-8 h-full bg-sira-background">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">

          {/* Scraper Controls */}
          <Card className="border-sira-light-gray">
            <CardHeader className="border-b border-sira-light-gray">
              <CardTitle className="text-section-heading text-sira-navy flex items-center">
                <Settings className="mr-2 h-5 w-5 text-sira-medium-gray" />
                Steuerung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">

              {/* V3 Scraper */}
              <div className="border border-sira-light-gray rounded-lg p-5 bg-white">
                <h4 className="text-card-title text-sira-navy mb-4">Manueller Scraper</h4>

                <div className="space-y-4">
                  {/* Source Auswahl */}
                  <div>
                    <Label className="text-sm font-medium text-sira-text-gray mb-2 block">
                      Quelle
                    </Label>
                    <Select value={scraperSource} onValueChange={(val) => setScraperSource(val as "willhaben" | "derstandard" | "immoscout")}>
                      <SelectTrigger className="w-full border-sira-light-gray focus:border-sira-navy focus:ring-sira-navy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="willhaben">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-sira-success text-sira-success">Willhaben</Badge>
                          </div>
                        </SelectItem>
                        <SelectItem value="derstandard">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-sira-info text-sira-info">derStandard</Badge>
                          </div>
                        </SelectItem>
                        <SelectItem value="immoscout">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-sira-warning text-sira-warning">ImmoScout24</Badge>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-sira-medium-gray mt-2">
                      {scraperSource === "willhaben" && "Erfassung von Willhaben.at"}
                      {scraperSource === "derstandard" && "Erfassung von derStandard.at"}
                      {scraperSource === "immoscout" && "Erfassung von Immobilienscout24.at"}
                    </p>
                  </div>

                  <div>
                    <Label className="text-sm font-medium text-sira-text-gray mb-2 block">
                      Kategorien
                    </Label>
                    <div className="space-y-2">
                      {categories.map((category) => (
                        <div key={category.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={category.id}
                            checked={selectedCategories.includes(category.id)}
                            onCheckedChange={(checked) =>
                              handleCategoryChange(category.id, checked as boolean)
                            }
                          />
                          <Label htmlFor={category.id} className="text-sm text-sira-text-gray">
                            {category.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm font-medium text-sira-text-gray">Max. Seiten</Label>
                      <Input
                        type="number"
                        value={maxPages}
                        onChange={(e) => setMaxPages(parseInt(e.target.value) || 3)}
                        min={1}
                        max={10}
                        className="border-sira-light-gray focus:border-sira-navy focus:ring-sira-navy"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-sira-text-gray">Delay (ms)</Label>
                      <Input
                        type="number"
                        value={delay}
                        onChange={(e) => setDelay(parseInt(e.target.value) || 2000)}
                        min={1000}
                        max={5000}
                        step={500}
                        className="border-sira-light-gray focus:border-sira-navy focus:ring-sira-navy"
                      />
                    </div>
                  </div>

                  {/* Keyword-Filter nur für Willhaben */}
                  {scraperSource === "willhaben" && (
                    <div>
                      <Label className="text-sm font-medium text-sira-text-gray">Keyword-Filter</Label>
                      <Input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="privat"
                        className="font-mono text-sm border-sira-light-gray focus:border-sira-navy focus:ring-sira-navy"
                      />
                    </div>
                  )}

                  <Button
                    className="w-full bg-sira-navy hover:bg-sira-navy/90 text-white transition-smooth"
                    onClick={() => startPrivatScrapingMutation.mutate()}
                    disabled={selectedCategories.length === 0 || startPrivatScrapingMutation.isPending || scraperStatus === "Läuft"}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {startPrivatScrapingMutation.isPending ? "Startet..." : "Jetzt starten"}
                  </Button>
                </div>
              </div>

              {/* 24/7 Scraper */}
              <div className="border border-sira-light-gray rounded-lg p-5 bg-white">
                <h4 className="text-card-title text-sira-navy mb-4">Automatischer Dauerbetrieb</h4>

                <div className="space-y-4">
                  <div className="text-sm text-sira-text-gray space-y-1">
                    <p>Kontinuierliche Erfassung im Hintergrund</p>
                    <p>Ausschließlich Privatverkäufe</p>
                    <p>Mehrstufige Filterung aktiv</p>
                    <p>Optimiert für Akquise-Pipeline</p>
                  </div>

                  {scraper247Status.isRunning && (
                    <div className="text-sm font-medium text-sira-navy">
                      Zyklus #{scraper247Status.currentCycle} aktiv
                    </div>
                  )}

                  <Button
                    className={`w-full transition-smooth ${scraper247Status.isRunning
                      ? 'bg-sira-danger hover:bg-sira-danger/90 text-white'
                      : 'bg-sira-success hover:bg-sira-success/90 text-white'
                      }`}
                    onClick={() => scraper247Status.isRunning
                      ? stop247ScrapingMutation.mutate()
                      : start247ScrapingMutation.mutate()
                    }
                    disabled={start247ScrapingMutation.isPending || stop247ScrapingMutation.isPending}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    {scraper247Status.isRunning ? "Stoppen" : "Starten"}
                  </Button>
                </div>
              </div>

              {/* Newest Scraper */}
              <div className="border border-sira-light-gray rounded-lg p-5 bg-white">
                <h4 className="text-card-title text-sira-navy mb-4">Neueste Inserate</h4>

                <div className="space-y-4">
                  <div className="text-sm text-sira-text-gray space-y-1">
                    <p>Erfassung alle 30 Minuten</p>
                    <p>Erste 1-3 Seiten sortiert nach Datum</p>
                    <p>Nur neue private Angebote</p>
                    <p>Optimiert für aktuelle Leads</p>
                  </div>

                  {newestScraperStatus.isRunning && (
                    <div className="text-sm space-y-1">
                      <div className="font-medium text-sira-navy">
                        Zyklus #{newestScraperStatus.currentCycle} aktiv
                      </div>
                      {newestScraperStatus.nextCycleTime && (
                        <div className="text-xs text-sira-medium-gray">
                          Nächster Zyklus: {new Date(newestScraperStatus.nextCycleTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className={`w-full transition-smooth ${newestScraperStatus.isRunning
                      ? 'bg-sira-danger hover:bg-sira-danger/90 text-white'
                      : 'bg-sira-navy hover:bg-sira-navy/90 text-white'
                      }`}
                    onClick={() => newestScraperStatus.isRunning
                      ? stopNewestScraperMutation.mutate()
                      : startNewestScraperMutation.mutate()
                    }
                    disabled={startNewestScraperMutation.isPending || stopNewestScraperMutation.isPending}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    {newestScraperStatus.isRunning ? "Stoppen" : "Starten"}
                  </Button>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Console Log */}
          <Card className="lg:col-span-2 border-sira-light-gray">
            <CardHeader className="border-b border-sira-light-gray">
              <div className="flex justify-between items-center">
                <CardTitle className="text-section-heading text-sira-navy flex items-center">
                  <Terminal className="mr-2 h-5 w-5 text-sira-medium-gray" />
                  Live Protokoll
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearLogs}
                  className="border-sira-light-gray hover:bg-sira-background transition-smooth"
                >
                  Leeren
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <ScrollArea className="h-96 w-full rounded-lg bg-sira-navy p-4">
                <div
                  ref={logContainerRef}
                  className="text-sm font-mono space-y-1"
                >
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className={`${log.includes('[ERROR]') ? 'text-red-400' :
                        log.includes('[SUCCESS]') ? 'text-green-400' :
                          log.includes('[WARNING]') ? 'text-yellow-400' :
                            log.includes('[INFO]') ? 'text-blue-400' :
                              log.includes('[24/7]') ? 'text-green-300' :
                                'text-gray-300'
                        }`}
                    >
                      {log}
                    </div>
                  ))}
                  <div className="text-gray-500">_</div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

        </div>
      </div>
    </>
  );
}