import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Trash2, Download, Settings, BarChart3, Terminal } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";

export default function ScraperConsole() {
  const [selectedCategories, setSelectedCategories] = useState([
    "eigentumswohnung-wien",
    "grundstuecke-wien",
    "eigentumswohnung-niederoesterreich",
    "grundstuecke-niederoesterreich"
  ]);
  const [maxPages, setMaxPages] = useState(10);
  const [delay, setDelay] = useState(2000); // Optimierter Delay
  const [keyword, setKeyword] = useState("privat"); // Keyword-Filter
  const [scraper247Status, setScraper247Status] = useState<{isRunning: boolean, currentCycle: number}>({isRunning: false, currentCycle: 0});
  const [logs, setLogs] = useState<string[]>([
    "[INFO] V3 Scraper bereit - NUR Privatverkäufe!",
  ]);
  const [scraperStatus, setScraperStatus] = useState("Bereit");
  const [scraperStats, setScraperStats] = useState({
    newListings: 0,
    updatedListings: 0,
    errors: 0,
    progress: 0,
    startTime: null as Date | null,
    pagesProcessed: 0,
    totalPages: 0,
    currentCategory: "",
  });

  const logContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // WebSocket for real-time scraper updates
  useWebSocket("/ws", {
    onMessage: (data) => {
      if (data.type === "log" || data.type === "scraperUpdate") {
        const message = data.message || data.data;
        setLogs(prev => [...prev, message]);
        scrollToBottom();
        
        // Update statistics based on log messages
        if (message.includes('[SUCCESS] Private Anzeige:') || message.includes('🏆 DOPPELMARKLER-SCAN COMPLETE:')) {
          setScraperStats(prev => ({ ...prev, newListings: prev.newListings + 1 }));
        } else if (message.includes('[ERROR]') || message.includes('[WARNING]') || message.includes('❌ ERROR')) {
          setScraperStats(prev => ({ ...prev, errors: prev.errors + 1 }));
        } else if (message.includes('[LOAD] Seite') || message.includes('⚡ SPEED-LOAD Seite')) {
          const pageMatch = message.match(/Seite (\d+)/);
          if (pageMatch) {
            setScraperStats(prev => ({ ...prev, pagesProcessed: parseInt(pageMatch[1]) }));
          }
        } else if (message.includes('[START] Kategorie') || message.includes('🚀 ULTRA-SCHNELL TEST:')) {
          const categoryMatch = message.match(/Kategorie (.+) wird gescrapt|Starting (.+) from page/);
          if (categoryMatch) {
            setScraperStats(prev => ({ 
              ...prev, 
              currentCategory: categoryMatch[1] || categoryMatch[2],
              startTime: prev.startTime || new Date()
            }));
          }
        } else if (message.includes('🔍 DOPPELMARKLER-CHECK')) {
          const checkMatch = message.match(/\((\d+)\/(\d+)\)/);
          if (checkMatch) {
            const current = parseInt(checkMatch[1]);
            const total = parseInt(checkMatch[2]);
            setScraperStats(prev => ({ 
              ...prev, 
              progress: Math.round((current / total) * 100),
              totalPages: total
            }));
          }
        }
      } else if (data.type === "scraperStatus") {
        setScraperStatus(data.status);
        if (data.status === "Bereit") {
          setScraperStats(prev => ({ 
            ...prev, 
            progress: 0, 
            currentCategory: "",
            startTime: null 
          }));
        }
      } else if (data.type === "statsUpdate") {
        // Live-Statistik-Updates vom Server
        setScraperStats(prev => ({
          ...prev,
          newListings: data.stats.newListings || prev.newListings
        }));
      } else if (data.type === "newListing") {
        // Neue Anzeige gefunden
        setScraperStats(prev => ({ ...prev, newListings: prev.newListings + 1 }));
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

  const startScrapingMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/scraper/start", {
        categories: selectedCategories,
        maxPages,
        delay,
        keyword, // Keyword-Filter an Backend übergeben
      });
    },
    onSuccess: () => {
      setScraperStatus("Läuft");
      setScraperStats(prev => ({ 
        ...prev, 
        progress: 0,
        newListings: 0,
        errors: 0,
        pagesProcessed: 0,
        startTime: new Date(),
        currentCategory: ""
      }));
      toast({
        title: "Scraping gestartet",
        description: "Der Scraper wurde erfolgreich gestartet.",
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Scraper konnte nicht gestartet werden.",
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

  const downloadLogs = () => {
    const logText = logs.join("\n");
    const blob = new Blob([logText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scraper-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const categories = [
    { id: "eigentumswohnung-wien", label: "Eigentumswohnungen Wien" },
    { id: "grundstuecke-wien", label: "Grundstücke Wien" },
    { id: "eigentumswohnung-niederoesterreich", label: "Eigentumswohnungen NÖ" },
    { id: "grundstuecke-niederoesterreich", label: "Grundstücke NÖ" },
  ];

  return (
    <>
      <div className="p-6 border-b border-gray-200 bg-white">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Scraper Console</h2>
            <p className="text-gray-600 mt-1">Willhaben.at Scraping verwalten</p>
          </div>
          <div className="flex space-x-3">
            <Button 
              onClick={() => startScrapingMutation.mutate()}
              disabled={startScrapingMutation.isPending || scraperStatus === "Läuft"}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2 transition-all duration-200 opacity-100"
              size="lg"
            >
              <Play className="mr-2 h-5 w-5" />
              Jetzt scrapen
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 h-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
          {/* Scraper Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Settings className="mr-2 h-5 w-5 text-gray-400" />
                Scraper Einstellungen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">
                  Max. Seiten
                </Label>
                <Input
                  type="number"
                  value={maxPages}
                  onChange={(e) => setMaxPages(parseInt(e.target.value) || 10)}
                  min={1}
                  max={50}
                />
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">
                  Delay (ms)
                </Label>
                <Input
                  type="number"
                  value={delay}
                  onChange={(e) => setDelay(parseInt(e.target.value) || 1000)}
                  min={500}
                  max={5000}
                  step={500}
                />
              </div>

              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">
                  Keyword-Filter
                </Label>
                <Input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="z.B. privat, privatverkauf, provisionsfrei"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Default: "privat" - findet private Listings
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Scraper Status & Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <BarChart3 className="mr-2 h-5 w-5 text-gray-400" />
                Status & Statistiken
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium">Status:</span>
                <Badge 
                  className={`${
                    scraperStatus === "Läuft" 
                      ? "bg-warning text-white" 
                      : "bg-success text-white"
                  }`}
                >
                  {scraperStatus}
                </Badge>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Neue Listings:</span>
                  <span className="font-medium text-green-600">{scraperStats.newListings}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Seiten verarbeitet:</span>
                  <span className="font-medium">{scraperStats.pagesProcessed}/{maxPages}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Fehler:</span>
                  <span className="font-medium text-red-600">{scraperStats.errors}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Aktuelle Kategorie:</span>
                  <span className="font-medium text-xs">{scraperStats.currentCategory || "Keine"}</span>
                </div>
                {scraperStats.startTime && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Laufzeit:</span>
                    <span className="font-medium">
                      {Math.floor((new Date().getTime() - scraperStats.startTime.getTime()) / 1000)}s
                    </span>
                  </div>
                )}
              </div>
              
              <div className="pt-3 border-t border-gray-200">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Fortschritt</span>
                  <span>{Math.round((scraperStats.pagesProcessed / (maxPages * selectedCategories.length)) * 100) || 0}%</span>
                </div>
                <Progress 
                  value={Math.round((scraperStats.pagesProcessed / (maxPages * selectedCategories.length)) * 100) || 0} 
                  className="h-2" 
                />
              </div>
            </CardContent>
          </Card>

          {/* Console Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Terminal className="mr-2 h-5 w-5 text-gray-400" />
                Console Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-80 w-full rounded-lg bg-gray-900 p-4">
                <div 
                  ref={logContainerRef}
                  className="text-sm font-mono space-y-1"
                >
                  {logs.map((log, index) => (
                    <div 
                      key={index} 
                      className={`${
                        log.includes('[ERROR]') ? 'text-red-400' :
                        log.includes('[SUCCESS]') ? 'text-green-400' :
                        log.includes('[WARNING]') ? 'text-yellow-400' :
                        log.includes('[INFO]') ? 'text-blue-400' :
                        'text-gray-300'
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                  <div className="text-gray-500">_</div>
                </div>
              </ScrollArea>
              
              <div className="mt-4 flex space-x-2">
                <Button 
                  variant="outline" 
                  className="flex-1" 
                  onClick={clearLogs}
                  size="sm"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Log löschen
                </Button>
                <Button 
                  variant="outline" 
                  onClick={downloadLogs}
                  size="sm"
                >
                  <Download className="mr-1 h-4 w-4" />
                  Export
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
