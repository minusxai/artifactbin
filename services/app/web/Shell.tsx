/** The app chrome around every page: controls on the page, then its masthead. */
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import AdoptLegacyToken from '@/components/AdoptLegacyToken';
import HeaderBar from '@/components/HeaderBar';
import { MixpanelIdentify } from '@/components/MixpanelClient';
import PageChrome from '@/components/PageChrome';
import { useSession } from './session';

/**
 * The reusable frame, also used when `/a/:id` resolves to an owned folder.
 * Document artifacts deliberately stay outside it; an owned folder is a
 * workspace location and should be visually indistinguishable from Home.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return (
    <>
      <AdoptLegacyToken />
      {session?.user && <MixpanelIdentify userId={session.user.id} email={session.user.email} />}
      <PageChrome authed={!!session?.user} anon={session?.kind === 'anon'} />
      <HeaderBar authed={!!session?.user} />
      {children}
    </>
  );
}

export function Shell() {
  return <ShellFrame><Outlet /></ShellFrame>;
}
