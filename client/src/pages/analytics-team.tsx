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
    <div className="min-h-screen bg-sira-background">
      <div className="max-w-[1600px] mx-auto p-6 md:p-8 space-y-6">
        <div className="mb-6">
          <h1 className="text-page-heading text-sira-navy">Team Performance</h1>
          <p className="text-sira-text-gray mt-2">
            Übersicht über die Leistung aller Mitarbeiter
          </p>
        </div>
        <TeamPerformance />
      </div>
    </div>
  );
}
