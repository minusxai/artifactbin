/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { usePageData } from '../web/use-page-data';
import { useSession } from '../web/session';
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
    <main class="mx-auto mt-8 max-w-3xl px-6 pb-24"><h1 class="text-base font-semibold"><span class="text-accent">&gt;</span> account</h1>
      <Show when={page.error()}><button aria-label="Retry account" onClick={() => void page.refresh(true)}>Could not refresh account. Retry</button></Show>
      <div class="mt-6"><AvatarCircle image={page.data()?.image ?? null} initial={page.data()?.username ?? 'a'} userId={session()?.user?.id ?? ''} onChange={() => void page.refresh(true)} onRemove={() => void page.refresh(true)} /></div>
      <div class="mt-6"><UsernameCard username={page.data()?.username ?? null} /></div>
      <div class="mt-8"><NotificationSettings /></div>
      <div class="mt-8 empty:hidden"><CustomDomainCard /></div>
      <h2 class="mt-8 text-base font-semibold"><span class="text-accent">&gt;</span> connections</h2><p class="mt-2 font-mono text-sm leading-relaxed text-muted">Each row is one afbin CLI connection, made by approving it in this browser. Revoke one and that agent stops. Run <code>afbin auth</code> on a machine to add another.</p><div class="mt-6"><TokensPanel /></div>
      <h2 class="mt-8 text-base font-semibold"><span class="text-accent">&gt;</span> data</h2><div class="mt-4"><DatasetUpload /></div>
    </main>
  </Show>;
}
