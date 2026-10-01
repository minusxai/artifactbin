/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import type { AccountWorkspace, AccountWorkspaceCore, AccountWorkspaceInsights } from '@/lib/workspace/dashboard';
import WorkspaceCreate from './WorkspaceCreate';
import Dashboard from './Dashboard';

export const HOME_WORKSPACE_COLUMN = 'mx-auto max-w-[80rem] px-4 sm:px-6';

export function WorkspaceSkeleton(): JSX.Element {
  return <div aria-label="Loading workspace" role="status" aria-busy="true" class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_18rem] motion-safe:animate-pulse"><span class="sr-only">Loading workspace</span><div aria-hidden="true"><div class="mb-6 h-9 w-40 rounded bg-surface" /><div class="grid grid-cols-2 gap-6 sm:grid-cols-3"><div class="h-44 rounded border border-edge bg-surface" /></div></div><div aria-hidden="true" class="hidden border-l border-edge pl-6 lg:block"><div class="h-10 rounded bg-surface" /><div class="mt-12 h-80 rounded border border-edge bg-surface" /></div></div>;
}

export default function WorkspaceLayout(props: { workspace: AccountWorkspace | AccountWorkspaceCore; insights?: AccountWorkspaceInsights | null; insightsError?: boolean; parentId?: string | null; label?: string; onCreated: () => void; children: JSX.Element }): JSX.Element {
  const loaded = () => props.insights === undefined && 'viewsOverTime' in props.workspace ? props.workspace : props.insights;
  return <div aria-label={props.label ?? 'Home workspace'} class="grid gap-y-3 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-x-10 lg:gap-y-0 xl:grid-cols-[minmax(0,1fr)_18rem]">
    <div class="lg:col-start-2 lg:row-start-1 lg:pl-6"><WorkspaceCreate parentId={props.parentId} onCreated={props.onCreated} /></div>
    <div class="min-w-0 lg:col-start-1 lg:row-start-1">{props.children}</div>
    <aside aria-label="Dashboard rail" class="min-w-0 border-t border-edge pt-6 lg:col-start-2 lg:row-start-1 lg:border-t-0 lg:border-l lg:pt-24 lg:pl-6">
      <Show when={loaded()} fallback={<Show when={props.insightsError} fallback={<div aria-label="Loading workspace insights" role="status" aria-busy="true" class="min-h-80 motion-safe:animate-pulse"><span class="sr-only">Loading workspace insights</span><div class="h-32 rounded border border-edge bg-surface" /><div class="mt-6 h-40 rounded border border-edge bg-surface" /></div>}><div role="alert">Could not load workspace insights. <button type="button" aria-label="Retry workspace insights" onClick={props.onCreated}>Try again</button></div></Show>}>
        {insights => <Dashboard rows={props.workspace.artifacts.map(row => ({ ...row, views: insights().views?.[row.id] ?? ('views' in row ? row.views : 0) }))} stats={insights().stats} viewsOverTime={insights().viewsOverTime} likes={insights().likes} likesOverTime={insights().likesOverTime} followers={insights().followers} forks={insights().forks} />}
      </Show>
    </aside>
  </div>;
}
