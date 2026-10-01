/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import Activity from 'lucide-solid/icons/activity';
import Database from 'lucide-solid/icons/database';
import Eye from 'lucide-solid/icons/eye';
import FileText from 'lucide-solid/icons/file-text';
import GitFork from 'lucide-solid/icons/git-fork';
import Heart from 'lucide-solid/icons/heart';
import LayoutDashboard from 'lucide-solid/icons/layout-dashboard';
import Maximize2 from 'lucide-solid/icons/maximize-2';
import Users from 'lucide-solid/icons/users';
import X from 'lucide-solid/icons/x';
import type { WorkspaceStats } from '@/lib/workspace/inventory';
import { DialogShell } from '@/solid/components/DialogShell';
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
  expanded?: boolean;
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
  const [expanded, setExpanded] = createSignal(false);
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
  return <><Show when={!expanded() || props.expanded}><section aria-label={props.expanded ? 'Expanded dashboard content' : 'Dashboard'} class="min-w-0 reveal">
    <div class="mb-4 flex items-center justify-between gap-3 border-b border-edge pb-3"><h1 class="flex items-center gap-1.5 font-mono text-xs font-semibold text-fg"><LayoutDashboard size={12} class="text-accent" />Dashboard</h1><Show when={!props.expanded}><button type="button" aria-label="Expand dashboard" onClick={() => setExpanded(true)} class="text-faint hover:text-accent"><Maximize2 size={13} /></button></Show></div>
    <dl aria-label={props.expanded ? 'Expanded dashboard metrics' : 'Dashboard metrics'} class={`grid grid-cols-2 border-b border-edge ${props.expanded ? 'sm:grid-cols-3 lg:grid-cols-6' : ''}`}>
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
  </section></Show>
  <Show when={expanded() && !props.expanded}><Portal mount={document.body}><DialogShell onClose={() => setExpanded(false)}><div class="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden p-3 sm:p-8"><button type="button" aria-label="Close expanded dashboard by clicking outside" onClick={() => setExpanded(false)} class="absolute inset-0 cursor-default border-0 bg-black/50 p-0 backdrop-blur-[2px]" /><div role="dialog" aria-modal="true" aria-label="Expanded dashboard" class="relative z-10 flex min-w-0 max-w-6xl flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface shadow-2xl" style={{ width: 'calc(100vw - 1.5rem)', 'max-height': 'calc(100svh - 1.5rem)' }}><button type="button" aria-label="Close expanded dashboard" autofocus onClick={() => setExpanded(false)} class="absolute top-4 right-4 z-10 bg-surface text-muted hover:text-fg"><X size={16} /></button><div class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-8 sm:py-7"><Dashboard {...props} expanded /></div></div></div></DialogShell></Portal></Show></>;
}
