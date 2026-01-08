import TeamPerformance from "@/components/team-performance";

interface AnalyticsTeamProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function AnalyticsTeam({ user }: AnalyticsTeamProps) {
  // Only admins can access team performance
  if (!user?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-lg font-medium">Zugriff verweigert</p>
        <p className="text-sm mt-2">Nur Administratoren können diese Seite sehen.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Team Performance</h1>
        <p className="text-muted-foreground mt-2">
          Übersicht über die Leistung aller Mitarbeiter
        </p>
      </div>
      <TeamPerformance />
    </div>
  );
}
