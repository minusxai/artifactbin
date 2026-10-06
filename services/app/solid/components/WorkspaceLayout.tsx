/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import type { AccountWorkspace, AccountWorkspaceCore, AccountWorkspaceInsights } from '@/lib/workspace/dashboard';
import WorkspaceShell from './WorkspaceShell';
import Dashboard from './Dashboard';

export const HOME_WORKSPACE_COLUMN = 'workspace-home';

export function WorkspaceSkeleton(): JSX.Element {
  return <div aria-label="Loading workspace" role="status" aria-busy="true" class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_18rem] motion-safe:animate-pulse"><span class="sr-only">Loading workspace</span><div aria-hidden="true"><div class="mb-6 h-9 w-40 rounded bg-surface" /><div class="grid grid-cols-2 gap-6 sm:grid-cols-3"><div class="h-44 rounded border border-edge bg-surface" /></div></div><div aria-hidden="true" class="hidden border-l border-edge pl-6 lg:block"><div class="h-10 rounded bg-surface" /><div class="mt-12 h-80 rounded border border-edge bg-surface" /></div></div>;
}

export default function WorkspaceLayout(props: { workspace: AccountWorkspace | AccountWorkspaceCore; insights?: AccountWorkspaceInsights | null; insightsError?: boolean; parentId?: string | null; label?: string; onCreated: () => void; children: JSX.Element }): JSX.Element {
  const loaded = () => props.insights === undefined && 'viewsOverTime' in props.workspace ? props.workspace : props.insights;
  return <WorkspaceShell parentId={props.parentId} onCreated={props.onCreated}><div aria-label={props.label ?? 'Home workspace'} class="workspace-layout">
    <div class="workspace-page workspace-library">{props.children}</div>
    <aside aria-label="Dashboard rail" class="workspace-stats">
      <Show when={loaded()} fallback={<Show when={props.insightsError} fallback={<div aria-label="Loading workspace insights" role="status" aria-busy="true" class="min-h-80 motion-safe:animate-pulse"><span class="sr-only">Loading workspace insights</span><div class="h-32 rounded border border-edge bg-surface" /><div class="mt-6 h-40 rounded border border-edge bg-surface" /></div>}><div role="alert">Could not load workspace insights. <button type="button" aria-label="Retry workspace insights" onClick={props.onCreated}>Try again</button></div></Show>}>
        {insights => <Dashboard rows={props.workspace.artifacts.map(row => ({ ...row, views: insights().views?.[row.id] ?? ('views' in row ? row.views : 0) }))} stats={insights().stats} viewsOverTime={insights().viewsOverTime} likes={insights().likes} likesOverTime={insights().likesOverTime} followers={insights().followers} forks={insights().forks} />}
      </Show>
    </aside>
  </div></WorkspaceShell>;
}
