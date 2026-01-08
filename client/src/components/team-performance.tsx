import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, Target, Users } from "lucide-react";

interface UserStats {
  id: number;
  username: string;
  total: number;
  erfolg: number;
  nicht_erfolgreich: number;
  erfolgsrate: number;
  last_login: string | null;
}

export default function TeamPerformance() {
  const { data: stats, isLoading } = useQuery<UserStats[]>({
    queryKey: ["/api/admin/users-stats"],
    refetchInterval: 30000, // Refresh every 30s
  });

  const formatLastLogin = (lastLogin: string | null) => {
    if (!lastLogin) return "Nie";

    const date = new Date(lastLogin);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Gerade eben";
    if (diffMins < 60) return `Vor ${diffMins} Min`;
    if (diffHours < 24) return `Vor ${diffHours}h`;
    if (diffDays === 1) return "Gestern";
    if (diffDays < 7) return `Vor ${diffDays} Tagen`;

    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Lade Performance-Daten...</div>
      </div>
    );
  }

  if (!stats || stats.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Keine Performance-Daten vorhanden</div>
      </div>
    );
  }

  // Sort by erfolgsrate (descending)
  const sortedStats = [...stats].sort((a, b) => b.erfolgsrate - a.erfolgsrate);

  // Calculate team totals
  const teamTotals = stats.reduce(
    (acc, user) => ({
      total: acc.total + user.total,
      erfolg: acc.erfolg + user.erfolg,
      nicht_erfolgreich: acc.nicht_erfolgreich + user.nicht_erfolgreich,
    }),
    { total: 0, erfolg: 0, nicht_erfolgreich: 0 }
  );
  const teamErfolgsrate = teamTotals.total > 0
    ? (teamTotals.erfolg / teamTotals.total) * 100
    : 0;

  // Get top 3 performers
  const topPerformers = sortedStats.slice(0, 3);

  const getBadgeColor = (rate: number) => {
    if (rate >= 70) return "bg-green-600 text-white";
    if (rate >= 50) return "bg-yellow-600 text-white";
    if (rate >= 30) return "bg-orange-600 text-white";
    return "bg-red-600 text-white";
  };

  const getRankIcon = (index: number) => {
    if (index === 0) return "🥇";
    if (index === 1) return "🥈";
    if (index === 2) return "🥉";
    return `${index + 1}.`;
  };

  return (
    <div className="space-y-6">
      {/* Team Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Gesamt</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.length}</div>
            <p className="text-xs text-muted-foreground">Aktive Mitarbeiter</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Akquisen</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamTotals.total}</div>
            <p className="text-xs text-muted-foreground">Alle Kontaktversuche</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Erfolge</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{teamTotals.erfolg}</div>
            <p className="text-xs text-muted-foreground">Erfolgreiche Akquisen</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Erfolgsrate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamErfolgsrate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Durchschnitt</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Performers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Top Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topPerformers.map((user, index) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="text-2xl">{getRankIcon(index)}</div>
                  <div>
                    <div className="font-semibold text-lg">{user.username}</div>
                    <div className="text-sm text-muted-foreground">
                      {user.erfolg} Erfolge von {user.total} Akquisen
                    </div>
                  </div>
                </div>
                <Badge className={getBadgeColor(user.erfolgsrate)}>
                  {user.erfolgsrate.toFixed(1)}%
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Full Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Team Performance Übersicht
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3">Rang</th>
                  <th className="text-left p-3">Mitarbeiter</th>
                  <th className="text-right p-3">Total Akquisen</th>
                  <th className="text-right p-3">Erfolge</th>
                  <th className="text-right p-3">Nicht Erfolgreich</th>
                  <th className="text-right p-3">Erfolgsrate</th>
                  <th className="text-right p-3">Letzter Login</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((user, index) => (
                  <tr
                    key={user.id}
                    className={`border-b hover:bg-muted/50 transition-colors ${
                      index < 3 ? "bg-muted/30" : ""
                    }`}
                  >
                    <td className="p-3">
                      <span className="text-lg font-semibold">{getRankIcon(index)}</span>
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{user.username}</div>
                    </td>
                    <td className="text-right p-3 font-semibold">{user.total}</td>
                    <td className="text-right p-3 text-green-600 font-semibold">
                      {user.erfolg}
                    </td>
                    <td className="text-right p-3 text-red-600">
                      {user.nicht_erfolgreich}
                    </td>
                    <td className="text-right p-3">
                      <Badge className={getBadgeColor(user.erfolgsrate)}>
                        {user.erfolgsrate.toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="text-right p-3 text-sm text-muted-foreground">
                      {formatLastLogin(user.last_login)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
