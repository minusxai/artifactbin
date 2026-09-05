'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from '@/lib/dynamic';
import { MicroLabel } from '@/components/ui';
import type { ShelfRow } from '@/components/Shelf';
import type { VegaChartProps } from '@/components/viz/VegaChart';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const EMPTY_SERIES: number[] = [];

const InteractiveVegaChart = dynamic<VegaChartProps>(
  () => import('@/components/viz/VegaChart').then((module) => module.VegaChart),
  {
    ssr: false,
    loading: () => (
      <div aria-label="Engagement chart loading" className="flex h-full w-full items-center justify-center">
        <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-edge border-t-accent" />
      </div>
    ),
  },
);

export interface EngagementDatum extends Record<string, unknown> {
  day: string;
  series: 'views' | 'likes';
  value: number;
}

/** Align differently-sized trailing series and give Vega real UTC timestamps. */
export function engagementRows(
  views: readonly number[],
  likes: readonly number[],
  now = new Date(),
): EngagementDatum[] {
  const days = Math.max(views.length, likes.length);
  if (days === 0) return [];
  const today = Date.parse(now.toISOString().slice(0, 10));
  const offsetValue = (series: readonly number[], index: number) =>
    series[index - (days - series.length)] ?? 0;
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
    return [
      { day: `${day}T12:00:00Z`, series: 'views' as const, value: offsetValue(views, index) },
      { day: `${day}T12:00:00Z`, series: 'likes' as const, value: offsetValue(likes, index) },
    ];
  }).flat();
}

/**
 * One Vega-Lite unit spec gives the dashboard the same shared tooltip and
 * responsive renderer as artifact visualizations. The authored selection
 * works from either the marks or the legend: click focuses, shift-click keeps
 * more than one series, and double-click clears.
 */
export const ENGAGEMENT_SPEC: Record<string, unknown> = {
  mark: {
    type: 'area',
    line: { strokeWidth: 2 },
    point: { filled: true, size: 20 },
    fillOpacity: 0.14,
    cursor: 'pointer',
    clip: true,
  },
  params: [
    {
      name: 'engagement_series',
      select: {
        type: 'point',
        fields: ['series'],
        on: 'click',
        clear: 'dblclick',
        toggle: 'event.shiftKey',
      },
      bind: 'legend',
    },
  ],
  encoding: {
    x: {
      field: 'day',
      type: 'temporal',
      title: null,
      axis: { format: '%b %-d', tickCount: 3, labelAngle: 0, grid: false, domain: false, ticks: false },
    },
    y: {
      field: 'value',
      type: 'quantitative',
      title: null,
      stack: null,
      scale: { zero: true, nice: true },
      axis: { tickCount: 3, domain: false, ticks: false },
    },
    color: {
      field: 'series',
      type: 'nominal',
      sort: ['views', 'likes'],
      scale: {
        domain: ['views', 'likes'],
        range: ['var(--color-accent)', 'var(--color-muted)'],
      },
      legend: { orient: 'top', direction: 'horizontal', symbolType: 'stroke' },
    },
    opacity: {
      condition: { param: 'engagement_series', value: 1 },
      value: 0.18,
    },
    tooltip: [
      { field: 'day', type: 'temporal', title: 'day', format: '%b %-d, %Y' },
      { field: 'series', type: 'nominal', title: 'series' },
      { field: 'value', type: 'quantitative', title: 'count', format: ',d' },
    ],
  },
};

const ENGAGEMENT_ENVELOPE = {
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: ENGAGEMENT_SPEC },
} as unknown as VizEnvelope;

const currentMode = (): 'light' | 'dark' =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function useAppMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(currentMode);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setMode(currentMode()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** A compact owner-only readout in the homepage rail. Profiles never mount it. */
export default function Dashboard({
  rows,
  viewsOverTime = EMPTY_SERIES,
  likes = 0,
  likesOverTime = EMPTY_SERIES,
}: {
  rows: ShelfRow[];
  viewsOverTime?: number[];
  likes?: number;
  likesOverTime?: number[];
}) {
  const documents = rows.filter((row) => row.format === 'markup');
  const dataFiles = rows.filter((row) => row.format !== 'markup' && row.format !== 'folder').length;
  const totalViews = documents.reduce((sum, row) => sum + (row.views ?? 0), 0);
  const periodViews = viewsOverTime.reduce((sum, views) => sum + views, 0);
  const periodLikes = likesOverTime.reduce((sum, count) => sum + count, 0);
  const engagement = periodViews + periodLikes;
  const chartRows = useMemo(() => engagementRows(viewsOverTime, likesOverTime), [viewsOverTime, likesOverTime]);
  const colorMode = useAppMode();

  const metrics: ReadonlyArray<readonly [string, number]> = [
    ['artifacts', documents.length],
    ['data files', dataFiles],
    ['views', totalViews],
    ['likes', likes],
  ];

  return (
    <section aria-label="Dashboard" className="reveal lg:sticky lg:top-6">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-edge pb-3">
        <MicroLabel>dashboard</MicroLabel>
        <h1 className="text-[11px] font-medium tracking-tight text-muted">Your artifacts</h1>
      </div>

      <dl aria-label="Dashboard metrics" className="grid grid-cols-2 border-b border-edge">
        {metrics.map(([label, value], index) => (
          <div
            key={label}
            className={`py-2.5 ${index % 2 ? 'border-l border-edge pl-3' : 'pr-3'} ${
              index > 1 ? 'border-t border-edge' : ''
            }`}
          >
            <dt className="font-mono text-[9px] uppercase tracking-[0.11em] text-faint">{label}</dt>
            <dd className="mt-1 font-mono text-lg leading-none font-medium tabular-nums text-fg">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <div className="mb-2.5">
          <h2 className="font-mono text-xs font-semibold text-fg">Engagement over time</h2>
          <p className="mt-1 font-mono text-[9px] tabular-nums text-faint">
            {periodViews} views · {periodLikes} likes · last 30 days
          </p>
        </div>
        {engagement === 0 ? (
          <div className="flex h-36 items-end border-b border-edge pb-3">
            <p className="font-mono text-[11px] text-faint">No engagement in the last 30 days.</p>
          </div>
        ) : (
          <div
            role="group"
            aria-label={`Interactive engagement chart: ${periodViews} views and ${periodLikes} likes in the last 30 days`}
          >
            <div className="flex h-[14.25rem] min-h-0 w-full">
              <InteractiveVegaChart
                envelope={ENGAGEMENT_ENVELOPE}
                rows={chartRows}
                colorMode={colorMode}
                ariaLabel="Engagement Vega chart"
              />
            </div>
            <p className="mt-1 font-mono text-[8px] leading-relaxed text-faint">
              click a line or legend to focus · double-click to reset
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
