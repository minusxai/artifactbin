/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import Activity from 'lucide-solid/icons/activity';
import Database from 'lucide-solid/icons/database';
import Eye from 'lucide-solid/icons/eye';
import FileText from 'lucide-solid/icons/file-text';
import GitFork from 'lucide-solid/icons/git-fork';
import Heart from 'lucide-solid/icons/heart';
import LayoutDashboard from 'lucide-solid/icons/layout-dashboard';
import Users from 'lucide-solid/icons/users';
import type { WorkspaceStats } from '@/lib/workspace/inventory';
import { formatCount } from '../lib/format';

interface DashboardRow { format: string; views?: number | null }
interface Props {
  rows: DashboardRow[];
  stats?: WorkspaceStats;
  viewsOverTime?: number[];
  likes?: number;
  likesOverTime?: number[];
  followers?: number;
  forks?: number;
}

const compactMetric = (value: number): string => {
  const compact = (amount: number, suffix: string) => {
    const truncated = Math.floor(amount * 10) / 10;
    return `${Number.isInteger(truncated) ? truncated.toFixed(0) : truncated.toFixed(1)}${suffix}`;
  };
  if (value >= 1_000_000) return compact(value / 1_000_000, 'm');
  if (value >= 1_000) return compact(value / 1_000, 'k');
  return formatCount(value);
};

/** The account readout travels unchanged between Home and owned folders. */
export default function Dashboard(props: Props): JSX.Element {
  const [focus, setFocus] = createSignal<'views' | 'likes' | null>(null);
  const views = () => props.viewsOverTime ?? [];
  const likes = () => props.likesOverTime ?? [];
  const periodViews = createMemo(() => views().reduce((sum, value) => sum + value, 0));
  const periodLikes = createMemo(() => likes().reduce((sum, value) => sum + value, 0));
  const metrics = createMemo(() => [
    { label: 'artifacts', value: props.stats?.artifacts ?? props.rows.filter(row => row.format === 'markup').length, Icon: FileText },
    { label: 'assets', value: props.stats?.assets ?? props.rows.filter(row => row.format !== 'markup' && row.format !== 'folder').length, Icon: Database },
    { label: 'views', value: props.stats?.views ?? props.rows.filter(row => row.format === 'markup').reduce((sum, row) => sum + (row.views ?? 0), 0), Icon: Eye },
    { label: 'likes', value: props.likes ?? 0, Icon: Heart },
    { label: 'followers', value: props.followers ?? 0, Icon: Users },
    { label: 'forks', value: props.forks ?? 0, Icon: GitFork },
  ]);
  const max = createMemo(() => Math.max(1, ...views(), ...likes()));
  const points = (values: number[]) => {
    const days = Math.max(views().length, likes().length, 2);
    return Array.from({ length: days }, (_, index) => {
      const value = values[index - (days - values.length)] ?? 0;
      return `${(index / (days - 1)) * 240},${130 - (value / max()) * 115}`;
    }).join(' ');
  };
  return <section aria-label="Dashboard" class="min-w-0 reveal">
    <div class="mb-4 flex items-center justify-between gap-3 border-b border-edge pb-3"><h1 class="flex items-center gap-1.5 font-mono text-xs font-semibold text-fg"><LayoutDashboard size={12} class="text-accent" />Dashboard</h1></div>
    <dl aria-label="Dashboard metrics" class="grid grid-cols-2 border-b border-edge">
      <For each={metrics()}>{({ label, value, Icon }, index) => <div class={`group py-2.5 ${index() % 2 ? 'border-l border-edge pl-3' : 'pr-3'} ${index() > 1 ? 'border-t border-edge' : ''}`}>
        <dt class="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.11em] text-faint"><Icon size={10} class="transition-colors group-hover:text-accent" /><span>{label}</span></dt>
        <dd title={`${formatCount(value)} ${label}`} class="mt-1.5 font-mono text-lg leading-none font-medium tabular-nums text-fg">{compactMetric(value)}</dd>
      </div>}</For>
    </dl>
    <div class="mt-5"><div class="mb-2.5"><h2 class="flex items-center gap-1.5 font-mono text-xs font-semibold text-fg"><Activity size={12} class="text-accent" />Engagement over time</h2>
      <p class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[9px] tabular-nums text-faint"><span>{periodViews()} views</span><span>{periodLikes()} likes</span><span>last 30 days</span></p></div>
      <Show when={periodViews() + periodLikes() > 0} fallback={<div class="flex h-36 items-end border-b border-edge pb-3"><p class="font-mono text-[11px] text-faint">No engagement in the last 30 days.</p></div>}>
        <div role="group" aria-label={`Interactive engagement chart: ${periodViews()} views and ${periodLikes()} likes in the last 30 days`}>
          <div class="flex gap-3 font-mono text-[9px]"><button type="button" aria-label="Focus views" aria-pressed={focus() === 'views'} onClick={() => setFocus(focus() === 'views' ? null : 'views')} class="text-accent">views</button><button type="button" aria-label="Focus likes" aria-pressed={focus() === 'likes'} onClick={() => setFocus(focus() === 'likes' ? null : 'likes')} class="text-muted">likes</button></div>
          <svg aria-label="Engagement Vega chart" role="img" viewBox="0 0 240 140" preserveAspectRatio="none" class="h-[14.25rem] w-full border-b border-edge" onDblClick={() => setFocus(null)}>
            <polyline points={points(views())} fill="none" stroke="var(--color-accent)" stroke-width="2" opacity={focus() === 'likes' ? 0.18 : 1} onClick={() => setFocus(focus() === 'views' ? null : 'views')} class="cursor-pointer" />
            <polyline points={points(likes())} fill="none" stroke="var(--color-muted)" stroke-width="2" opacity={focus() === 'views' ? 0.18 : 1} onClick={() => setFocus(focus() === 'likes' ? null : 'likes')} class="cursor-pointer" />
          </svg>
          <p class="mt-1 font-mono text-[8px] leading-relaxed text-faint">click a line or legend to focus · double-click to reset</p>
        </div>
      </Show>
    </div>
  </section>;
}
