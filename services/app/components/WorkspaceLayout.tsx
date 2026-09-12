'use client';

import type { ReactNode } from 'react';
import { ActivityFeed } from '@/components/ActivityFeed';
import Dashboard from '@/components/Dashboard';
import WorkspaceCreate from '@/components/WorkspaceCreate';
import type { AccountWorkspace, AccountWorkspaceCore, AccountWorkspaceInsights } from '@/lib/workspace';

export const HOME_WORKSPACE_COLUMN = 'mx-auto max-w-[80rem] px-4 sm:px-6';

/** The shared Home geometry: working shelf left, account context right. */
export default function WorkspaceLayout({
  workspace,
  onCreated,
  parentId = null,
  label = 'Home workspace',
  children,
  insights,
  insightsError = false,
}: {
  workspace: AccountWorkspace | AccountWorkspaceCore;
  insights?: AccountWorkspaceInsights | null;
  insightsError?: boolean;
  onCreated: () => void;
  parentId?: string | null;
  label?: string;
  children: ReactNode;
}) {
  const loaded = insights === undefined && 'viewsOverTime' in workspace ? workspace : insights;
  return (
    <div aria-label={label} className="grid gap-y-3 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-x-10 lg:gap-y-0 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="lg:col-start-2 lg:row-start-1 lg:pl-6">
        <WorkspaceCreate parentId={parentId} onCreated={onCreated} />
      </div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        {children}
      </div>
      <aside aria-label="Dashboard rail" className="min-w-0 border-t border-edge pt-6 lg:col-start-2 lg:row-start-1 lg:border-t-0 lg:border-l lg:pt-24 lg:pl-6">
        <div className="lg:sticky lg:top-6">
          {loaded ? <><Dashboard
            rows={workspace.artifacts.map(row => ({ ...row, views: loaded.views?.[row.id] ?? ('views' in row ? row.views : 0) })) as never}
            viewsOverTime={loaded.viewsOverTime}
            likes={loaded.likes}
            likesOverTime={loaded.likesOverTime}
            followers={loaded.followers}
            forks={loaded.forks}
          />
          <ActivityFeed compact mine={loaded.feed?.mine ?? []} following={loaded.feed?.following ?? []} /></>
            : insightsError ? <div role="alert"><p>Could not load workspace insights.</p><button aria-label="Retry workspace insights" onClick={onCreated}>Try again</button></div>
              : <div aria-label="Loading workspace insights" role="status" aria-busy="true" className="min-h-80 motion-safe:animate-pulse"><span className="sr-only">Loading workspace insights</span><div className="h-32 rounded border border-edge bg-surface" /><div className="mt-6 h-40 rounded border border-edge bg-surface" /></div>}
        </div>
      </aside>
    </div>
  );
}

export function WorkspaceSkeleton() {
  return <div aria-label="Loading workspace" role="status" aria-busy="true" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_18rem] motion-safe:animate-pulse">
    <span className="sr-only">Loading workspace</span>
    <div aria-hidden="true"><div className="mb-6 h-9 w-40 rounded bg-surface" /><div className="grid grid-cols-2 gap-6 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-44 rounded border border-edge bg-surface" />)}</div></div>
    <div aria-hidden="true" className="hidden border-l border-edge pl-6 lg:block"><div className="h-10 rounded bg-surface" /><div className="mt-12 h-80 rounded border border-edge bg-surface" /></div>
  </div>;
}
