import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, onMount, Show, type JSX } from 'solid-js';
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
  const { session, sessionError, reload } = useSession();
  // "My artifacts"'s own search box (Shelf) also narrows "Shared with you" below it, the way one
  // search box on a page reads as one search to whoever is typing into it.
  const [sharedQuery, setSharedQuery] = createSignal('');
  const core = usePageData<HomeCore>('/api/page/home?part=core');
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
        <Show when={empty()}><WorkspaceShell onCreated={load}><div class="workspace-page"><div class="mb-8 sm:mb-10"><h1 aria-label={greeting()} class="font-serif text-[clamp(1.6rem,3.4vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg">{greeting()}</h1><p class="mt-1.5 font-sans text-sm text-muted">Hand an agent the instruction below along with what artifact you want, and follow along.</p></div><div class="mb-6"><GetStarted /></div><a href="/datasets/new" aria-label="Create dataset" class="inline-flex items-center gap-2 text-accent"><DatabasePlus size={15} />Create dataset</a></div></WorkspaceShell></Show>
        <ClaimBanner />
        <Show when={failed()}><div role="alert">Could not refresh your workspace. <button type="button" aria-label="Retry workspace" onClick={load}>Try again</button></div></Show>
        <Show when={!empty()}><WorkspaceLayout workspace={workspace()} insights={detail()} insightsError={Boolean(insights.error())} onCreated={load}>
          <WorkspaceHeading title="Artifacts"><span class="workspace-heading-meta">{workspace().artifacts.filter(row => row.format === 'markup').length} artifacts</span></WorkspaceHeading>
          <Show when={workspace().artifacts.length}><Shelf rows={workspace().artifacts} actions="full" assets={false} scopeParentId={null} onQuery={setSharedQuery} /></Show>
          <SharedWithYou items={workspace().shared} query={sharedQuery()} />
        </WorkspaceLayout></Show>
      </main>}
    </Show>
  </Show>;
}
