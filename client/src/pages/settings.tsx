import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { Brain, RefreshCw, TrendingUp, TrendingDown, Database, Target, MapPin, Clock, CheckCircle2, Phone, Download, FileText, BarChart3 } from "lucide-react";
import { Link } from "wouter";

interface SettingsProps {
  user: { id: number; username: string; is_admin?: boolean };
}

interface MLStats {
  quality_feedback: number;
  outcome_feedback: {
    total: number;
    by_type: Record<string, number>;
  };
  total_feedback: number;
  active_model: {
    version: string;
    algorithm: string;
    mae: string;
    rmse: string | null;
    r_squared: string | null;
    training_samples: number;
    trained_at: Date;
  } | null;
  ready_for_training: boolean;
  phase: 1 | 2 | 3;
}

export default function SettingsPage({ user }: SettingsProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  // Fetch ML stats
  const { data: mlStats, isLoading: mlStatsLoading } = useQuery<MLStats>({
    queryKey: ['/api/ml/stats'],
    queryFn: async () => {
      const sessionId = localStorage.getItem('sessionId');
      const response = await fetch('/api/ml/stats', {
        headers: sessionId ? { 'x-session-id': sessionId } : {},
      });
      if (!response.ok) throw new Error('Failed to fetch ML stats');
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Recalculate quality scores mutation
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const sessionId = localStorage.getItem('sessionId');
      const response = await fetch('/api/quality-scores/recalculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId && { 'x-session-id': sessionId }),
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to recalculate scores');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Neuberechnung gestartet',
        description: 'Quality Scores werden im Hintergrund neu berechnet',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/listings'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Fehler',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Manual ML training mutation
  const trainMutation = useMutation({
    mutationFn: async () => {
      const sessionId = localStorage.getItem('sessionId');
      const response = await fetch('/api/ml/train', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId && { 'x-session-id': sessionId }),
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to train model');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Training gestartet',
        description: 'ML-Modell wird trainiert',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ml/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Fehler',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Disable ML mutation
  const disableMutation = useMutation({
    mutationFn: async () => {
      const sessionId = localStorage.getItem('sessionId');
      const response = await fetch('/api/ml/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId && { 'x-session-id': sessionId }),
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to disable ML');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'ML deaktiviert',
        description: 'Alle ML-Modelle wurden deaktiviert',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ml/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Fehler',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast({
        title: "Fehler",
        description: "Passwörter stimmen nicht überein",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 4) {
      toast({
        title: "Fehler",
        description: "Passwort muss mindestens 4 Zeichen lang sein",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          newPassword,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Erfolgreich",
          description: "Passwort wurde geändert",
        });
        setNewPassword("");
        setConfirmPassword("");
      } else {
        throw new Error(data.error || "Passwort-Änderung fehlgeschlagen");
      }
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sira-background">
      <div className="max-w-[1600px] mx-auto p-6 md:p-8 space-y-6">
        <div className="mb-6">
          <h1 className="text-page-heading text-sira-navy">Einstellungen</h1>
          <p className="text-sira-text-gray mt-2">Verwalte deine persönlichen Einstellungen</p>
        </div>

        <Tabs defaultValue="account" className="space-y-6">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            {user.is_admin && <TabsTrigger value="quality-ml">Quality Score & ML</TabsTrigger>}
          </TabsList>

          <TabsContent value="account" className="space-y-6">
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Darstellung</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="theme">Farbschema</Label>
                  <Select value={theme} onValueChange={setTheme}>
                    <SelectTrigger id="theme">
                      <SelectValue placeholder="Theme auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Hell</SelectItem>
                      <SelectItem value="dark">Dunkel</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Passwort ändern</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">Neues Passwort</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Passwort bestätigen</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={4}
                    />
                  </div>

                  <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? "Wird geändert..." : "Passwort ändern"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Konto-Informationen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <Label className="text-muted-foreground">Benutzername</Label>
                  <p className="font-medium">{user.username}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Rolle</Label>
                  <p className="font-medium">{user.is_admin ? "Administrator" : "Benutzer"}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {user.is_admin && (
            <TabsContent value="quality-ml" className="space-y-6">
              {/* Quality Score Management */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Quality Score Management
                  </CardTitle>
                  <CardDescription>
                    Verwalte die Qualitätsbewertungen aller Listings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-medium text-sm">Scoring-Faktoren</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Clock className="h-4 w-4 text-blue-600 mt-0.5" />
                        <div>
                          <div className="font-medium">Frische</div>
                          <div className="text-xs text-muted-foreground">0-50 Punkte (+20 Gold Find)</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                        <div>
                          <div className="font-medium">Vollständigkeit</div>
                          <div className="text-xs text-muted-foreground">-10 bis +45 Punkte</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Phone className="h-4 w-4 text-teal-600 mt-0.5" />
                        <div>
                          <div className="font-medium">Telefonnummer</div>
                          <div className="text-xs text-muted-foreground">+10 / -10 Punkte</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <TrendingUp className="h-4 w-4 text-purple-600 mt-0.5" />
                        <div>
                          <div className="font-medium">Preis-Leistung</div>
                          <div className="text-xs text-muted-foreground">0-30 Punkte</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-orange-600 mt-0.5" />
                        <div>
                          <div className="font-medium">Entfernung Wien</div>
                          <div className="text-xs text-muted-foreground">-10 bis +10 Punkte</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <TrendingDown className="h-4 w-4 text-red-600 mt-0.5" />
                        <div>
                          <div className="font-medium">Preissenkung</div>
                          <div className="text-xs text-muted-foreground">0-25 Punkte Bonus</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <Button
                      onClick={() => recalculateMutation.mutate()}
                      disabled={recalculateMutation.isPending}
                      className="w-full"
                      variant="outline"
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${recalculateMutation.isPending ? 'animate-spin' : ''}`} />
                      {recalculateMutation.isPending ? 'Wird neu berechnet...' : 'Alle Scores neu berechnen'}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Berechnet die Quality Scores für alle aktiven Listings neu. Nutzt ML wenn verfügbar.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* ML Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5" />
                    Machine Learning Statistiken
                  </CardTitle>
                  <CardDescription>
                    Übersicht über das ML-System und Modell-Performance
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {mlStatsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Lädt Statistiken...</div>
                  ) : mlStats ? (
                    <>
                      {/* Feedback Stats */}
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="border rounded-lg p-4">
                          <div className="text-2xl font-bold text-sira-navy">{mlStats.total_feedback}</div>
                          <div className="text-xs text-muted-foreground">Gesamt-Feedback</div>
                        </div>
                        <div className="border rounded-lg p-4">
                          <div className="text-2xl font-bold text-blue-600">{mlStats.quality_feedback || 0}</div>
                          <div className="text-xs text-muted-foreground">Score-Bewertungen</div>
                        </div>
                        <div className="border rounded-lg p-4">
                          <div className="text-2xl font-bold text-green-600">{mlStats.outcome_feedback?.total || 0}</div>
                          <div className="text-xs text-muted-foreground">Outcome-Feedback</div>
                        </div>
                        <div className="border rounded-lg p-4">
                          <Badge variant={mlStats.ready_for_training ? 'default' : 'secondary'}>
                            {mlStats.ready_for_training ? 'Bereit' : 'Nicht bereit'}
                          </Badge>
                          <div className="text-xs text-muted-foreground mt-1">Training Status</div>
                        </div>
                      </div>

                      {/* Outcome Feedback Breakdown */}
                      {mlStats.outcome_feedback?.total > 0 && (
                        <div className="border rounded-lg p-4">
                          <h3 className="font-medium mb-3">Outcome-Feedback Details</h3>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                            {mlStats.outcome_feedback.by_type.akquise_success && (
                              <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>Erfolg: {mlStats.outcome_feedback.by_type.akquise_success}</span>
                              </div>
                            )}
                            {mlStats.outcome_feedback.by_type.akquise_completed && (
                              <div className="flex items-center gap-2 text-blue-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>Erledigt: {mlStats.outcome_feedback.by_type.akquise_completed}</span>
                              </div>
                            )}
                            {mlStats.outcome_feedback.by_type.deleted_spam && (
                              <div className="flex items-center gap-2 text-red-600">
                                <span className="text-lg">🚫</span>
                                <span>Spam: {mlStats.outcome_feedback.by_type.deleted_spam}</span>
                              </div>
                            )}
                            {mlStats.outcome_feedback.by_type.deleted_not_relevant && (
                              <div className="flex items-center gap-2 text-orange-600">
                                <span className="text-lg">❌</span>
                                <span>Nicht relevant: {mlStats.outcome_feedback.by_type.deleted_not_relevant}</span>
                              </div>
                            )}
                            {mlStats.outcome_feedback.by_type.deleted_sold && (
                              <div className="flex items-center gap-2 text-gray-600">
                                <span className="text-lg">🏠</span>
                                <span>Verkauft: {mlStats.outcome_feedback.by_type.deleted_sold}</span>
                              </div>
                            )}
                            {mlStats.outcome_feedback.by_type.deleted_other && (
                              <div className="flex items-center gap-2 text-gray-500">
                                <span className="text-lg">❓</span>
                                <span>Sonstiges: {mlStats.outcome_feedback.by_type.deleted_other}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Phase Info */}
                      <div className="border rounded-lg p-4 bg-muted/30">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-lg font-bold text-sira-navy">Phase {mlStats.phase}</div>
                            <div className="text-xs text-muted-foreground">
                              {mlStats.phase === 1 && 'Sammelt Feedback (< 5 Samples)'}
                              {mlStats.phase === 2 && 'Gewichteter Durchschnitt (5-49 Samples)'}
                              {mlStats.phase === 3 && 'Lineare Regression (50+ Samples)'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-muted-foreground">
                              {mlStats.phase === 1 && `Noch ${5 - mlStats.total_feedback} bis Phase 2`}
                              {mlStats.phase === 2 && `Noch ${50 - mlStats.total_feedback} bis Phase 3`}
                              {mlStats.phase === 3 && '🎉 Maximale Phase erreicht'}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Active Model Info */}
                      {mlStats.active_model ? (
                        <div className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium">Aktives Modell</h3>
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              Aktiv
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <div className="text-muted-foreground">Algorithmus</div>
                              <div className="font-medium">
                                {mlStats.active_model.algorithm === 'weighted_avg' && 'Gewichteter Durchschnitt'}
                                {mlStats.active_model.algorithm === 'linear_regression' && 'Lineare Regression'}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Trainings-Samples</div>
                              <div className="font-medium">{mlStats.active_model.training_samples}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">MAE (Fehler)</div>
                              <div className="font-medium">±{mlStats.active_model.mae} Punkte</div>
                            </div>
                            {mlStats.active_model.r_squared && (
                              <div>
                                <div className="text-muted-foreground">R² (Güte)</div>
                                <div className="font-medium">{mlStats.active_model.r_squared}</div>
                              </div>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground pt-2 border-t">
                            Trainiert am: {new Date(mlStats.active_model.trained_at).toLocaleString('de-DE')}
                          </div>
                        </div>
                      ) : (
                        <div className="border rounded-lg p-4 text-center text-muted-foreground">
                          <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <div>Kein aktives ML-Modell</div>
                          <div className="text-xs mt-1">
                            Mindestens 5 User-Bewertungen erforderlich
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-4 border-t">
                        <Button
                          onClick={() => trainMutation.mutate()}
                          disabled={!mlStats.ready_for_training || trainMutation.isPending}
                          variant="outline"
                          className="flex-1"
                        >
                          <Brain className={`h-4 w-4 mr-2 ${trainMutation.isPending ? 'animate-pulse' : ''}`} />
                          {trainMutation.isPending ? 'Training läuft...' : 'Manuell trainieren'}
                        </Button>
                        <Button
                          onClick={() => {
                            if (window.confirm('Alle ML-Modelle deaktivieren? System nutzt dann Standard-Bewertung.')) {
                              disableMutation.mutate();
                            }
                          }}
                          disabled={!mlStats.active_model || disableMutation.isPending}
                          variant="destructive"
                          className="flex-1"
                        >
                          ML deaktivieren
                        </Button>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        💡 Tipp: Das System trainiert automatisch alle 10 Bewertungen neu
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">Keine Daten verfügbar</div>
                  )}
                </CardContent>
              </Card>

              {/* Geo-Filter Download */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Geo-Filter Analyse
                  </CardTitle>
                  <CardDescription>
                    Übersicht der blockierten Orte basierend auf aktuellen Listings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Der Geo-Filter blockiert Listings aus Gebieten außerhalb des Akquise-Radius (max. 30 min von Wien).</p>
                    <p className="mt-2">Lade eine Liste aller aktuell blockierten Orte herunter, um zu sehen welche Listings nicht angezeigt werden.</p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        window.open('/api/geo-filter/blocked-locations?format=txt', '_blank');
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Blockierte Orte (.txt)
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          const sessionId = localStorage.getItem('sessionId');
                          const response = await fetch('/api/geo-filter/blocked-locations', {
                            headers: sessionId ? { 'x-session-id': sessionId } : {},
                          });
                          const data = await response.json();
                          toast({
                            title: `Geo-Filter Status`,
                            description: `${data.total_blocked} von ${data.total_active} Listings blockiert (${data.block_rate})`,
                          });
                        } catch (error) {
                          toast({
                            title: 'Fehler',
                            description: 'Konnte Statistik nicht laden',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Statistik
                    </Button>
                  </div>

                  <Link href="/blocked-listings">
                    <Button variant="default" className="w-full">
                      <MapPin className="h-4 w-4 mr-2" />
                      Blockierte Listings anzeigen
                    </Button>
                  </Link>

                  <div className="text-xs text-muted-foreground border-t pt-3">
                    📍 Whitelist: Wien (komplett), Mödling, Schwechat, Klosterneuburg, Groß-Enzersdorf
                    <br />
                    🚫 Blacklist: Baden, Wr. Neustadt, Gänserndorf, Tulln, Korneuburg, Stockerau, etc.
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
