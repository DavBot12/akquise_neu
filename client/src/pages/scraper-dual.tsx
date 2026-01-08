import ScraperDualConsole from "@/components/scraper-dual-console";

interface ScraperDualProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function ScraperDual({ user }: ScraperDualProps) {
  // Only admins can access this page
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
        <h1 className="text-3xl font-bold">Dual Scraper</h1>
        <p className="text-muted-foreground mt-2">
          24/7 Scraper + Newest Scraper + Manueller V3 Scraper
        </p>
      </div>
      <ScraperDualConsole />
    </div>
  );
}
