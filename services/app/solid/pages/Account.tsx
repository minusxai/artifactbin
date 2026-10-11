import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';
import { AvatarCircle } from '../ui/AvatarCircle';
import { UsernameCard } from '../account/UsernameCard';
import { NotificationSettings } from '../account/NotificationSettings';
import { CustomDomainCard } from '../account/CustomDomainCard';
import { TokensPanel } from '../account/TokensPanel';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { SectionHeading } from '../ui/PageHeader';

export function AccountPage(): JSX.Element {
  const { session } = useSession();
  const page = usePageData<{ username: string | null; image: string | null }>('/api/page/account');
  return <Show when={!session() || !!session()?.user} fallback={<Navigate href="/login?callbackUrl=/account" />}>
    <main class="workspace-page">
      <WorkspaceHeading title="Account" description="Manage your profile, publishing and connected agents." />
      <Show when={page.error()}><Button variant="secondary" class="mb-4" type="button" aria-label="Retry account" onClick={() => void page.refresh(true)}>Could not refresh account. Retry</Button></Show>
      <div class="space-y-8">
        <section aria-labelledby="profile-heading"><SectionHeading id="profile-heading" class="mb-4">Profile</SectionHeading>
          <Panel class="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
            <div class="border-b border-edge pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6"><p class="mb-3 text-sm font-medium">Profile photo</p><AvatarCircle compact image={page.data()?.image ?? null} initial={page.data()?.username ?? 'a'} userId={session()?.user?.id ?? ''} onChange={() => void page.refresh(true)} onRemove={() => void page.refresh(true)} /></div>
            <UsernameCard username={page.data()?.username ?? null} />
          </Panel>
        </section>
        <NotificationSettings />
        <div class="empty:hidden"><CustomDomainCard /></div>
        <section aria-labelledby="connections-heading"><SectionHeading id="connections-heading">Connections</SectionHeading><p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Manage each afbin CLI connection to your account. Revoking a connection stops its agent. To add one, run <code class="rounded border border-edge bg-surface px-1.5 py-0.5 font-mono text-xs">afbin auth</code> on your machine.</p><div class="mt-4"><TokensPanel /></div></section>
      </div>
    </main>
  </Show>;
}
