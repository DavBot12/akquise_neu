import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Zap,
  Target,
  Brain,
  Activity
} from "lucide-react";

interface ScraperStats {
  today: {
    total: number;
    by_source: Record<string, number>;
    by_hour: Record<string, number>;
    avg_quality_score: number;
  };
  last_7_days: {
    total: number;
    by_day: Record<string, number>;
    by_source: Record<string, number>;
  };
  last_30_days: {
    total: number;
    by_day: Record<string, number>;
    by_source: Record<string, number>;
    avg_per_day: number;
  };
  insights: {
    best_hour: number;
    best_hour_avg: number;
    worst_hour: number;
    worst_hour_avg: number;
    best_day_of_week: string;
    best_day_avg: number;
    trend: 'up' | 'down' | 'stable';
    trend_percentage: number;
    peak_hours: number[];
    quiet_hours: number[];
  };
}

export default function AnalyticsScraper({ user }: { user: { id: number; username: string; is_admin?: boolean } }) {
  // Fetch scraper stats with extended data
  const { data: stats, isLoading, error } = useQuery<ScraperStats>({
    queryKey: ["scraper-analytics-stats"],
    queryFn: async () => {
      const sessionId = localStorage.getItem('sessionId');
      const res = await fetch("/api/scraper-analytics-stats", {
        headers: sessionId ? { 'x-session-id': sessionId } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch scraper stats");
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Debug log
  console.log('[SCRAPER-ANALYTICS] stats:', stats, 'isLoading:', isLoading, 'error:', error);

  const getSourceColor = (source: string) => {
    switch (source) {
      case "willhaben": return "bg-orange-500";
      case "derstandard": return "bg-blue-500";
      case "immoscout": return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  const getSourceBgColor = (source: string) => {
    switch (source) {
      case "willhaben": return "bg-orange-100 border-orange-200";
      case "derstandard": return "bg-blue-100 border-blue-200";
      case "immoscout": return "bg-green-100 border-green-200";
      default: return "bg-gray-100 border-gray-200";
    }
  };

  const formatHour = (hour: number) => `${hour.toString().padStart(2, '0')}:00`;

  const getDayName = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("de-AT", { weekday: "short" });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Lade Statistiken...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-muted-foreground">Keine Daten verfügbar</div>
          {error && <div className="text-red-500 text-sm">Fehler: {(error as Error).message}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-500" />
              Scraper Analytics
            </h1>
            <p className="text-muted-foreground text-sm">
              Listing-Eingang und ML-Insights
            </p>
          </div>
          {stats.insights && (
            <div className="flex items-center gap-2">
              {stats.insights.trend === 'up' && (
                <Badge className="bg-green-500 text-white">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  +{stats.insights.trend_percentage}% vs. Vorwoche
                </Badge>
              )}
              {stats.insights.trend === 'down' && (
                <Badge className="bg-red-500 text-white">
                  <TrendingDown className="w-3 h-3 mr-1" />
                  {stats.insights.trend_percentage}% vs. Vorwoche
                </Badge>
              )}
              {stats.insights.trend === 'stable' && (
                <Badge variant="secondary">
                  Stabil vs. Vorwoche
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Heute
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-500">{stats.today.total}</div>
              <p className="text-xs text-muted-foreground">
                Avg. Score: {stats.today.avg_quality_score || "—"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                7 Tage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.last_7_days.total}</div>
              <p className="text-xs text-muted-foreground">
                ~{Math.round(stats.last_7_days.total / 7)} pro Tag
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                30 Tage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.last_30_days.total}</div>
              <p className="text-xs text-muted-foreground">
                ~{Math.round(stats.last_30_days.avg_per_day)} pro Tag
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Peak Hour
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-500">
                {stats.insights ? formatHour(stats.insights.best_hour) : "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                ~{stats.insights?.best_hour_avg || 0} Listings
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ML Insights Card */}
        {stats.insights && (
          <Card className="border-2 border-blue-200 bg-blue-50/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="w-5 h-5 text-blue-500" />
                ML Insights - Optimale Scrape-Zeiten
              </CardTitle>
              <CardDescription>
                Basierend auf den letzten 30 Tagen Daten
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Peak Hours */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-green-600 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Peak Hours (viele Listings)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {stats.insights.peak_hours.map(hour => (
                      <Badge key={hour} className="bg-green-500 text-white">
                        {formatHour(hour)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Beste Zeit: {formatHour(stats.insights.best_hour)} (~{stats.insights.best_hour_avg} Listings)
                  </p>
                </div>

                {/* Quiet Hours */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-red-600 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    Ruhige Stunden (wenig Listings)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {stats.insights.quiet_hours.map(hour => (
                      <Badge key={hour} variant="outline" className="border-red-200 text-red-600">
                        {formatHour(hour)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Wenigste: {formatHour(stats.insights.worst_hour)} (~{stats.insights.worst_hour_avg} Listings)
                  </p>
                </div>

                {/* Best Day */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-blue-600 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Bester Wochentag
                  </div>
                  <Badge className="bg-blue-500 text-white text-lg px-4 py-1">
                    {stats.insights.best_day_of_week}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    ~{stats.insights.best_day_avg} Listings im Durchschnitt
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs for different views */}
        <Tabs defaultValue="hourly" className="space-y-4">
          <TabsList>
            <TabsTrigger value="hourly" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Nach Uhrzeit
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Nach Tag
            </TabsTrigger>
            <TabsTrigger value="source" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Nach Quelle
            </TabsTrigger>
          </TabsList>

          {/* Hourly View */}
          <TabsContent value="hourly">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Heute nach Uhrzeit</CardTitle>
                <CardDescription>
                  Verteilung der {stats.today.total} Listings über den Tag
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-24 gap-1 h-56">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const count = stats.today.by_hour[hour.toString()] || 0;
                    const maxCount = Math.max(...Object.values(stats.today.by_hour), 1);
                    const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
                    const isPeak = stats.insights?.peak_hours.includes(hour);
                    const isQuiet = stats.insights?.quiet_hours.includes(hour);

                    return (
                      <div
                        key={hour}
                        className="flex flex-col items-center justify-end h-full group cursor-pointer"
                        title={`${formatHour(hour)}: ${count} Listings`}
                      >
                        {/* Count label - always visible if > 0 */}
                        <span className={`text-xs font-bold mb-1 transition-all ${
                          count > 0 ? 'text-foreground' : 'text-transparent'
                        } group-hover:text-blue-600`}>
                          {count > 0 ? count : ''}
                        </span>

                        {/* Bar */}
                        <div className="w-full flex-1 flex items-end">
                          <div
                            className={`w-full rounded-t-md transition-all duration-200 group-hover:scale-105 ${
                              isPeak
                                ? 'bg-gradient-to-t from-green-600 to-green-400 shadow-sm shadow-green-200'
                                : isQuiet
                                  ? 'bg-gradient-to-t from-red-400 to-red-300'
                                  : count > 0
                                    ? 'bg-gradient-to-t from-blue-600 to-blue-400 shadow-sm shadow-blue-200'
                                    : 'bg-gray-100'
                            }`}
                            style={{
                              height: count > 0 ? `${Math.max(height, 8)}%` : '4px',
                            }}
                          />
                        </div>

                        {/* Hour label */}
                        <span className={`text-[10px] mt-2 font-medium ${
                          hour % 3 === 0 || count > 0 ? 'text-muted-foreground' : 'text-gray-300'
                        }`}>
                          {hour}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex justify-center gap-6 mt-6 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gradient-to-t from-green-600 to-green-400 rounded" />
                    <span className="text-muted-foreground">Peak Hours</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gradient-to-t from-blue-600 to-blue-400 rounded" />
                    <span className="text-muted-foreground">Normal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gradient-to-t from-red-400 to-red-300 rounded" />
                    <span className="text-muted-foreground">Ruhig</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Daily View */}
          <TabsContent value="daily" className="space-y-4">
            {/* 7 Days Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Letzte 7 Tage</CardTitle>
                <CardDescription>
                  Gesamt: {stats.last_7_days.total} Listings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-3 h-64">
                  {Object.entries(stats.last_7_days.by_day)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([date, count]) => {
                      const maxCount = Math.max(...Object.values(stats.last_7_days.by_day), 1);
                      const height = (count / maxCount) * 100;
                      const dayName = getDayName(date);
                      const isBestDay = stats.insights?.best_day_of_week === dayName;
                      const isToday = date === new Date().toISOString().split('T')[0];

                      return (
                        <div
                          key={date}
                          className="flex flex-col items-center justify-end h-full group cursor-pointer"
                          title={`${formatDate(date)}: ${count} Listings`}
                        >
                          {/* Count - large and bold */}
                          <span className={`text-xl font-bold mb-2 transition-all ${
                            isBestDay ? 'text-blue-600' : 'text-foreground'
                          } group-hover:scale-110`}>
                            {count}
                          </span>

                          {/* Bar container */}
                          <div className="w-full flex-1 flex items-end px-1">
                            <div
                              className={`w-full rounded-lg transition-all duration-200 group-hover:scale-105 ${
                                isToday
                                  ? 'bg-gradient-to-t from-purple-600 to-purple-400 shadow-md shadow-purple-200'
                                  : isBestDay
                                    ? 'bg-gradient-to-t from-blue-600 to-blue-400 shadow-md shadow-blue-200'
                                    : 'bg-gradient-to-t from-green-600 to-green-400 shadow-sm shadow-green-200'
                              }`}
                              style={{ height: `${Math.max(height, 10)}%` }}
                            />
                          </div>

                          {/* Day name */}
                          <span className={`text-sm font-semibold mt-3 ${
                            isToday ? 'text-purple-600' : isBestDay ? 'text-blue-600' : 'text-muted-foreground'
                          }`}>
                            {dayName}
                          </span>

                          {/* Date */}
                          <span className="text-xs text-muted-foreground">
                            {formatDate(date)}
                          </span>
                        </div>
                      );
                    })}
                </div>

                {/* Legend */}
                <div className="flex justify-center gap-6 mt-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gradient-to-t from-purple-600 to-purple-400 rounded" />
                    <span className="text-muted-foreground">Heute</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gradient-to-t from-blue-600 to-blue-400 rounded" />
                    <span className="text-muted-foreground">Bester Tag</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gradient-to-t from-green-600 to-green-400 rounded" />
                    <span className="text-muted-foreground">Normal</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 30 Days Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Letzte 30 Tage</CardTitle>
                <CardDescription>
                  Gesamt: {stats.last_30_days.total} Listings · Durchschnitt: {Math.round(stats.last_30_days.avg_per_day)} pro Tag
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const maxCount = Math.max(...Object.values(stats.last_30_days.by_day), 1);
                  const avgLinePosition = (stats.last_30_days.avg_per_day / maxCount) * 100;

                  return (
                    <div className="relative h-44">
                      {/* Average line - positioned from bottom of chart area */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-orange-400 z-10 pointer-events-none"
                        style={{ bottom: `${avgLinePosition}%` }}
                      >
                        <span className="absolute -top-3 right-0 text-[10px] text-orange-500 font-medium bg-white px-1">
                          ⌀ {Math.round(stats.last_30_days.avg_per_day)}
                        </span>
                      </div>

                      {/* Bars */}
                      <div className="flex gap-[3px] h-full items-end">
                        {Object.entries(stats.last_30_days.by_day)
                          .sort((a, b) => a[0].localeCompare(b[0]))
                          .map(([date, count], index, arr) => {
                            const height = (count / maxCount) * 100;
                            const isAboveAvg = count > stats.last_30_days.avg_per_day;
                            const isLast7Days = index >= arr.length - 7;
                            const isToday = index === arr.length - 1;

                            return (
                              <div
                                key={date}
                                className="flex-1 flex flex-col items-center justify-end h-full group cursor-pointer"
                                title={`${formatDate(date)}: ${count} Listings`}
                              >
                                {/* Hover tooltip */}
                                <span className="text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity mb-1 text-foreground absolute -top-4">
                                  {count}
                                </span>

                                <div
                                  className={`w-full rounded-t transition-all duration-200 group-hover:scale-y-105 origin-bottom ${
                                    isToday
                                      ? 'bg-gradient-to-t from-purple-600 to-purple-400'
                                      : isLast7Days
                                        ? isAboveAvg
                                          ? 'bg-gradient-to-t from-green-600 to-green-400'
                                          : 'bg-gradient-to-t from-blue-500 to-blue-300'
                                        : isAboveAvg
                                          ? 'bg-green-400'
                                          : 'bg-gray-300'
                                  }`}
                                  style={{ height: `${Math.max(height, 3)}%` }}
                                />
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex justify-between items-center text-xs text-muted-foreground mt-4">
                  <span>Vor 30 Tagen</span>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded" />
                      <span>Über Durchschnitt</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-gray-300 rounded" />
                      <span>Unter Durchschnitt</span>
                    </div>
                  </div>
                  <span>Heute</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Source View */}
          <TabsContent value="source">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Today by Source */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Heute</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(stats.today.by_source).length > 0 ? (
                    Object.entries(stats.today.by_source).map(([source, count]) => {
                      const total = stats.today.total || 1;
                      const percentage = Math.round((count / total) * 100);
                      return (
                        <div key={source} className={`p-3 rounded-lg border ${getSourceBgColor(source)}`}>
                          <div className="flex justify-between items-center">
                            <Badge className={getSourceColor(source)}>{source}</Badge>
                            <span className="text-2xl font-bold">{count}</span>
                          </div>
                          <div className="mt-2 bg-white/50 rounded-full h-2">
                            <div
                              className={`h-full rounded-full ${getSourceColor(source)}`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{percentage}%</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-muted-foreground py-4">Noch keine Daten heute</div>
                  )}
                </CardContent>
              </Card>

              {/* 7 Days by Source */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">7 Tage</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(stats.last_7_days.by_source).map(([source, count]) => {
                    const total = stats.last_7_days.total || 1;
                    const percentage = Math.round((count / total) * 100);
                    return (
                      <div key={source} className={`p-3 rounded-lg border ${getSourceBgColor(source)}`}>
                        <div className="flex justify-between items-center">
                          <Badge className={getSourceColor(source)}>{source}</Badge>
                          <span className="text-2xl font-bold">{count}</span>
                        </div>
                        <div className="mt-2 bg-white/50 rounded-full h-2">
                          <div
                            className={`h-full rounded-full ${getSourceColor(source)}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {percentage}% (~{Math.round(count / 7)} pro Tag)
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* 30 Days by Source */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">30 Tage</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(stats.last_30_days.by_source).map(([source, count]) => {
                    const total = stats.last_30_days.total || 1;
                    const percentage = Math.round((count / total) * 100);
                    return (
                      <div key={source} className={`p-3 rounded-lg border ${getSourceBgColor(source)}`}>
                        <div className="flex justify-between items-center">
                          <Badge className={getSourceColor(source)}>{source}</Badge>
                          <span className="text-2xl font-bold">{count}</span>
                        </div>
                        <div className="mt-2 bg-white/50 rounded-full h-2">
                          <div
                            className={`h-full rounded-full ${getSourceColor(source)}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {percentage}% (~{Math.round(count / 30)} pro Tag)
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
