/** The app chrome around every page: a compact top bar and page controls. */
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { MixpanelIdentify } from '@/components/MixpanelClient';
import PageChrome from '@/components/PageChrome';
import { useSession } from './session';

/**
 * The reusable frame, also used when `/a/:id` resolves to an owned folder.
 * Document artifacts deliberately stay outside it; an owned folder is a
 * workspace location and should be visually indistinguishable from Home.
 */
export function ShellFrame({ children, hideBreadcrumb = false, pending = false }: { children: ReactNode; hideBreadcrumb?: boolean; pending?: boolean }) {
  const { session } = useSession();
  const chrome = <PageChrome hideBreadcrumb={hideBreadcrumb} authed={!!session?.user} anon={session?.kind === 'anon'} />;
  // A provisional frame is presentation only. Its controls cannot act for a
  // destination that has not mounted, and its short lifetime must not start
  // account side effects.
  if (pending) return <div data-mx-page-pending><div inert>{chrome}</div>{children}</div>;
  return (
    <>
      {session?.user && <MixpanelIdentify userId={session.user.id} email={session.user.email} />}
      {chrome}
      {children}
    </>
  );
}

export function Shell() {
  return <ShellFrame><Outlet /></ShellFrame>;
}
