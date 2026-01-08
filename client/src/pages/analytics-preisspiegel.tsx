import PreisspiegelTest from "@/components/preisspiegel-test";

interface AnalyticsPreisspiegelProps {
  user: { id: number; username: string; is_admin?: boolean };
}

// KONFIGURATION: Admin-only Zugriff
// Setze auf 'false' um allen Usern Zugriff zu geben
const ADMIN_ONLY = true;

export default function AnalyticsPreisspiegel({ user }: AnalyticsPreisspiegelProps) {
  // Check access permissions
  if (ADMIN_ONLY && !user?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-lg font-medium">Zugriff verweigert</p>
        <p className="text-sm mt-2">Nur Administratoren können diese Seite sehen.</p>
        <p className="text-xs mt-4 text-gray-400">
          (Zugriff kann in analytics-preisspiegel.tsx konfiguriert werden)
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Preisspiegel</h1>
        <p className="text-muted-foreground mt-2">
          Wien Marktdaten - Durchschnittspreise pro Bezirk
        </p>
      </div>
      <PreisspiegelTest />
    </div>
  );
}
