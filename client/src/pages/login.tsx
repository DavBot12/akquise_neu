import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface LoginPageProps {
  onLogin: (user: { id: number; username: string; is_admin?: boolean }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        // Check if registration requires approval
        if (!isLogin && data.requiresApproval) {
          toast({
            title: "Registrierung erfolgreich",
            description: data.message || "Ihr Account wartet auf Freigabe durch den Administrator.",
          });
          setIsLogin(true);
          setPassword("");
        } else if (data.user) {
          toast({
            title: isLogin ? "Anmeldung erfolgreich" : "Registrierung erfolgreich",
            description: `Willkommen, ${data.user.username}`,
          });
          onLogin(data.user);
        } else {
          throw new Error("Unerwartete Server-Antwort");
        }
      } else {
        throw new Error(data.error || "Unbekannter Fehler");
      }
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "Anmeldung fehlgeschlagen",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sira-navy p-4">
      {/* Background Pattern (subtle) */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(to right, #FFFFFF 1px, transparent 1px), linear-gradient(to bottom, #FFFFFF 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }} />
      </div>

      {/* Login Card */}
      <Card className="w-full max-w-md border-0 shadow-2xl relative">
        <CardHeader className="space-y-6 text-center pt-12 pb-8">
          <img
            src="/sira-logo.png"
            alt="SIRA Akquise"
            className="h-16 w-auto mx-auto"
          />
          <div>
            <h1 className="text-page-heading text-sira-navy">
              {isLogin ? "Anmelden" : "Registrieren"}
            </h1>
            <p className="text-sm text-sira-medium-gray mt-2">
              {isLogin
                ? "Melden Sie sich bei Ihrem Konto an"
                : "Erstellen Sie ein neues Konto"}
            </p>
          </div>
        </CardHeader>

        <CardContent className="pb-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="username"
                className="text-sm font-medium text-sira-text-gray"
              >
                Benutzername
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-11 border-sira-light-gray focus:border-sira-navy focus:ring-sira-navy"
                placeholder="Ihr Benutzername"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-sm font-medium text-sira-text-gray"
              >
                Passwort
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 border-sira-light-gray focus:border-sira-navy focus:ring-sira-navy"
                placeholder="Ihr Passwort"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-sira-navy hover:bg-sira-navy/90 text-white font-medium transition-smooth mt-6"
              disabled={isLoading}
            >
              {isLoading ? "Wird verarbeitet..." : (isLogin ? "Anmelden" : "Registrieren")}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-sira-text-gray hover:text-sira-navy transition-smooth"
            >
              {isLogin
                ? "Noch kein Konto? Registrieren"
                : "Bereits ein Konto? Anmelden"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
