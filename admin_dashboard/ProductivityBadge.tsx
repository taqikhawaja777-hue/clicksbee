import React from 'react';

interface ProductivityBadgeProps {
  score: number;
  loading?: boolean;
}

/**
 * Small color-coded pill showing a live productivity score.
 * green >= 75, amber 50-74, red < 50.
 */
export const ProductivityBadge: React.FC<ProductivityBadgeProps> = ({ score, loading }) => {
  if (loading) {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-400 animate-pulse">
        --%
      </span>
    );
  }

  const colorClasses =
    score >= 75
      ? 'bg-[#e8f8f2] dark:bg-emerald-950/50 text-[#10b981] dark:text-emerald-400 border-[#d2f3e6] dark:border-emerald-900/50'
      : score >= 50
      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/50'
      : 'bg-[#fce8ec] dark:bg-rose-950/50 text-[#ef4444] dark:text-rose-400 border-[#f8d7da] dark:border-rose-900/50';

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${colorClasses}`}>
      {Math.round(score)}%
    </span>
  );
};

export default ProductivityBadge;
