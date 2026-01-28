interface QualityBadgeProps {
  score: number;
  tier: 'excellent' | 'good' | 'medium' | 'low' | null | undefined;
  isGoldFind?: boolean;
  className?: string;
}

export function QualityBadge({ score, tier, isGoldFind, className = '' }: QualityBadgeProps) {
  if (score === undefined || score === null || !tier) {
    return null;
  }

  // Color mapping based on tier
  const colors = {
    excellent: 'bg-green-600 text-white border-green-700',
    good: 'bg-yellow-500 text-white border-yellow-600',
    medium: 'bg-orange-500 text-white border-orange-600',
    low: 'bg-red-500 text-white border-red-600',
  };

  const tierLabels = {
    excellent: 'Top',
    good: 'Gut',
    medium: 'OK',
    low: 'Niedrig',
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`px-2 py-1 rounded text-xs font-bold border ${colors[tier]}`}
        title={`Quality Score: ${score}/150 - ${tierLabels[tier]}`}
      >
        {score}
      </div>
      {isGoldFind && (
        <span
          className="text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-1 rounded border border-yellow-300"
          title="Gold Find: Altes Inserat mit frischem Update - wahrscheinlich Preissenkung!"
        >
          🏆
        </span>
      )}
    </div>
  );
}
