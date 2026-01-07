import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Terminal, BarChart3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";

export default function PreisspiegelTest() {
  const [logs, setLogs] = useState<string[]>([
    "[INFO] Preisspiegel-Scraper Test Console",
    "[INFO] Scrape NUR Wien: Eigentumswohnungen + Häuser",
    "[INFO] Sammelt ALLE Inserate (privat + gewerblich) für Marktdaten",
  ]);
  const [stats, setStats] = useState<any>(null);
  const [bezirkStats, setBezirkStats] = useState<any[]>([]);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Poll scraper status
  const { data: scraperStatus } = useQuery<{ isRunning: boolean; currentCycle: number }>({
    queryKey: ["/api/scraper/status-preisspiegel"],
    refetchInterval: 3000,
  });

  // Poll market stats
  const { data: marketStats, refetch: refetchStats } = useQuery({
    queryKey: ["/api/price-mirror/stats"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/price-mirror/stats");
      return await response.json();
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (marketStats) {
      console.log('[PREISSPIEGEL UI] Received stats:', marketStats);
      setStats(marketStats);
    }
  }, [marketStats]);

  // Poll bezirk stats
  const { data: bezirkStatsData } = useQuery({
    queryKey: ["/api/price-mirror/stats-by-bezirk"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/price-mirror/stats-by-bezirk");
      return await response.json();
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (bezirkStatsData) {
      console.log('[PREISSPIEGEL UI] Received bezirk stats:', bezirkStatsData);
      setBezirkStats(bezirkStatsData);
    }
  }, [bezirkStatsData]);

  // WebSocket for real-time updates
  useWebSocket("/ws", {
    onMessage: (data) => {
      if (data.type === "log" && data.message?.includes('[PREISSPIEGEL]')) {
        setLogs(prev => [...prev, data.message]);
        scrollToBottom();
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

  // Start scraper mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/scraper/start-preisspiegel");
    },
    onSuccess: () => {
      toast({
        title: "Preisspiegel-Scraper gestartet",
        description: "Wien Marktdaten werden gesammelt...",
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Scraper konnte nicht gestartet werden",
        variant: "destructive",
      });
    },
  });

  // Stop scraper mutation
  const stopMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/scraper/stop-preisspiegel");
    },
    onSuccess: () => {
      toast({
        title: "Preisspiegel-Scraper gestoppt",
      });
    },
  });

  const isRunning = scraperStatus?.isRunning || false;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Preisspiegel-Scraper Test</h1>
          <p className="text-muted-foreground mt-1">
            Wien Marktdaten (Eigentumswohnungen + Häuser)
          </p>
        </div>
        <Badge variant={isRunning ? "default" : "secondary"} className="text-lg px-4 py-2">
          {isRunning ? `🟢 Running (Cycle ${scraperStatus?.currentCycle || 0})` : "⚪ Gestoppt"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Control Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Steuerung
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-semibold">Scraper Info:</h3>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Region: <strong>NUR Wien</strong></li>
                <li>• Kategorien: <strong>Wohnungen + Häuser</strong></li>
                <li>• Filter: <strong>KEINE</strong> (alle Inserate)</li>
                <li>• Daten: Preis, m², Bezirk, Neubau/Altbau</li>
                <li>• Strategie: Alle Seiten mit State-Tracking</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => startMutation.mutate()}
                disabled={isRunning || startMutation.isPending}
                className="flex-1"
              >
                <Play className="w-4 h-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={() => stopMutation.mutate()}
                disabled={!isRunning || stopMutation.isPending}
                variant="destructive"
                className="flex-1"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </div>

            <Button
              onClick={() => refetchStats()}
              variant="outline"
              className="w-full"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Stats aktualisieren
            </Button>
          </CardContent>
        </Card>

        {/* Market Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Markt-Statistiken (Wien Gesamt)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.count > 0 ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Ø Preis:</span>
                  <span className="font-bold text-lg">
                    €{(stats.avg_price ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Ø €/m²:</span>
                  <span className="font-bold text-lg">
                    €{(stats.avg_eur_per_m2 ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Min Preis:</span>
                  <span className="font-semibold">
                    €{(stats.min_price ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Max Preis:</span>
                  <span className="font-semibold">
                    €{(stats.max_price ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-muted-foreground">Inserate:</span>
                  <span className="font-bold text-xl text-primary">
                    {(stats.count ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                Keine Daten vorhanden. Starte den Scraper!
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Logs Console */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Scraper Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] w-full">
            <div
              ref={logContainerRef}
              className="font-mono text-xs space-y-1 bg-slate-950 text-green-400 p-4 rounded"
            >
              {logs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Bezirk Statistics Table */}
      {bezirkStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Statistiken pro Bezirk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Bezirk</th>
                    <th className="text-right p-2">Anzahl</th>
                    <th className="text-right p-2">Ø Preis</th>
                    <th className="text-right p-2">Ø €/m²</th>
                    <th className="text-right p-2">Min</th>
                    <th className="text-right p-2">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {bezirkStats.map((bezirk) => (
                    <tr key={bezirk.bezirk_code} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <div className="font-semibold">{bezirk.bezirk_code}</div>
                        <div className="text-xs text-muted-foreground">{bezirk.bezirk_name}</div>
                      </td>
                      <td className="text-right p-2 font-semibold">{bezirk.count}</td>
                      <td className="text-right p-2">€{bezirk.avg_price.toLocaleString()}</td>
                      <td className="text-right p-2">€{bezirk.avg_eur_per_m2.toLocaleString()}</td>
                      <td className="text-right p-2 text-xs text-muted-foreground">
                        €{bezirk.min_price.toLocaleString()}
                      </td>
                      <td className="text-right p-2 text-xs text-muted-foreground">
                        €{bezirk.max_price.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
