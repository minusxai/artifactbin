'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Database, Eye, FileText, GitFork, Heart, Maximize2, Users, X, type LucideIcon } from 'lucide-react';
import dynamic from '@/lib/dynamic';
import { Tooltip } from '@/components/Tooltip';
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

/** Compact without rounding up: 1,267 reads as 1.2k, while the title keeps 1,267. */
export function compactMetric(value: number): string {
  const compact = (amount: number, suffix: string) => {
    const truncated = Math.floor(amount * 10) / 10;
    return `${Number.isInteger(truncated) ? truncated.toFixed(0) : truncated.toFixed(1)}${suffix}`;
  };
  if (value >= 1_000_000) return compact(value / 1_000_000, 'm');
  if (value >= 1_000) return compact(value / 1_000, 'k');
  return value.toLocaleString('en-US');
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

export interface DashboardProps {
  rows: ShelfRow[];
  viewsOverTime?: number[];
  likes?: number;
  likesOverTime?: number[];
  followers?: number;
  forks?: number;
}

/**
 * One dashboard composition at two scales. The expanded form deliberately
 * reuses this component rather than beginning a separate dashboard design;
 * a future route can mount the same content without inheriting modal chrome.
 */
export function DashboardContent({
  rows,
  viewsOverTime = EMPTY_SERIES,
  likes = 0,
  likesOverTime = EMPTY_SERIES,
  followers = 0,
  forks = 0,
  expanded = false,
  onExpand,
}: DashboardProps & { expanded?: boolean; onExpand?: () => void }) {
  const documents = rows.filter((row) => row.format === 'markup');
  const dataFiles = rows.filter((row) => row.format !== 'markup' && row.format !== 'folder').length;
  const totalViews = documents.reduce((sum, row) => sum + (row.views ?? 0), 0);
  const periodViews = viewsOverTime.reduce((sum, views) => sum + views, 0);
  const periodLikes = likesOverTime.reduce((sum, count) => sum + count, 0);
  const engagement = periodViews + periodLikes;
  const chartRows = useMemo(() => engagementRows(viewsOverTime, likesOverTime), [viewsOverTime, likesOverTime]);
  const colorMode = useAppMode();

  const metrics: ReadonlyArray<{ label: string; value: number; Icon: LucideIcon }> = [
    { label: 'artifacts', value: documents.length, Icon: FileText },
    { label: 'data files', value: dataFiles, Icon: Database },
    { label: 'views', value: totalViews, Icon: Eye },
    { label: 'likes', value: likes, Icon: Heart },
    { label: 'followers', value: followers, Icon: Users },
    { label: 'forks', value: forks, Icon: GitFork },
  ];

  return (
    <section aria-label={expanded ? 'Expanded dashboard content' : 'Dashboard'} className={`min-w-0 ${expanded ? '' : 'reveal lg:sticky lg:top-6'}`}>
      <div className={`mb-4 flex items-baseline justify-between gap-3 border-b border-edge pb-3 ${expanded ? 'pr-10' : ''}`}>
        <MicroLabel>dashboard</MicroLabel>
        <span className="flex items-center gap-2">
          <h1 className={`${expanded ? 'font-mono text-sm text-fg' : 'text-[11px] text-muted'} font-medium tracking-tight`}>Your artifacts</h1>
          {onExpand && (
            <Tooltip content="open dashboard">
              <button
                type="button"
                aria-label="Expand dashboard"
                onClick={onExpand}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] text-faint transition-colors hover:bg-raised hover:text-accent"
              >
                <Maximize2 aria-hidden="true" size={13} strokeWidth={1.7} />
              </button>
            </Tooltip>
          )}
        </span>
      </div>

      <dl
        aria-label={expanded ? 'Expanded dashboard metrics' : 'Dashboard metrics'}
        className={`grid grid-cols-2 border-b border-edge ${expanded ? 'sm:grid-cols-3 lg:grid-cols-6' : ''}`}
      >
        {metrics.map(({ label, value, Icon }, index) => (
          <div
            key={label}
            className={expanded
              ? `group px-4 py-4 ${index % 2 ? 'border-l border-edge' : ''} ${index > 1 ? 'border-t border-edge' : ''} ${index % 3 ? 'sm:border-l' : 'sm:border-l-0'} ${index > 2 ? 'sm:border-t' : 'sm:border-t-0'} ${index > 0 ? 'lg:border-l' : 'lg:border-l-0'} lg:border-t-0`
              : `group py-2.5 ${index % 2 ? 'border-l border-edge pl-3' : 'pr-3'} ${index > 1 ? 'border-t border-edge' : ''}`}
          >
            <dt className={`flex items-center gap-1.5 font-mono uppercase tracking-[0.11em] text-faint ${expanded ? 'text-[10px]' : 'text-[9px]'}`}>
              <Icon aria-hidden="true" className={`${expanded ? 'size-3' : 'size-2.5'} stroke-[1.7] transition-colors group-hover:text-accent`} />
              <span>{label}</span>
            </dt>
            <dd
              title={`${value.toLocaleString('en-US')} ${label}`}
              className={`mt-1.5 font-mono leading-none font-medium tabular-nums text-fg ${expanded ? 'text-2xl' : 'text-lg'}`}
            >
              {compactMetric(value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className={expanded ? 'mt-7' : 'mt-5'}>
        <div className="mb-2.5">
          <h2 className="flex items-center gap-1.5 font-mono text-xs font-semibold text-fg">
            <Activity aria-hidden="true" className="size-3 stroke-[1.8] text-accent" />
            Engagement over time
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[9px] tabular-nums text-faint">
            <span className="inline-flex items-center gap-1"><Eye aria-hidden="true" className="size-2.5" />{periodViews} views</span>
            <span className="inline-flex items-center gap-1"><Heart aria-hidden="true" className="size-2.5" />{periodLikes} likes</span>
            <span>last 30 days</span>
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
            <div className={`flex min-h-0 w-full ${expanded ? 'h-[18rem] sm:h-[26rem]' : 'h-[14.25rem]'}`}>
              <InteractiveVegaChart
                envelope={ENGAGEMENT_ENVELOPE}
                rows={chartRows}
                colorMode={colorMode}
                ariaLabel={expanded ? 'Expanded engagement Vega chart' : 'Engagement Vega chart'}
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

function DashboardDialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const stops = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden p-3 sm:p-8">
      <button
        type="button"
        aria-label="Close expanded dashboard by clicking outside"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-black/50 p-0 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Expanded dashboard"
        className="relative z-10 flex min-w-0 max-w-6xl animate-[rise_.16s_ease-out] flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface shadow-2xl"
        style={{ width: 'calc(100vw - 1.5rem)', maxHeight: 'calc(100svh - 1.5rem)' }}
      >
        <button
          type="button"
          aria-label="Close expanded dashboard"
          autoFocus
          onClick={onClose}
          className="absolute top-4 right-4 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[4px] bg-surface text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <X aria-hidden="true" size={16} />
        </button>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A compact owner-only readout in the homepage rail. Profiles never mount it. */
export default function Dashboard(props: DashboardProps) {
  const [expanded, setExpanded] = useState(false);
  const close = useCallback(() => setExpanded(false), []);
  return (
    <>
      {!expanded && <DashboardContent {...props} onExpand={() => setExpanded(true)} />}
      {expanded && (
        <DashboardDialog onClose={close}>
          <DashboardContent {...props} expanded />
        </DashboardDialog>
      )}
    </>
  );
}
