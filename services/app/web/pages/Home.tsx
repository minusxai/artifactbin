import { useCallback, useEffect, useState } from 'react';
import { useRefreshable } from '@/lib/navigation';
import ClaimBanner from '@/components/ClaimBanner';
import Landing from '@/components/Landing';
import NextSteps from '@/components/NextSteps';
import SharedWithYou from '@/components/SharedWithYou';
import Shelf from '@/components/Shelf';
import { PAGE_COLUMN } from '@/components/ui';

type Home =
  | { signedIn: false; drafts?: Parameters<typeof Shelf>[0]['rows'] }
  | { signedIn: true; artifacts: Array<Record<string, unknown> & { id: string }>; shared: Parameters<typeof SharedWithYou>[0]['items'] };

export function HomePage() {
  const [home, setHome] = useState<Home | null>(null);
  const load = useCallback(() => { void fetch('/api/page/home', { credentials: 'same-origin' }).then((r) => r.json()).then(setHome).catch(() => null); }, []);
  useEffect(load, [load]);
  // A claim adds artifacts to this library; re-read rather than reload.
  useRefreshable(load);
  if (!home) return <main className={`${PAGE_COLUMN} mt-8 pb-24`} aria-busy="true" />;
  if (!home.signedIn) {
    if (home.drafts?.length) {
      return (
        <main className={`${PAGE_COLUMN} mt-8 pb-24`}>
          <div className="mb-6 flex flex-wrap items-baseline justify-start gap-x-4 gap-y-1">
            <h1 className="font-mono text-sm tracking-[0.14em] text-fg uppercase">Drafts held by this browser · </h1>
            <a className="font-sans text-sm text-accent underline underline-offset-2" href="/login">Log in to keep them</a>
          </div>
          <Shelf actions="full" rows={home.drafts} />
          <div className="mt-8"><NextSteps signedIn={false} /></div>
        </main>
      );
    }
    // A stranger has nothing to log into yet: the landing proves the product
    // and hands over the instruction; the masthead keeps the login door.
    return <Landing />;
  }
  return (
    <main className={`${PAGE_COLUMN} mt-8 pb-24`}>
      {/* The product's front door is stable: owned work, shared work, or an
        * empty library must never reorder it below secondary content. */}
      <div className="mb-6"><NextSteps connectOnly /></div>
      <ClaimBanner />
      {home.artifacts.length > 0 && <Shelf actions="full" rows={home.artifacts as never} />}
      <SharedWithYou items={home.shared} />
    </main>
  );
}
