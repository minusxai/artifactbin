'use client';

import { Tooltip } from '@/components/Tooltip';
import { Spark } from '@/components/ui';

/**
 * The one views glyph used everywhere an artifact count is shown.
 *
 * The count rides over the 30-day spline so the chart owns the available
 * width. Callers may size the mark for their surface, but its composition does
 * not change between cards, mobile rows and desktop table cells.
 */
export function ViewsMark({
  name,
  views,
  sparkline,
  className = '',
}: {
  name: string;
  views: number;
  sparkline?: string;
  className?: string;
}) {
  return (
    <Tooltip content="views · spline is the last 30 days">
      <span aria-label={`${name} views`} className={`relative flex h-5 min-w-0 items-center ${className}`}>
        {sparkline && <Spark svg={sparkline} filled className="absolute inset-0 h-full w-full" />}
        <span className="relative z-[1] shrink-0 rounded-[3px] bg-surface/55 px-0.5 py-px font-mono text-[9px] leading-none tabular-nums text-muted">
          {views} view{views === 1 ? '' : 's'}
        </span>
      </span>
    </Tooltip>
  );
}
