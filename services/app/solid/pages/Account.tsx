import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';
import { AvatarCircle } from '../components/AvatarCircle';
import { UsernameCard } from '../components/UsernameCard';
import { NotificationSettings } from '../components/NotificationSettings';
import { CustomDomainCard } from '../components/CustomDomainCard';
import { TokensPanel } from '../components/TokensPanel';
import { DatasetUpload } from '../components/DatasetUpload';

export function AccountPage(): JSX.Element {
  const { session } = useSession();
  const page = usePageData<{ username: string | null; image: string | null }>('/api/page/account');
  return <Show when={!session() || !!session()?.user} fallback={<Navigate href="/login?callbackUrl=/account" />}>
    <main class="workspace-page">
      <WorkspaceHeading title="Account" description="Manage your profile, publishing and connected agents." />
      <Show when={page.error()}><button class="mb-4 rounded border border-edge bg-surface px-3 py-2 text-sm" aria-label="Retry account" onClick={() => void page.refresh(true)}>Could not refresh account. Retry</button></Show>
      <div class="space-y-8">
        <section aria-labelledby="profile-heading"><h2 id="profile-heading" class="mb-4 text-base font-semibold">Profile</h2>
          <div class="grid items-start gap-5 rounded-[6px] border border-edge bg-surface p-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
            <div class="border-b border-edge pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6"><p class="mb-3 text-sm font-medium">Profile photo</p><AvatarCircle compact image={page.data()?.image ?? null} initial={page.data()?.username ?? 'a'} userId={session()?.user?.id ?? ''} onChange={() => void page.refresh(true)} onRemove={() => void page.refresh(true)} /></div>
            <UsernameCard username={page.data()?.username ?? null} />
          </div>
        </section>
        <NotificationSettings />
        <div class="empty:hidden"><CustomDomainCard /></div>
        <section aria-labelledby="connections-heading"><h2 id="connections-heading" class="text-base font-semibold">Connections</h2><p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Manage each afbin CLI connection to your account. Revoking a connection stops its agent. To add one, run <code class="rounded border border-edge bg-surface px-1.5 py-0.5 font-mono text-xs">afbin auth</code> on your machine.</p><div class="mt-4"><TokensPanel /></div></section>
        <section aria-labelledby="data-heading"><h2 id="data-heading" class="text-base font-semibold">Data</h2><div class="mt-4"><DatasetUpload /></div></section>
      </div>
    </main>
  </Show>;
}
