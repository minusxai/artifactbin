import type { ReactNode } from 'react';
import { ShellFrame } from './Shell';

/** App identity and a quiet skeleton while a destination page's data arrives. */
export function PageLoading(): ReactNode {
  return (
    <ShellFrame hideBreadcrumb pending>
      <main role="status" aria-label="Loading page" aria-busy="true" className="mx-auto w-full max-w-5xl px-4 py-10">
        <span className="sr-only">Loading page…</span>
        <div aria-hidden="true" className="space-y-6">
          <div className="h-7 w-48 max-w-full rounded bg-raised" />
          <div className="space-y-3">
            <div className="h-3 w-full max-w-2xl rounded bg-raised" />
            <div className="h-3 w-3/4 max-w-xl rounded bg-raised" />
            <div className="h-3 w-1/2 max-w-md rounded bg-raised" />
          </div>
        </div>
      </main>
    </ShellFrame>
  );
}
