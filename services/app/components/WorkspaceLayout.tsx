'use client';

import type { ReactNode } from 'react';
import { ActivityFeed } from '@/components/ActivityFeed';
import Dashboard from '@/components/Dashboard';
import WorkspaceCreate from '@/components/WorkspaceCreate';
import type { AccountWorkspace } from '@/lib/workspace';

export const HOME_WORKSPACE_COLUMN = 'mx-auto max-w-[80rem] px-4 sm:px-6';

/** The shared Home geometry: working shelf left, account context right. */
export default function WorkspaceLayout({
  workspace,
  onCreated,
  parentId = null,
  label = 'Home workspace',
  children,
}: {
  workspace: AccountWorkspace;
  onCreated: () => void;
  parentId?: string | null;
  label?: string;
  children: ReactNode;
}) {
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
          <Dashboard
            rows={workspace.artifacts as never}
            viewsOverTime={workspace.viewsOverTime}
            likes={workspace.likes}
            likesOverTime={workspace.likesOverTime}
            followers={workspace.followers}
            forks={workspace.forks}
          />
          <ActivityFeed compact mine={workspace.feed?.mine ?? []} following={workspace.feed?.following ?? []} />
        </div>
      </aside>
    </div>
  );
}
