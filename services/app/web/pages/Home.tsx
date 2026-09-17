import { useCallback, useLayoutEffect } from 'react';
import { clearInitialStory } from '@/web/initial-story';
import { usePageData } from '@/web/use-page-data';
import type { HomeCore, HomeInsights } from '@/web/home-resource';
import ClaimBanner from '@/components/ClaimBanner';
import { DatabasePlus } from 'lucide-react';
import GetStarted from '@/components/GetStarted';
import { Navigate } from 'react-router';
import { ShellFrame } from '@/web/Shell';
import SharedWithYou from '@/components/SharedWithYou';
import Shelf from '@/components/Shelf';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN, WorkspaceSkeleton } from '@/components/WorkspaceLayout';
import { PAGE_COLUMN } from '@/components/ui';
import { useSession } from '@/web/session';

/**
 * THE EMPTY LIBRARY IS THE ONLY PAGE THAT SAYS WHAT TO DO FIRST.
 *
 * Signed in with nothing published, the dashboard used to be one closed strip
 * on an empty column — the page was literally blank under it. It leads with
 * the act instead, keeps the same panel every other surface shows, and then
 * keeps dataset creation and recovery links available.
 */
function FirstArtifact() {
  // The greeting rides the session the chrome already read — a name is worth
  // no second request, and a page that has not learned it yet simply greets
  // nobody rather than flashing a placeholder in.
  const { session } = useSession();
  const name = session?.user?.email?.split('@')[0] ?? '';
  const greeting = `${name ? `hi ${name}, l` : 'l'}et\u2019s create your first artifact!`;
  return (
    <>
      <div className="mb-8 sm:mb-10">
        {/* SERIF STATES, MONO LABELS, SANS EXPLAINS — the landing's rule, and
          * this is the page making a claim in its own words. The accessible
          * name is the line itself: an aria-label that says something else
          * would REPLACE what a screen reader hears. */}
        <h1
          aria-label={greeting}
          className="font-serif text-[clamp(1.6rem,3.4vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg"
        >
          {greeting}
        </h1>
        <p className="mt-1.5 font-sans text-sm text-muted">
          Hand an agent the instruction below along with what artifact you want, and follow along.
        </p>
      </div>
    </>
  );
}

export function HomePage() {
  const { session, reload } = useSession();
  const core = usePageData<HomeCore>('/api/page/home?part=core');
  const insights = usePageData<HomeInsights>('/api/page/home?part=insights', { enabled: !!core.data?.signedIn });
  const load = useCallback(() => { void core.refresh(true); void insights.refresh(true); }, [core.refresh, insights.refresh]);
  const wrongAccount = (core.data?.signedIn && core.data.accountId !== session?.user?.id)
    || (insights.data && (!insights.data.signedIn || insights.data.accountId !== session?.user?.id));
  const state = { core: wrongAccount ? null : core.data, insights: wrongAccount ? null : insights.data, error: wrongAccount ? new Error('Account changed') : core.error, insightsError: !!insights.error };
  const home = state.core;
  useLayoutEffect(() => { clearInitialStory(); }, []);
  if ((session && session.kind !== 'account') || (home && !home.signedIn)) return <Navigate to="/login" replace />;
  if (!home) return <ShellFrame><main className={`${HOME_WORKSPACE_COLUMN} mt-8 pb-24`}>
    {state.error ? <div role="alert"><p>Could not load your workspace.</p><button aria-label="Retry workspace" onClick={session ? load : reload}>Try again</button></div> : <WorkspaceSkeleton />}
  </main></ShellFrame>;
  const empty = home.artifacts.length === 0 && home.shared.length === 0 && !state.insights?.stats?.assets;
  return (
    <ShellFrame><main className={`${empty ? PAGE_COLUMN : HOME_WORKSPACE_COLUMN} mt-8 pb-24`}>
      {empty ? (
        <>
          <FirstArtifact />
          <div className="mb-6"><GetStarted /></div>
        </>
      ) : null}
      {/* Kept outside the empty/full branch so a successful claim can report
        * its result while the page refreshes into the dashboard. */}
      <ClaimBanner />
      {state.error && <div role="alert">Could not refresh your workspace. <button aria-label="Retry workspace" onClick={load}>Try again</button></div>}
      {empty && <div className="mb-4 flex justify-end"><a href="/datasets/new" aria-label="Create dataset" className="inline-flex items-center gap-1.5 rounded border border-edge-bright px-3 py-1.5 font-mono text-xs text-accent hover:border-accent"><DatabasePlus aria-hidden="true" size={13} strokeWidth={1.75} />Create dataset</a></div>}
      {!empty && (
        <WorkspaceLayout workspace={home} insights={state.insights} insightsError={state.insightsError} onCreated={load}>
          {home.artifacts.length > 0 && <Shelf actions="full" assets={false} scopeParentId={null} rows={home.artifacts.map((row) => ({ ...row, views: state.insights?.views?.[row.id], sparkline: state.insights?.sparklines[row.id] ?? null })) as never} />}
          <SharedWithYou items={home.shared} />
        </WorkspaceLayout>
      )}
      {/* A bare account has no right rail, but it may already follow people
        * and it may have just emptied itself into Trash. Keep both recovery
        * surfaces reachable until the workspace—and its rail—exists. */}
      {empty && (
        <>
          <p className="mt-8">
            <a
              href="/trash"
              aria-label="Trash"
              className="font-mono text-[10px] text-faint no-underline transition-colors hover:text-accent"
            >
              trash
            </a>
          </p>
        </>
      )}
    </main></ShellFrame>
  );
}
