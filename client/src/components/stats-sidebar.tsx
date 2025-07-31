import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { 
  User, 
  Activity, 
  Clock, 
  Calendar, 
  TrendingUp, 
  Users, 
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown
} from "lucide-react";

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
}

interface PersonalStats {
  totalLogins: number;
  lastLogin: string;
  totalAcquisitions: number;
  successfulAcquisitions: number;
  successRate: number;
  avgSessionDuration: number;
  streakDays: number;
}

interface StatsSidebarProps {
  user: { id: number; username: string; is_admin?: boolean };
}

export default function StatsSidebar({ user }: StatsSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [sortBy, setSortBy] = useState("successRate");
  const [filterOnline, setFilterOnline] = useState("all");

  // Personal statistics
  const { data: personalStats } = useQuery<PersonalStats>({
    queryKey: ["/api/user-stats/personal", user.id],
  });

  // Admin statistics (all users)
  const { data: allUserStats = [] } = useQuery<UserStats[]>({
    queryKey: ["/api/user-stats/all"],
    enabled: user.is_admin,
  });

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
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
      if (filterOnline === "online") return userStat.isOnline;
      if (filterOnline === "offline") return !userStat.isOnline;
      return true;
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
        default:
          return 0;
      }
    });

  if (!isExpanded) {
    return (
      <div className="fixed left-4 top-20 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(true)}
          className="bg-white shadow-lg hover:shadow-xl transition-shadow"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed left-0 top-0 h-full w-80 bg-white shadow-lg border-r border-gray-200 z-40 overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 flex items-center">
            <Activity className="h-4 w-4 mr-2" />
            Statistiken
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(false)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Personal Statistics */}
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center">
              <User className="h-4 w-4 mr-2 text-blue-600" />
              Meine Statistiken
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div className="text-gray-600">Logins</div>
                <div className="font-semibold text-lg">
                  {personalStats?.totalLogins || 0}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-gray-600">Streak</div>
                <div className="font-semibold text-lg text-green-600">
                  {personalStats?.streakDays || 0}d
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-gray-600">Akquisen</div>
                <div className="font-semibold text-lg">
                  {personalStats?.totalAcquisitions || 0}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-gray-600">Erfolg</div>
                <div className="font-semibold text-lg text-green-600">
                  {personalStats?.successRate || 0}%
                </div>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex items-center justify-between">
                <span>Letzte Aktivität:</span>
                <span className="font-medium">
                  {personalStats?.lastLogin ? formatLastLogin(personalStats.lastLogin) : "Nie"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Ø Session:</span>
                <span className="font-medium">
                  {personalStats?.avgSessionDuration ? formatDuration(personalStats.avgSessionDuration) : "0m"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Admin Statistics */}
        {user.is_admin && (
          <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Users className="h-4 w-4 mr-2 text-purple-600" />
                Team Übersicht
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filters */}
              <div className="grid grid-cols-2 gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="successRate">Erfolgsrate</SelectItem>
                    <SelectItem value="acquisitions">Akquisen</SelectItem>
                    <SelectItem value="logins">Logins</SelectItem>
                    <SelectItem value="lastLogin">Letzte Aktivität</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={filterOnline} onValueChange={setFilterOnline}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* User List */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {filteredAndSortedUsers.map((userStat) => (
                  <div
                    key={userStat.userId}
                    className="p-2 rounded-lg bg-white border border-gray-200 hover:border-purple-300 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <div className="font-medium text-sm">{userStat.username}</div>
                        {userStat.isOnline ? (
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        ) : (
                          <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                        )}
                      </div>
                      <Badge 
                        variant={userStat.successRate > 50 ? "default" : "secondary"}
                        className="text-xs px-1 py-0"
                      >
                        {userStat.successRate}%
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-1 text-xs text-gray-600">
                      <div>{userStat.totalAcquisitions} Akq.</div>
                      <div>{userStat.totalLogins} Logins</div>
                      <div>{formatLastLogin(userStat.lastLogin)}</div>
                    </div>
                  </div>
                ))}
                
                {filteredAndSortedUsers.length === 0 && (
                  <div className="text-center py-4 text-xs text-gray-500">
                    Keine Benutzer gefunden
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center">
              <TrendingUp className="h-4 w-4 mr-2 text-green-600" />
              Heute
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {personalStats?.successfulAcquisitions || 0}
                </div>
                <div className="text-xs text-gray-600">Erfolge</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {formatDuration(personalStats?.avgSessionDuration || 0)}
                </div>
                <div className="text-xs text-gray-600">Online</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}