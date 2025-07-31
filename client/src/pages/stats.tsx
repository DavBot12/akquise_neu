import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StatsPageProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function StatsPage({ user }: StatsPageProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/acquisitions/stats", user.id],
    queryFn: async () => {
      const response = await fetch(`/api/acquisitions/stats?userId=${user.id}`);
      return response.json();
    },
  });

  const { data: acquisitions = [] } = useQuery({
    queryKey: ["/api/acquisitions/user", user.id],
    queryFn: async () => {
      const response = await fetch(`/api/acquisitions/user/${user.id}`);
      return response.json();
    },
  });

  if (isLoading) {
    return <div className="p-4">Lade Statistiken...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Akquise-Statistiken</h1>
        <Badge variant="outline">Benutzer: {user.username}</Badge>
      </div>

      {/* Statistik Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Gesamt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">Kontaktierte Listings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Erfolg</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.erfolg || 0}</div>
            <p className="text-xs text-muted-foreground">Erfolgreiche Akquisen</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Absagen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats?.nicht_erfolgreich || 0}</div>
            <p className="text-xs text-muted-foreground">Nicht erfolgreiche Akquisen</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Erfolgsrate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {stats?.erfolgsrate ? `${stats.erfolgsrate.toFixed(1)}%` : "0%"}
            </div>
            <p className="text-xs text-muted-foreground">Erfolg / Gesamt</p>
          </CardContent>
        </Card>
      </div>

      {/* Aktuelle Akquisen */}
      <Card>
        <CardHeader>
          <CardTitle>Aktuelle Akquisen</CardTitle>
        </CardHeader>
        <CardContent>
          {acquisitions.length === 0 ? (
            <p className="text-muted-foreground">Noch keine Akquisen gestartet.</p>
          ) : (
            <div className="space-y-2">
              {acquisitions.slice(0, 5).map((acquisition: any) => (
                <div key={acquisition.id} className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <p className="font-medium">Listing #{acquisition.listing_id}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(acquisition.contacted_at).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  <Badge variant={
                    acquisition.status === 'erfolg' ? 'default' :
                    acquisition.status === 'absage' ? 'destructive' : 'secondary'
                  }>
                    {acquisition.status === 'erfolg' ? 'Erfolg' :
                     acquisition.status === 'absage' ? 'Absage' : 'In Bearbeitung'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}