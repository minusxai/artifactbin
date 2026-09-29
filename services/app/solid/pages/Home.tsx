/* @jsxImportSource solid-js */
import { createMemo, onMount, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import type { HomeCore, HomeInsights } from '@/web/home-resource';
import { clearInitialStory } from '@/web/initial-story';
import { PAGE_COLUMN } from '../components/ui';
import GetStarted from '../components/GetStarted';
import ClaimBanner from '../components/ClaimBanner';
import SharedWithYou from '../components/SharedWithYou';
import Shelf from '../components/Shelf';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN, WorkspaceSkeleton } from '../components/WorkspaceLayout';
import { usePageData } from '../web/use-page-data';
import { useSession } from '../web/session';

export function HomePage(): JSX.Element {
  const { session, reload } = useSession();
  const core = usePageData<HomeCore>('/api/page/home?part=core');
  const insights = usePageData<HomeInsights>('/api/page/home?part=insights', { enabled: () => Boolean(core.data()?.signedIn) });
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
  onMount(clearInitialStory);
  return <Show when={!(session() && session()!.kind !== 'account') && !(home() && !home()!.signedIn)} fallback={<Navigate href="/login" />}>
    <Show when={account()} fallback={<main class={`${HOME_WORKSPACE_COLUMN} mt-8 pb-24`}><Show when={failed()} fallback={<WorkspaceSkeleton />}><div role="alert"><p>Could not load your workspace.</p><button type="button" aria-label="Retry workspace" onClick={session() ? load : reload}>Try again</button></div></Show></main>}>
      {workspace => <main class={`${empty() ? PAGE_COLUMN : HOME_WORKSPACE_COLUMN} mt-8 pb-24`}>
        <Show when={empty()}><div class="mb-8 sm:mb-10"><h1 aria-label={greeting()} class="font-serif text-[clamp(1.6rem,3.4vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg">{greeting()}</h1><p class="mt-1.5 font-sans text-sm text-muted">Hand an agent the instruction below along with what artifact you want, and follow along.</p></div><div class="mb-6"><GetStarted /></div></Show>
        <ClaimBanner />
        <Show when={failed()}><div role="alert">Could not refresh your workspace. <button type="button" aria-label="Retry workspace" onClick={load}>Try again</button></div></Show>
        <Show when={empty()}><div class="mb-4 flex justify-end"><a href="/datasets/new" aria-label="Create dataset" class="inline-flex items-center gap-1.5 rounded border border-edge-bright px-3 py-1.5 font-mono text-xs text-accent"><DatabasePlus size={13} />Create dataset</a></div><p class="mt-8"><a href="/trash" aria-label="Trash" class="font-mono text-[10px] text-faint">trash</a></p></Show>
        <Show when={!empty()}><WorkspaceLayout workspace={workspace()} insights={detail()} insightsError={Boolean(insights.error())} onCreated={load}>
          <Show when={workspace().artifacts.length}><Shelf rows={workspace().artifacts.map(row => ({ ...row, views: detail()?.views?.[row.id], sparkline: detail()?.sparklines[row.id] ?? undefined }))} actions="full" assets={false} scopeParentId={null} /></Show>
          <SharedWithYou items={workspace().shared} />
        </WorkspaceLayout></Show>
      </main>}
    </Show>
  </Show>;
}
