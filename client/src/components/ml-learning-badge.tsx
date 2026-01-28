import { useQuery } from '@tanstack/react-query';
import { Brain, TrendingUp } from 'lucide-react';

interface MLStats {
  total_feedback: number;
  active_model: {
    version: string;
    algorithm: string;
    mae: number;
    training_samples: number;
  } | null;
  ready_for_training: boolean;
  phase: 1 | 2 | 3;
}

export function MLLearningBadge() {
  const { data: stats } = useQuery<MLStats>({
    queryKey: ['/api/ml/stats'],
    queryFn: async () => {
      const response = await fetch('/api/ml/stats');
      if (!response.ok) throw new Error('Failed to fetch ML stats');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (!stats) {
    return null;
  }

  // Phase 1: Collecting feedback
  if (stats.phase === 1 || stats.total_feedback < 5) {
    return (
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
        <Brain className="w-4 h-4 text-blue-600" />
        <div className="text-sm">
          <div className="font-medium text-blue-900">System sammelt Feedback...</div>
          <div className="text-xs text-blue-700">
            {stats.total_feedback} von 5 Bewertungen gesammelt
          </div>
        </div>
      </div>
    );
  }

  // Phase 2: Weighted Average (5-49 samples)
  if (stats.phase === 2) {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
        <TrendingUp className="w-4 h-4 text-green-600" />
        <div className="text-sm">
          <div className="font-medium text-green-900">
            🤖 KI lernt aus {stats.total_feedback} Bewertungen
          </div>
          <div className="text-xs text-green-700">
            Algorithmus: Gewichteter Durchschnitt
            {stats.active_model?.mae && ` • Genauigkeit: ±${stats.active_model.mae} Punkte`}
          </div>
        </div>
      </div>
    );
  }

  // Phase 3: Linear Regression (50+ samples)
  if (stats.phase === 3) {
    return (
      <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-md">
        <TrendingUp className="w-4 h-4 text-purple-600" />
        <div className="text-sm">
          <div className="font-medium text-purple-900">
            🤖 KI lernt aus {stats.total_feedback} Bewertungen
          </div>
          <div className="text-xs text-purple-700">
            Algorithmus: Lineare Regression (fortgeschritten)
            {stats.active_model?.mae && ` • Genauigkeit: ±${stats.active_model.mae} Punkte`}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
