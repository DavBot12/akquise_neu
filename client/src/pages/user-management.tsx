import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface User {
  id: number;
  username: string;
  is_admin: boolean;
  is_approved: boolean;
  created_at: string;
  last_login: string | null;
  total_logins: number;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/admin/users");
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Benutzer konnten nicht geladen werden",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleApproval = async (userId: number, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_approved: !currentStatus }),
      });

      if (response.ok) {
        toast({
          title: "Erfolgreich",
          description: !currentStatus ? "Benutzer wurde freigegeben" : "Freigabe wurde entfernt",
        });
        fetchUsers();
      }
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Aktion fehlgeschlagen",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (userId: number, username: string) => {
    if (!confirm(`Möchten Sie den Benutzer "${username}" wirklich löschen?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast({
          title: "Erfolgreich",
          description: `Benutzer "${username}" wurde gelöscht`,
        });
        fetchUsers();
      }
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Löschen fehlgeschlagen",
        variant: "destructive",
      });
    }
  };

  const handleResetPassword = async (userId: number, username: string) => {
    const newPassword = prompt(`Neues Passwort für "${username}" eingeben:`);

    if (!newPassword) return;

    if (newPassword.length < 4) {
      toast({
        title: "Fehler",
        description: "Passwort muss mindestens 4 Zeichen lang sein",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });

      if (response.ok) {
        toast({
          title: "Erfolgreich",
          description: `Passwort für "${username}" wurde zurückgesetzt`,
        });
      } else {
        throw new Error("Reset failed");
      }
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Passwort-Reset fehlgeschlagen",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <div className="p-8">Lade Benutzer...</div>;
  }

  const pendingUsers = users.filter(u => !u.is_approved && !u.is_admin);
  const approvedUsers = users.filter(u => u.is_approved || u.is_admin);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Benutzerverwaltung</h1>

      {pendingUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Wartende Freigaben
              <Badge variant="destructive">{pendingUsers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Benutzername</TableHead>
                  <TableHead>Registriert am</TableHead>
                  <TableHead>Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>
                      {new Date(user.created_at).toLocaleString('de-DE')}
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button
                        size="sm"
                        onClick={() => handleApproval(user.id, user.is_approved)}
                      >
                        Freigeben
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(user.id, user.username)}
                      >
                        Löschen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Alle Benutzer</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Benutzername</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Letzte Anmeldung</TableHead>
                <TableHead>Gesamte Logins</TableHead>
                <TableHead>Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvedUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.username}
                    {user.is_admin && (
                      <Badge variant="secondary" className="ml-2">Admin</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.is_approved ? (
                      <Badge variant="default">Freigegeben</Badge>
                    ) : (
                      <Badge variant="outline">Wartend</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.last_login
                      ? new Date(user.last_login).toLocaleString('de-DE')
                      : "Nie"}
                  </TableCell>
                  <TableCell>{user.total_logins || 0}</TableCell>
                  <TableCell className="space-x-2">
                    {user.is_admin ? (
                      <span className="text-sm text-muted-foreground">-</span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant={user.is_approved ? "outline" : "default"}
                          onClick={() => handleApproval(user.id, user.is_approved)}
                        >
                          {user.is_approved ? "Sperren" : "Freigeben"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleResetPassword(user.id, user.username)}
                        >
                          Passwort ändern
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(user.id, user.username)}
                        >
                          Löschen
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
