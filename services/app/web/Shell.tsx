/** The app chrome around every page: controls on the page, then its masthead. */
import { Outlet } from 'react-router';
import AdoptLegacyToken from '@/components/AdoptLegacyToken';
import HeaderBar from '@/components/HeaderBar';
import { MixpanelIdentify } from '@/components/MixpanelClient';
import PageChrome from '@/components/PageChrome';
import { useSession } from './session';

export function Shell() {
  const { session } = useSession();
  return (
    <>
      <AdoptLegacyToken />
      {session?.user && <MixpanelIdentify userId={session.user.id} email={session.user.email} />}
      <PageChrome authed={!!session?.user} anon={session?.kind === 'anon'} />
      <HeaderBar email={session?.user?.email ?? undefined} stats={session?.stats ?? null} />
      <Outlet />
    </>
  );
}
