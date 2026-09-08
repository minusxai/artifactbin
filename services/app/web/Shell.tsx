/** The app chrome around every page: a compact top bar and page controls. */
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import AdoptLegacyToken from '@/components/AdoptLegacyToken';
import { MixpanelIdentify } from '@/components/MixpanelClient';
import PageChrome from '@/components/PageChrome';
import { useSession } from './session';
import {TrustedAppLinks} from './AppNavigation';

/**
 * The reusable frame, also used when `/a/:id` resolves to an owned folder.
 * Document artifacts deliberately stay outside it; an owned folder is a
 * workspace location and should be visually indistinguishable from Home.
 */
export function ShellFrame({ children, hideBreadcrumb = false }: { children: ReactNode; hideBreadcrumb?: boolean }) {
  const { session } = useSession();
  return (
    <>
      <AdoptLegacyToken />
      {session?.user && <MixpanelIdentify userId={session.user.id} email={session.user.email} />}
      <PageChrome hideBreadcrumb={hideBreadcrumb} authed={!!session?.user} anon={session?.kind === 'anon'} />
      <TrustedAppLinks>{children}</TrustedAppLinks>
    </>
  );
}

export function Shell() {
  return <ShellFrame><Outlet /></ShellFrame>;
}
