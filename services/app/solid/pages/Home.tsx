import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, onMount, Show, type JSX } from 'solid-js';
import type { AccountPreferences, DeploymentState } from '@artifactbin/contracts';
import { GroupPage } from './Group';
import { CompanySetup } from './CompanySetup';
import { apiRequest } from '../lib/api';
import { useLocation } from '@solidjs/router';
import { Navigate } from '@solidjs/router';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import type { HomeCore, HomeInsights } from '@/solid/lib/home-resource';
import { dropServedFrame } from '@/solid/lib/served-frame';
import WorkspaceShell from '../components/WorkspaceShell';
import GetStarted from '../components/GetStarted';
import ClaimBanner from '../components/ClaimBanner';
import SharedWithYou from '../components/SharedWithYou';
import Shelf from '../components/Shelf';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN, WorkspaceSkeleton } from '../components/WorkspaceLayout';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';

export function HomePage(): JSX.Element {
 const {session,sessionError,reload}=useSession(); const location=useLocation();
 const core=usePageData<HomeCore>('/api/page/home?part=core');
 createEffect(()=>{if(sessionError())core.invalidate();});
 const deployment=usePageData<DeploymentState>('/api/deployment');
 const preferences=usePageData<AccountPreferences>('/api/me/preferences',{enabled:()=>session()?.kind==='account'});
 const personal=()=>new URLSearchParams(location.search).get('personal')==='1';
 const destination=()=>{const value=preferences.data()?.default_destination;return value?.type==='group'?value.id:value?.type==='personal'?null:deployment.data()?.default_group?.id;};
 const [error,setError]=createSignal('');
 const reset=async()=>{try{await apiRequest('/api/me/preferences','PUT',{default_destination:{type:'personal'}});await preferences.refresh(true);}catch(err){setError(err instanceof Error?err.message:'Could not change Home.');}};
 return <Show when={deployment.data()} fallback={<main class="p-8"><Show when={deployment.error()} fallback={<WorkspaceSkeleton/>}><p role="alert">Could not load workspace. <button type="button" aria-label={sessionError()?'Retry workspace':'Retry deployment'} onClick={()=>sessionError()?reload():void deployment.refresh(true)}>Retry</button></p></Show></main>}>
 {state=><Show when={personal()||state().mode!=='company'||state().setup_complete} fallback={<Show when={state().is_owner} fallback={<main class="p-8"><p role="alert">The company default group is unavailable. Your deployment owner can repair setup.</p><a href="/?personal=1">Open Personal</a></main>}><CompanySetup deployment={state()} complete={()=>void deployment.refresh(true)}/></Show>}>
 <Show when={personal()||(session()&&session()?.kind!=='account')||preferences.data()} fallback={<main class="p-8"><Show when={preferences.error()} fallback={<p role="status">Loading Home preference…</p>}><p role="alert">Could not load your Home preference.</p><a href="/?personal=1">Open Personal</a><button onClick={()=>void preferences.refresh(true)}>Retry preference</button></Show></main>}>
 <Show when={!personal()&&destination()} fallback={<><Show when={personal()}><div class="px-6 pt-4"><a href="/">Default Home</a><button class="ml-4" onClick={()=>void reset()}>Use Personal as Home</button><Show when={error()}><p role="alert">{error()}</p></Show></div></Show><PersonalHomePage core={core}/></>}>{identity=><GroupPage identity={identity()}/>}</Show>
 </Show></Show>}
 </Show>;
}

function PersonalHomePage(props:{core:ReturnType<typeof usePageData<HomeCore>>}): JSX.Element {
  const { session, sessionError, reload } = useSession();
  // "My artifacts"'s own search box (Shelf) also narrows "Shared with you" below it, the way one
  // search box on a page reads as one search to whoever is typing into it.
  const [sharedQuery, setSharedQuery] = createSignal('');
  const core = props.core;
  const insights = usePageData<HomeInsights>('/api/page/home?part=insights', { enabled: () => Boolean(core.data()?.signedIn) });
  createEffect(() => { if (sessionError()) { core.invalidate(); insights.invalidate(); } });
  const load = () => { void core.refresh(true); void insights.refresh(true); };
  const wrongAccount = createMemo(() => {
    const current = session(); const home = core.data(); const detail = insights.data();
    return Boolean(home?.signedIn && home.accountId !== current?.user?.id) || Boolean(detail && (!detail.signedIn || detail.accountId !== current?.user?.id));
  });
  const home = () => wrongAccount() ? null : core.data();
  const account = () => { const value = home(); return value?.signedIn ? value : null; };
  const detail = () => wrongAccount() ? null : insights.data();
  const empty = () => Boolean(account() && account()!.artifacts.length === 0 && account()!.shared.length === 0 && !detail()?.stats?.assets);
  const failed = () => wrongAccount() || Boolean(core.error());
  const greeting = () => { const name = session()?.user?.email?.split('@')[0] ?? ''; return `${name ? `hi ${name}, l` : 'l'}et’s create your first artifact!`; };
  onMount(dropServedFrame);
  return <Show when={!(session() && session()!.kind !== 'account') && !(home() && !home()!.signedIn)} fallback={<Navigate href="/login" />}>
    <Show when={account()} fallback={<main class={`${HOME_WORKSPACE_COLUMN} mt-8 pb-24`}><Show when={failed()} fallback={<WorkspaceSkeleton />}><div role="alert"><p>Could not load your workspace.</p><button type="button" aria-label="Retry workspace" onClick={session() ? load : reload}>Try again</button></div></Show></main>}>
      {workspace => <main class={HOME_WORKSPACE_COLUMN}>
        <Show when={empty()}><WorkspaceShell personal onCreated={load}><div class="workspace-page"><div class="mb-8 sm:mb-10"><h1 aria-label={greeting()} class="font-serif text-[clamp(1.6rem,3.4vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg">{greeting()}</h1><p class="mt-1.5 font-sans text-sm text-muted">Hand an agent the instruction below along with what artifact you want, and follow along.</p></div><div class="mb-6"><GetStarted destination={{type:'personal'}} /></div><a href="/datasets/new?personal=1" aria-label="Create dataset" class="inline-flex items-center gap-2 text-accent"><DatabasePlus size={15} />Create dataset</a></div></WorkspaceShell></Show>
        <ClaimBanner />
        <Show when={failed()}><div role="alert">Could not refresh your workspace. <button type="button" aria-label="Retry workspace" onClick={load}>Try again</button></div></Show>
        <Show when={!empty()}><WorkspaceLayout personal workspace={workspace()} insights={detail()} insightsError={Boolean(insights.error())} onCreated={load}>
          <WorkspaceHeading title="Artifacts"><span class="workspace-heading-meta">{workspace().artifacts.filter(row => row.format === 'markup').length} artifacts</span></WorkspaceHeading>
          <Show when={workspace().artifacts.length}><Shelf rows={workspace().artifacts} actions="full" assets={false} scopeParentId={null} onQuery={setSharedQuery} /></Show>
          <SharedWithYou items={workspace().shared} query={sharedQuery()} />
        </WorkspaceLayout></Show>
      </main>}
    </Show>
  </Show>;
}
