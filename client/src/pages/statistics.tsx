import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  User, 
  Activity, 
  Clock, 
  Calendar, 
  TrendingUp, 
  Users, 
  Search,
  RefreshCw,
  Eye,
  Award,
  Target,
  BarChart3
} from "lucide-react";

interface PersonalStats {
  totalLogins: number;
  lastLogin: string;
  totalAcquisitions: number;
  successfulAcquisitions: number;
  successRate: number;
  avgSessionDuration: number;
  streakDays: number;
  monthlyLogins: number[];
  dailyActivity: { date: string; logins: number; acquisitions: number }[];
}

interface UserStats {
  userId: number;
  username: string;
  totalLogins: number;
  lastLogin: string;
  totalAcquisitions: number;
  successfulAcquisitions: number;
  successRate: number;
  avgSessionDuration: number;
  isOnline: boolean;
  monthlyLogins: number[];
  loginHistory: { date: string; duration: number }[];
  recentActions: { action: string; timestamp: string; details: string }[];
}

interface StatisticsProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function Statistics({ user }: StatisticsProps) {
  const [activeView, setActiveView] = useState("personal");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("successRate");
  const [filterBy, setFilterBy] = useState("all");
  const [selectedUser, setSelectedUser] = useState<UserStats | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const queryClient = useQueryClient();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-stats/personal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-stats/all"] });
    }, 30000);

    return () => clearInterval(interval);
  }, [queryClient]);

  // Personal statistics
  const { data: personalStats, isLoading: personalLoading } = useQuery<PersonalStats>({
    queryKey: ["/api/user-stats/personal", user.id],
    refetchInterval: 30000,
  });

  // Admin statistics (all users)
  const { data: allUserStats = [], isLoading: allStatsLoading } = useQuery<UserStats[]>({
    queryKey: ["/api/user-stats/all"],
    enabled: user.is_admin,
    refetchInterval: 30000,
  });

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatLastLogin = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return "Gerade aktiv";
    if (diffHours < 24) return `vor ${diffHours}h`;
    if (diffDays < 7) return `vor ${diffDays}d`;
    return date.toLocaleDateString('de-DE');
  };

  const filteredAndSortedUsers = allUserStats
    .filter(userStat => {
      const matchesSearch = userStat.username.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filterBy === "all" || 
        (filterBy === "online" && userStat.isOnline) ||
        (filterBy === "offline" && !userStat.isOnline) ||
        (filterBy === "high-performers" && userStat.successRate > 70);
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "successRate":
          return b.successRate - a.successRate;
        case "acquisitions":
          return b.totalAcquisitions - a.totalAcquisitions;
        case "logins":
          return b.totalLogins - a.totalLogins;
        case "lastLogin":
          return new Date(b.lastLogin).getTime() - new Date(a.lastLogin).getTime();
        case "username":
          return a.username.localeCompare(b.username);
        default:
          return 0;
      }
    });

  const handleUserClick = (userStat: UserStats) => {
    setSelectedUser(userStat);
    setIsDetailModalOpen(true);
  };

  const refreshStats = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/user-stats/personal"] });
    queryClient.invalidateQueries({ queryKey: ["/api/user-stats/all"] });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">📊 Statistiken</h1>
          <p className="text-gray-600 mt-1">
            {user.is_admin ? "Team-Performance und Benutzer-Übersicht" : "Ihre persönlichen Leistungsdaten"}
          </p>
        </div>
        <div className="flex space-x-3">
          {user.is_admin && (
            <div className="flex space-x-2">
              <Button 
                onClick={() => setActiveView("personal")} 
                variant={activeView === "personal" ? "default" : "outline"}
                size="sm"
              >
                Persönliche Statistiken
              </Button>
              <Button 
                onClick={() => setActiveView("team")} 
                variant={activeView === "team" ? "default" : "outline"}
                size="sm"
              >
                Team-Übersicht
              </Button>
            </div>
          )}
          <Button onClick={refreshStats} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
        </div>
      </div>

        {/* Personal Statistics View */}
        {activeView === "personal" && (
          <div className="space-y-6">
          {personalLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-blue-700 flex items-center">
                      <User className="h-4 w-4 mr-2" />
                      Gesamt Logins
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-900">
                      {personalStats?.totalLogins || 0}
                    </div>
                    <p className="text-xs text-blue-600 mt-1">
                      Letzter Login: {personalStats?.lastLogin ? formatLastLogin(personalStats.lastLogin) : "Nie"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-green-700 flex items-center">
                      <Target className="h-4 w-4 mr-2" />
                      Akquisen
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-900">
                      {personalStats?.totalAcquisitions || 0}
                    </div>
                    <p className="text-xs text-green-600 mt-1">
                      {personalStats?.successfulAcquisitions || 0} erfolgreich
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-purple-700 flex items-center">
                      <Award className="h-4 w-4 mr-2" />
                      Erfolgsrate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-purple-900">
                      {personalStats?.successRate || 0}%
                    </div>
                    <Badge 
                      variant={personalStats && personalStats.successRate > 50 ? "default" : "secondary"}
                      className="text-xs mt-1"
                    >
                      {personalStats && personalStats.successRate > 70 ? "Excellent" : 
                       personalStats && personalStats.successRate > 50 ? "Good" : "Needs Improvement"}
                    </Badge>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-orange-700 flex items-center">
                      <Clock className="h-4 w-4 mr-2" />
                      Ø Session
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-900">
                      {personalStats ? formatDuration(personalStats.avgSessionDuration) : "0m"}
                    </div>
                    <p className="text-xs text-orange-600 mt-1">
                      {personalStats?.streakDays || 0} Tage Streak
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Activity Chart Placeholder */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <BarChart3 className="h-5 w-5 mr-2" />
                    Aktivitätsverlauf
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <Activity className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                      <p>Aktivitätsgraph wird geladen...</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          </div>
        )}

        {/* Team Overview View - Admin Only */}
        {user.is_admin && activeView === "team" && (
          <div className="space-y-6">
            {/* Search and Filter Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Users className="h-5 w-5 mr-2" />
                  Team-Übersicht
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-4">
                  <div className="flex-1">
                    <Input
                      placeholder="Benutzer suchen..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="max-w-sm"
                    />
                  </div>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="successRate">Erfolgsrate</SelectItem>
                      <SelectItem value="acquisitions">Akquisen</SelectItem>
                      <SelectItem value="logins">Logins</SelectItem>
                      <SelectItem value="lastLogin">Letzte Aktivität</SelectItem>
                      <SelectItem value="username">Name</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterBy} onValueChange={setFilterBy}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Benutzer</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="offline">Offline</SelectItem>
                      <SelectItem value="high-performers">Top Performer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* User List */}
                <div className="space-y-3">
                  {allStatsLoading ? (
                    [...Array(5)].map((_, i) => (
                      <div key={i} className="p-4 border rounded-lg animate-pulse">
                        <div className="flex items-center justify-between">
                          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                          <div className="h-4 bg-gray-200 rounded w-16"></div>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-4">
                          {[...Array(4)].map((_, j) => (
                            <div key={j} className="h-3 bg-gray-200 rounded"></div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    filteredAndSortedUsers.map((userStat) => (
                      <div
                        key={userStat.userId}
                        className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => handleUserClick(userStat)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <div className="font-medium text-lg">{userStat.username}</div>
                            {userStat.isOnline ? (
                              <Badge variant="default" className="text-xs">Online</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Offline</Badge>
                            )}
                            <Badge 
                              variant={userStat.successRate > 70 ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {userStat.successRate}% Erfolg
                            </Badge>
                          </div>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-sm text-gray-600">
                          <div>
                            <span className="font-medium">{userStat.totalLogins}</span> Logins
                          </div>
                          <div>
                            <span className="font-medium">{userStat.totalAcquisitions}</span> Akquisen
                          </div>
                          <div>
                            <span className="font-medium">{formatDuration(userStat.avgSessionDuration)}</span> Ø Session
                          </div>
                          <div>
                            Zuletzt: <span className="font-medium">{formatLastLogin(userStat.lastLogin)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  
                  {filteredAndSortedUsers.length === 0 && !allStatsLoading && (
                    <div className="text-center py-8 text-gray-500">
                      <Users className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                      <p>Keine Benutzer gefunden</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

      {/* User Detail Modal */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <User className="h-5 w-5 mr-2" />
              Benutzer Details: {selectedUser?.username}
            </DialogTitle>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{selectedUser.totalLogins}</div>
                    <div className="text-sm text-gray-600">Logins</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{selectedUser.totalAcquisitions}</div>
                    <div className="text-sm text-gray-600">Akquisen</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-purple-600">{selectedUser.successRate}%</div>
                    <div className="text-sm text-gray-600">Erfolgsrate</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatDuration(selectedUser.avgSessionDuration)}
                    </div>
                    <div className="text-sm text-gray-600">Ø Session</div>
                  </CardContent>
                </Card>
              </div>

              {/* Login History */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Login-Historie</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedUser.loginHistory?.map((login, index) => (
                      <div key={index} className="flex justify-between items-center py-2 border-b">
                        <span className="text-sm">{new Date(login.date).toLocaleString('de-DE')}</span>
                        <span className="text-sm text-gray-600">{formatDuration(login.duration)}</span>
                      </div>
                    )) || (
                      <p className="text-center text-gray-500 py-4">Keine Login-Historie verfügbar</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Recent Actions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Letzte Aktionen</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedUser.recentActions?.map((action, index) => (
                      <div key={index} className="flex justify-between items-start py-2 border-b">
                        <div>
                          <div className="font-medium text-sm">{action.action}</div>
                          <div className="text-xs text-gray-600">{action.details}</div>
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {new Date(action.timestamp).toLocaleString('de-DE')}
                        </span>
                      </div>
                    )) || (
                      <p className="text-center text-gray-500 py-4">Keine Aktionen verfügbar</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}