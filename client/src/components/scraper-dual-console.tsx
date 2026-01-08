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
  const [scraperSource, setScraperSource] = useState<"willhaben" | "derstandard">("willhaben");
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
    "[INFO] Dual-Scraper System bereit - Beide filtern NUR Privatverkäufe!",
  ]);
  const [scraperStatus, setScraperStatus] = useState("Bereit");
  const [scraper247Status, setScraper247Status] = useState({
    isRunning: false,
    currentCycle: 0
  });
  const [newestScraperStatus, setNewestScraperStatus] = useState<{isRunning: boolean, currentCycle: number, nextCycleTime: string | null}>({isRunning: false, currentCycle: 0, nextCycleTime: null});

  const logContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Reset Kategorien beim Wechsel der Source
  useEffect(() => {
    if (scraperSource === "willhaben") {
      setSelectedCategories([
        "eigentumswohnung-wien",
        "haus-wien",
        "eigentumswohnung-niederoesterreich",
        "haus-niederoesterreich"
      ]);
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
  const { data: newestStatus } = useQuery<{isRunning: boolean, currentCycle: number, nextCycleTime: string | null}>({
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
          title: "Neue Anzeige gefunden!",
          description: `${data.listing.title} - €${data.listing.price.toLocaleString()}`,
        });
      }
    },
  });

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // V3 Scraper (manual)
  const startPrivatScrapingMutation = useMutation({
    mutationFn: async () => {
      // Wähle Endpoint basierend auf Source
      const endpoint = scraperSource === "willhaben"
        ? "/api/scraper/start"
        : "/api/derstandard-scraper/start";

      return await apiRequest("POST", endpoint, {
        categories: selectedCategories,
        maxPages,
        delay,
        keyword: scraperSource === "willhaben" ? keyword : undefined, // Keyword nur für Willhaben
      });
    },
    onSuccess: () => {
      setScraperStatus("Läuft");
      toast({
        title: "V3 Scraper gestartet",
        description: scraperSource === "willhaben"
          ? `Scraper läuft mit keyword="${keyword}"`
          : `derStandard Scraper gestartet`,
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
      return await apiRequest("POST", "/api/scraper/start-newest", {
        intervalMinutes: 30,
        maxPages: 3
      });
    },
    onSuccess: () => {
      setNewestScraperStatus(prev => ({ ...prev, isRunning: true }));
      toast({
        title: "Newest Scraper gestartet",
        description: "Neueste Inserate werden alle 30 Min gescrapt.",
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Newest Scraper konnte nicht gestartet werden.",
        variant: "destructive",
      });
    },
  });

  const stopNewestScraperMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/scraper/stop-newest", {});
    },
    onSuccess: () => {
      setNewestScraperStatus(prev => ({ ...prev, isRunning: false }));
      toast({
        title: "Newest Scraper gestoppt",
        description: "Scraper wurde gestoppt.",
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Newest Scraper konnte nicht gestoppt werden.",
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
  const categories = scraperSource === "willhaben"
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
      <div className="p-6 border-b border-gray-200 bg-white">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Triple Scraper System</h2>
            <p className="text-gray-600 mt-1">Privatverkauf + 24/7 Kontinuierlich + Newest (sort=1)</p>
          </div>
          <div className="flex space-x-3">
            <Badge
              className={`px-3 py-1 ${
                scraperStatus === "Läuft"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-500 text-white"
              }`}
            >
              Privatverkauf: {scraperStatus}
            </Badge>
            <Badge
              className={`px-3 py-1 ${
                scraper247Status.isRunning
                  ? "bg-green-600 text-white"
                  : "bg-gray-500 text-white"
              }`}
            >
              24/7: {scraper247Status.isRunning ? "Läuft" : "Gestoppt"}
            </Badge>
            <Badge
              className={`px-3 py-1 ${
                newestScraperStatus.isRunning
                  ? "bg-blue-600 text-white"
                  : "bg-gray-500 text-white"
              }`}
            >
              Newest: {newestScraperStatus.isRunning ? "Läuft" : "Gestoppt"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="p-6 h-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
          
          {/* Scraper Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Settings className="mr-2 h-5 w-5 text-gray-400" />
                Scraper Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* V3 Scraper */}
              <div className="border rounded-lg p-4 bg-blue-50">
                <h4 className="font-semibold text-blue-800 mb-3">🎯 V3 Scraper (Händisch)</h4>

                <div className="space-y-3">
                  {/* Source Auswahl - ausgeblendet, derStandard deaktiviert */}
                  {/* <div>
                    <Label className="text-sm font-medium text-gray-700 mb-2 block">
                      Quelle wählen
                    </Label>
                    <Select value={scraperSource} onValueChange={(val) => setScraperSource(val as "willhaben" | "derstandard")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="willhaben">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-green-500 text-green-600">Willhaben</Badge>
                          </div>
                        </SelectItem>
                        <SelectItem value="derstandard">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-blue-500 text-blue-600">derStandard</Badge>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500 mt-1">
                      {scraperSource === "willhaben" ? "Scrape von Willhaben.at" : "Scrape von derStandard.at"}
                    </p>
                  </div> */}

                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-2 block">
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
                          <Label htmlFor={category.id} className="text-sm">
                            {category.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-sm font-medium">Max. Seiten</Label>
                      <Input
                        type="number"
                        value={maxPages}
                        onChange={(e) => setMaxPages(parseInt(e.target.value) || 3)}
                        min={1}
                        max={10}
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Delay (ms)</Label>
                      <Input
                        type="number"
                        value={delay}
                        onChange={(e) => setDelay(parseInt(e.target.value) || 2000)}
                        min={1000}
                        max={5000}
                        step={500}
                      />
                    </div>
                  </div>

                  {/* Keyword-Filter nur für Willhaben */}
                  {scraperSource === "willhaben" && (
                    <div>
                      <Label className="text-sm font-medium">Keyword-Filter</Label>
                      <Input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="privat"
                        className="font-mono text-sm"
                      />
                    </div>
                  )}

                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    onClick={() => startPrivatScrapingMutation.mutate()}
                    disabled={selectedCategories.length === 0 || startPrivatScrapingMutation.isPending || scraperStatus === "Läuft"}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {startPrivatScrapingMutation.isPending ? "Startet..." : "Sofort scrapen"}
                  </Button>
                </div>
              </div>

              {/* 24/7 Scraper */}
              <div className="border rounded-lg p-4 bg-green-50">
                <h4 className="font-semibold text-green-800 mb-3">🚀 24/7 Automatisch (Private Only)</h4>

                <div className="space-y-3">
                  <div className="text-sm text-gray-600">
                    • Läuft kontinuierlich im Hintergrund<br/>
                    • NUR Privatverkäufe (keine Makler!)<br/>
                    • Commercial + Private-Filter aktiv<br/>
                    • Perfekt für Akquise-Pipeline
                  </div>

                  {scraper247Status.isRunning && (
                    <div className="text-sm font-medium text-green-700">
                      Zyklus #{scraper247Status.currentCycle} aktiv
                    </div>
                  )}

                  <Button
                    className={`w-full ${
                      scraper247Status.isRunning
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                    onClick={() => scraper247Status.isRunning
                      ? stop247ScrapingMutation.mutate()
                      : start247ScrapingMutation.mutate()
                    }
                    disabled={start247ScrapingMutation.isPending || stop247ScrapingMutation.isPending}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    {scraper247Status.isRunning ? "24/7 Stoppen" : "24/7 Starten"}
                  </Button>
                </div>
              </div>

              {/* Newest Scraper */}
              <div className="border rounded-lg p-4 bg-blue-50">
                <h4 className="font-semibold text-blue-800 mb-3">🚀 Newest Scraper (sort=1)</h4>

                <div className="space-y-3">
                  <div className="text-sm text-gray-600">
                    • Scrapt alle 30 Min die neuesten Inserate<br/>
                    • Nur erste 1-3 Seiten (sort=1)<br/>
                    • Nur NEUE private Listings<br/>
                    • Perfekt für frische Leads
                  </div>

                  {newestScraperStatus.isRunning && (
                    <div className="text-sm space-y-1">
                      <div className="font-medium text-blue-700">
                        Zyklus #{newestScraperStatus.currentCycle} aktiv
                      </div>
                      {newestScraperStatus.nextCycleTime && (
                        <div className="text-xs text-blue-600">
                          Nächster Zyklus: {new Date(newestScraperStatus.nextCycleTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className={`w-full ${
                      newestScraperStatus.isRunning
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                    onClick={() => newestScraperStatus.isRunning
                      ? stopNewestScraperMutation.mutate()
                      : startNewestScraperMutation.mutate()
                    }
                    disabled={startNewestScraperMutation.isPending || stopNewestScraperMutation.isPending}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    {newestScraperStatus.isRunning ? "Newest Stoppen" : "Newest Starten"}
                  </Button>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Console Log */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center">
                  <Terminal className="mr-2 h-5 w-5 text-gray-400" />
                  Live Console
                </CardTitle>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={clearLogs}
                >
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 w-full rounded-lg bg-gray-900 p-4">
                <div 
                  ref={logContainerRef}
                  className="text-sm font-mono space-y-1"
                >
                  {logs.map((log, index) => (
                    <div 
                      key={index} 
                      className={`${
                        log.includes('[ERROR]') || log.includes('❌') ? 'text-red-400' :
                        log.includes('[SUCCESS]') || log.includes('✅') || log.includes('🏆') ? 'text-green-400' :
                        log.includes('[WARNING]') || log.includes('⚠️') ? 'text-yellow-400' :
                        log.includes('[INFO]') || log.includes('🔍') || log.includes('🚀') ? 'text-blue-400' :
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