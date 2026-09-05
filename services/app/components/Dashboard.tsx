import { MicroLabel } from '@/components/ui';
import type { ShelfRow } from '@/components/Shelf';

const CHART_WIDTH = 720;
const CHART_TOP = 6;
const CHART_HEIGHT = 168;
const CHART_BOTTOM = 162;

/** A compact owner-only readout in the homepage rail. Profiles never mount it. */
export default function Dashboard({ rows, viewsOverTime = [] }: { rows: ShelfRow[]; viewsOverTime?: number[] }) {
  const totalViews = rows.reduce((sum, row) => sum + (row.views ?? 0), 0);
  const publicArtifacts = rows.filter((row) => row.visibility === 'public').length;
  const notListed = rows.length - publicArtifacts;
  const periodViews = viewsOverTime.reduce((sum, views) => sum + views, 0);
  const maxViews = Math.max(1, ...viewsOverTime);
  const points = viewsOverTime.map((views, index) => {
    const x = viewsOverTime.length < 2 ? CHART_WIDTH / 2 : (index / (viewsOverTime.length - 1)) * CHART_WIDTH;
    const y = CHART_BOTTOM - (views / maxViews) * (CHART_BOTTOM - CHART_TOP);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const area = points ? `M 0 ${CHART_BOTTOM} L ${points.replaceAll(' ', ' L ')} L ${CHART_WIDTH} ${CHART_BOTTOM} Z` : '';

  return (
    <section aria-label="Dashboard" className="reveal lg:sticky lg:top-6">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-edge pb-3">
        <MicroLabel>dashboard</MicroLabel>
        <h1 className="text-[11px] font-medium tracking-tight text-muted">Your artifacts</h1>
      </div>

      <dl className="grid grid-cols-2 border-b border-edge">
        {[
          ['artifacts', rows.length],
          ['public', publicArtifacts],
          ['not listed', notListed],
          ['views', totalViews],
        ].map(([label, value], index) => (
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
        <div className="mb-3">
          <h2 className="font-mono text-xs font-semibold text-fg">Views over time</h2>
          <p className="mt-1 font-mono text-[10px] tabular-nums text-faint">{periodViews} in the last 30 days</p>
        </div>
        {periodViews === 0 ? (
          <div className="flex h-36 items-end border-b border-edge pb-3">
            <p className="font-mono text-[11px] text-faint">No views in the last 30 days.</p>
          </div>
        ) : (
          <div role="img" aria-label={`Views over the last 30 days: ${periodViews}`}>
            <svg className="h-36 w-full overflow-visible text-accent" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2={CHART_WIDTH} y1={CHART_BOTTOM} y2={CHART_BOTTOM} stroke="currentColor" strokeOpacity="0.18" vectorEffect="non-scaling-stroke" />
              <path d={area} fill="currentColor" fillOpacity="0.09" />
              <polyline
                className="dashboard-trend-line"
                points={points}
                pathLength="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        )}
        <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-faint" aria-hidden="true">
          <span>30 days ago</span>
          <span>today</span>
        </div>
      </div>
    </section>
  );
}
