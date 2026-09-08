import { useCallback, useEffect, useRef, useState } from 'react';
import {pageJson} from '../page-data';
import {invalidateBootstrap,pageBootstrap} from '../bootstrap';
import {PageStatus} from '../PageStatus';
import { useRefreshable } from '@/lib/navigation';
import { ActivityFeed } from '@/components/ActivityFeed';
import ClaimBanner from '@/components/ClaimBanner';
import GetStarted from '@/components/GetStarted';
import Landing from '@/components/Landing';
import LoginForm from '@/components/LoginForm';
import SharedWithYou from '@/components/SharedWithYou';
import Shelf from '@/components/Shelf';
import UseCarousel from '@/components/UseCarousel';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN } from '@/components/WorkspaceLayout';
import type { AccountWorkspace } from '@/lib/workspace';
import { PAGE_COLUMN } from '@/components/ui';
import { useSession,type SessionState } from '@/web/session';

export type Home =
  | { signedIn: false; drafts?: Parameters<typeof Shelf>[0]['rows'] }
  | ({ signedIn: true } & AccountWorkspace);

export interface HomeViewProps {home:Home;session:SessionState|null;region?:boolean;onReload?:()=>void}
/** One resolved route body for server presentation and the live client. */

/**
 * THE EMPTY LIBRARY IS THE ONLY PAGE THAT SAYS WHAT TO DO FIRST.
 *
 * Signed in with nothing published, the dashboard used to be one closed strip
 * on an empty column — the page was literally blank under it. It leads with
 * the act instead, keeps the same panel every other surface shows, and then
 * borrows other people's documents as the proof of what to ask for, since
 * there is nothing of the reader's own to look at yet.
 */
function FirstArtifact({session}: {session:SessionState|null}) {
  // The greeting rides the session the chrome already read — a name is worth
  // no second request, and a page that has not learned it yet simply greets
  // nobody rather than flashing a placeholder in.
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

export function HomePage({region=false,onPresentation}:{region?:boolean;onPresentation?:(workspace:boolean)=>void}={}) {
  const {session,error:sessionError,reload} = useSession();
  const identity = session?.user?.id ?? session?.kind ?? 'pending';
  const [state,setState] = useState<{identity:string;home:Home|null}>(()=>({identity,home:pageBootstrap('/')?.home as Home ?? null}));
  const [error,setError] = useState<string|null>(null);
  const request=useRef<AbortController|null>(null);
  const home=state.identity===identity?state.home:null;
  const load = useCallback(() => {
    // Startup data belongs to this first committed presentation, not later visits.
    invalidateBootstrap();
    request.current?.abort();const pending=new AbortController();request.current=pending;setError(null);
    void pageJson<Home>('/api/page/home',pending.signal).then(next=>{
      if (typeof next.signedIn !== 'boolean') throw new Error('Could not load your workspace. Please retry.');
      if (!pending.signal.aborted) setState({identity,home:next});
    }).catch(cause=>{if(!pending.signal.aborted)setError(cause.message);});
  }, [identity]);
  useEffect(()=>{load();return()=>request.current?.abort();},[load]);
  // A claim adds artifacts to this library; re-read rather than reload.
  useRefreshable(load);
  useEffect(()=>{if(home)onPresentation?.(home.signedIn || !!home.drafts?.length);},[home,onPresentation]);
  if (sessionError) return <PageStatus label="workspace" error={sessionError} retry={()=>void reload()}/>;
  if (!home) {
    if (session?.kind==='none') return region?<GetStarted/>:<Landing/>;
    return <PageStatus label="workspace" error={error} retry={load}/>;
  }
  if (error) return <PageStatus label="workspace" error={error} retry={load}/>;
  return <HomeView home={home} session={session} region={region} onReload={load}/>;
}

export function HomeView({home,session,region=false,onReload=()=>{}}:HomeViewProps) {
  if (!home.signedIn) {
    if (home.drafts?.length) {
      return (
        <main className={`${PAGE_COLUMN} mt-8 pb-24`}>
          <div className="mb-6 flex flex-wrap items-baseline justify-start gap-x-4 gap-y-1">
            <h1 className="font-mono text-sm tracking-[0.14em] text-fg uppercase">Drafts held by this browser · </h1>
            <a className="font-sans text-sm text-accent underline underline-offset-2" href="/login">Log in to keep them</a>
          </div>
          <Shelf actions="full" rows={home.drafts} />
          <div className="mt-8"><GetStarted /></div>
          {/* Keeping the drafts is the second act, so it follows the panel
            * rather than competing with it. */}
          <div className="reveal mt-3 rounded-[6px] border border-edge bg-surface px-4 pt-4 pb-4">
            <h2 className="mb-2.5 font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Log in</h2>
            <LoginForm />
          </div>
        </main>
      );
    }
    // A stranger has nothing to log into yet: the landing proves the product
    // and hands over the instruction; the page menu keeps the login door.
    return region?<GetStarted/>:<Landing />;
  }
  const empty = home.artifacts.length === 0 && home.shared.length === 0;
  return (
    <main className={`${empty ? PAGE_COLUMN : HOME_WORKSPACE_COLUMN} mt-8 pb-24`}>
      {empty ? (
        <>
          <FirstArtifact session={session}/>
          <div className="mb-6"><GetStarted /></div>
        </>
      ) : null}
      {/* Kept outside the empty/full branch so a successful claim can report
        * its result while the page refreshes into the dashboard. */}
      <ClaimBanner />
      {empty && <div className="mb-4 flex justify-end"><a href="/datasets/new" aria-label="Create dataset" className="rounded border border-edge-bright px-3 py-1.5 font-mono text-xs text-accent hover:border-accent">Create dataset</a></div>}
      {empty ? (
        /* Inspiration, not decoration: an empty library has no examples of its
         * own, so these are the real published documents from the landing —
         * under this page's own name, and without the landing's wheel of use
         * phrases, which sells a product this reader has already signed into. */
        <div className="mt-10 sm:mt-12">
          <UseCarousel label="Inspiration Zone" wheel={false} />
        </div>
      ) : (
        <WorkspaceLayout workspace={home} onCreated={onReload}>
          {home.artifacts.length > 0 && <Shelf actions="full" assets={false} scopeParentId={null} rows={home.artifacts as never} />}
          <SharedWithYou items={home.shared} />
        </WorkspaceLayout>
      )}
      {/* A bare account has no right rail, but it may already follow people
        * and it may have just emptied itself into Trash. Keep both recovery
        * surfaces reachable until the workspace—and its rail—exists. */}
      {empty && (
        <>
          <ActivityFeed mine={home.feed?.mine ?? []} following={home.feed?.following ?? []} />
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
    </main>
  );
}
