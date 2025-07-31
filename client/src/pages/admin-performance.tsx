import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, Target, Award } from "lucide-react";

export default function AdminPerformancePage() {
  const { data: usersStats = [], isLoading } = useQuery({
    queryKey: ["/api/admin/users-stats"],
    queryFn: async () => {
      const response = await fetch("/api/admin/users-stats");
      return response.json();
    },
  });

  if (isLoading) {
    return <div className="p-4">Lade Performance-Daten...</div>;
  }

  const totalUsers = usersStats.length;
  const totalAcquisitions = usersStats.reduce((sum: number, user: any) => sum + user.total, 0);
  const totalSuccessful = usersStats.reduce((sum: number, user: any) => sum + user.erfolg, 0);
  const overallSuccessRate = totalAcquisitions > 0 ? (totalSuccessful / totalAcquisitions) * 100 : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Mitarbeiter Performance</h1>
        <Badge variant="outline" className="flex items-center gap-1">
          <Users className="h-4 w-4" />
          {totalUsers} Mitarbeiter
        </Badge>
      </div>

      {/* Gesamtstatistiken */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Aktive Mitarbeiter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUsers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Gesamt Akquisen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAcquisitions}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Award className="h-4 w-4" />
              Erfolgreiche Akquisen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalSuccessful}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Durchschnittliche Erfolgsrate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {overallSuccessRate.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mitarbeiter-Details */}
      <Card>
        <CardHeader>
          <CardTitle>Mitarbeiter-Performance im Detail</CardTitle>
        </CardHeader>
        <CardContent>
          {usersStats.length === 0 ? (
            <p className="text-muted-foreground">Noch keine Mitarbeiter-Daten verfügbar.</p>
          ) : (
            <div className="space-y-4">
              {usersStats
                .sort((a: any, b: any) => b.erfolgsrate - a.erfolgsrate)
                .map((user: any) => (
                  <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-blue-600">
                          {user.username.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">{user.username}</p>
                        <p className="text-sm text-muted-foreground">
                          {user.total} Akquisen insgesamt
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-green-600 font-medium">
                          {user.erfolg} erfolgreich
                        </p>
                        <p className="text-sm text-red-600">
                          {user.nicht_erfolgreich} nicht erfolgreich
                        </p>
                      </div>
                      
                      <Badge variant={
                        user.erfolgsrate >= 50 ? "default" :
                        user.erfolgsrate >= 25 ? "secondary" : "destructive"
                      }>
                        {user.erfolgsrate.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}