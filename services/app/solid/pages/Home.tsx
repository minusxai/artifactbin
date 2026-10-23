import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { Button } from '../ui/Button';
import { createEffect, createMemo, createSignal, onMount, Show, type Accessor, type JSX } from 'solid-js';
import { GroupUnavailable, GroupWorkspace } from './Group';
import { DeploymentWelcome } from './DeploymentWelcome';
import { CompanySetup } from './CompanySetup';
import { DefaultDestinationControl } from '../components/DefaultDestinationControl';
import { useLocation } from '@solidjs/router';
import { Navigate } from '@solidjs/router';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import { homeBootstrapKey, type HomeBootstrap, type HomeCore, type HomeInsights } from '@/solid/lib/home-resource';
import { dropServedFrame } from '@/solid/lib/served-frame';
import WorkspaceShell from '../components/WorkspaceShell';
import GetStarted from '../components/GetStarted';
import ClaimBanner from '../components/ClaimBanner';
import SharedWithYou from '../components/SharedWithYou';
import Shelf from '../components/Shelf';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN, WorkspaceSkeleton } from '../components/WorkspaceLayout';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';

/**
 * Home is one request: `/api/page/home?part=bootstrap` resolves the destination (account preference,
 * `?personal=1`, inherited company default) and carries what it renders. Nothing here waits for a
 * preference, a deployment read or group details before the shelf, and one skeleton stands in until it lands.
 */
export function HomePage(): JSX.Element {
 const {session,sessionError,reload}=useSession(); const location=useLocation();
 const personal=()=>new URLSearchParams(location.search).get('personal')==='1';
 const home=usePageData<HomeBootstrap>(()=>homeBootstrapKey(personal()));
 createEffect(()=>{if(sessionError())home.invalidate();});
 // A bootstrap for another account is never shown, whatever the store retained.
 const resolved=createMemo<'login'|'loading'|'error'|HomeBootstrap>(()=>{
  const current=session();
  const data=home.data();
  if(!data)return home.error()?'error':'loading';
  if(!data.signedIn)return data.deployment.mode==='company'?data:'login';
  if(current&&current.kind!=='account')return 'login';
  return current?.user&&data.accountId!==current.user.id?'error':data;
 });
 const loaded=()=>{const value=resolved();return typeof value==='object'&&value.signedIn?value:null;};
 const welcome=()=>{const value=resolved();return typeof value==='object'&&!value.signedIn?value.deployment:null;};
 const retry=()=>sessionError()?reload():void home.refresh(true);
 // Remove-default is the one edit that moves the homepage: read where it opens now.
 const destinationMoved=()=>void home.refresh(true);
 return <Show when={resolved()!=='login'} fallback={<Navigate href="/login"/>}>
 <Show when={welcome()} fallback={<Show when={loaded()} fallback={<main class={`${HOME_WORKSPACE_COLUMN} mt-8 pb-24`}><Show when={resolved()==='error'} fallback={<WorkspaceSkeleton/>}><div role="alert"><p>Could not load your workspace.</p><Button variant="secondary" size="sm" aria-label="Retry workspace" onClick={retry}>Try again</Button></div></Show></main>}>
 {data=>{
  const destination=()=>data().destination;
  const setup=()=>destination().kind==='setup';
  const unavailable=()=>destination().kind==='unavailable';
  const group=()=>{const value=destination();return value.kind==='group'?value:null;};
  const personalCore=()=>{const value=destination();return value.kind==='personal'?{signedIn:true as const,accountId:data().accountId,...value.core}:null;};
  return <>
  <Show when={setup()}><Show when={data().deployment.is_owner} fallback={<main class="p-8"><p role="alert">The company default group is unavailable. Your deployment owner can repair setup.</p><a href="/?personal=1">Open Personal</a></main>}><CompanySetup deployment={data().deployment} complete={()=>void home.refresh(true)}/></Show></Show>
  <Show when={unavailable()}><main class={HOME_WORKSPACE_COLUMN}><div class="p-8"><GroupUnavailable retry={()=>void home.refresh(true)}/></div></main></Show>
  <Show when={group()}>{value=><main class={HOME_WORKSPACE_COLUMN}>
   <Show when={home.error()}><div role="alert">Could not refresh your workspace. <Button variant="secondary" size="sm" aria-label="Retry workspace" onClick={retry}>Try again</Button></div></Show>
   <GroupWorkspace detail={value().detail} shelf={value().core} shelfFailed={false} retryShelf={retry} refresh={()=>void home.refresh(true)} defaults={{preferences:data().preferences,deployment:data().deployment}} onDefaultSaved={destinationMoved}/></main>}</Show>
  <Show when={personalCore()}>{core=><>
   <Show when={personal()}><div class="mx-auto max-w-4xl px-6 py-5 font-sans"><DefaultDestinationControl initial={{preferences:data().preferences,deployment:data().deployment}}/></div></Show>
   <PersonalHomePage core={{data:core,error:home.error,refresh:home.refresh,invalidate:home.invalidate}}/></>}</Show>
  </>;}}
 </Show>}>{deployment=><DeploymentWelcome deployment={deployment()}/>}</Show></Show>;
}

/** The slice of the Home bootstrap's page data Personal reads and refreshes. */
interface PersonalCore { data: Accessor<HomeCore | null>; error: Accessor<Error | null>; refresh: (force?: boolean) => Promise<void>; invalidate: () => void }

function PersonalHomePage(props:{core:PersonalCore}): JSX.Element {
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
    <Show when={account()} fallback={<main class={`${HOME_WORKSPACE_COLUMN} mt-8 pb-24`}><Show when={failed()} fallback={<WorkspaceSkeleton />}><div role="alert"><p>Could not load your workspace.</p><Button variant="secondary" size="sm" aria-label="Retry workspace" onClick={session() ? load : reload}>Try again</Button></div></Show></main>}>
      {workspace => <main class={HOME_WORKSPACE_COLUMN}>
        <Show when={empty()}><WorkspaceShell personal onCreated={load}><div class="workspace-page"><div class="mb-8 sm:mb-10"><h1 aria-label={greeting()} class="font-serif text-[clamp(1.6rem,3.4vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg">{greeting()}</h1><p class="mt-1.5 font-sans text-sm text-muted">Hand an agent the instruction below along with what artifact you want, and follow along.</p></div><div class="mb-6"><GetStarted destination={{type:'personal'}} /></div><a href="/datasets/new?personal=1" aria-label="Create dataset" class="inline-flex items-center gap-2 text-accent"><DatabasePlus size={15} />Create dataset</a></div></WorkspaceShell></Show>
        <ClaimBanner />
        <Show when={failed()}><div role="alert">Could not refresh your workspace. <Button variant="secondary" size="sm" aria-label="Retry workspace" onClick={load}>Try again</Button></div></Show>
        <Show when={!empty()}><WorkspaceLayout personal workspace={workspace()} insights={detail()} insightsError={Boolean(insights.error())} onCreated={load}>
          <WorkspaceHeading title="Artifacts"><span class="workspace-heading-meta">{workspace().artifacts.filter(row => row.format === 'html').length} artifacts</span></WorkspaceHeading>
          <Show when={workspace().artifacts.length}><Shelf rows={workspace().artifacts} actions="full" assets={false} scopeParentId={null} onQuery={setSharedQuery} /></Show>
          <SharedWithYou items={workspace().shared} query={sharedQuery()} />
        </WorkspaceLayout></Show>
      </main>}
    </Show>
  </Show>;
}
