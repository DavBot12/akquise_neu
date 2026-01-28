import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { MLLearningBadge } from '@/components/ml-learning-badge';
import { apiRequest } from '@/lib/queryClient';
import type { Listing } from '@shared/schema';

interface QualityScoreFeedbackModalProps {
  listing: Listing;
  open: boolean;
  onClose: () => void;
}

export function QualityScoreFeedbackModal({
  listing,
  open,
  onClose,
}: QualityScoreFeedbackModalProps) {
  const [userScore, setUserScore] = useState(listing.quality_score || 0);
  const queryClient = useQueryClient();

  // Reset slider when listing changes
  useEffect(() => {
    setUserScore(listing.quality_score || 0);
  }, [listing.quality_score]);

  const submitFeedbackMutation = useMutation({
    mutationFn: async (data: { listing_id: number; system_score: number; user_score: number }) => {
      await apiRequest('POST', '/api/ml/feedback', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ml/stats'] });
      onClose();
    },
  });

  const handleSubmit = () => {
    submitFeedbackMutation.mutate({
      listing_id: listing.id,
      system_score: listing.quality_score || 0,
      user_score: userScore,
    });
  };

  const systemScore = listing.quality_score || 0;
  const delta = userScore - systemScore;

  // Calculate breakdown percentages for display
  const totalPossible = 150;
  const freshnessPercent = Math.round(((listing.quality_score || 0) / totalPossible) * 100);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Quality Score anpassen</DialogTitle>
          <DialogDescription>
            Hilf dem System zu lernen, was einen guten Quality Score ausmacht
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current System Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Aktueller System-Score</span>
              <span className="text-2xl font-bold">{systemScore}</span>
            </div>

            {/* Score Breakdown */}
            <div className="space-y-1 text-sm text-muted-foreground">
              <div>Frische: {listing.quality_score || 0} Punkte (von {totalPossible} möglich)</div>
              <div className="text-xs">
                Basiert auf: Veröffentlichungsdatum, letzte Änderung, Fotos, Beschreibung, Preis-Leistung
              </div>
            </div>
          </div>

          {/* User Score Adjustment */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Deine Bewertung</span>
              <span className="text-2xl font-bold">{userScore}</span>
            </div>

            <Slider
              value={[userScore]}
              onValueChange={(val) => setUserScore(val[0])}
              min={0}
              max={150}
              step={5}
              className="w-full"
            />

            {/* Delta Indicator */}
            {delta !== 0 && (
              <div
                className={`text-center text-sm font-medium ${
                  delta > 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {delta > 0 ? '↑' : '↓'} {Math.abs(delta)} Punkte {delta > 0 ? 'höher' : 'niedriger'}
              </div>
            )}
          </div>

          {/* ML Learning Badge */}
          <MLLearningBadge />

          {/* Submit Button */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Abbrechen
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitFeedbackMutation.isPending || delta === 0}
              className="flex-1"
            >
              {submitFeedbackMutation.isPending ? 'Speichert...' : 'Bewertung speichern'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
