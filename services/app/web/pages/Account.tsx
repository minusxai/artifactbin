import {appFetch as fetch} from '@/web/api-origin';
import { useCallback, useEffect, useState } from 'react';
import { useRefreshable } from '@/lib/navigation';
import { Navigate } from 'react-router';
import ClaimForm from '@/components/ClaimForm';
import DatasetUpload from '@/components/DatasetUpload';
import TokensPanel from '@/components/TokensPanel';
import UsernameCard from '@/components/UsernameCard';
import { useSession } from '../session';

export function AccountPage() {
  const { session } = useSession();
  const [data, setData] = useState<{ username: string | null } | null>(null);
  const load = useCallback(() => { void fetch('/api/page/account', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => null); }, []);
  useEffect(load, [load]);
  useRefreshable(load);
  if (session && !session.user) return <Navigate to="/login?callbackUrl=/account" replace />;
  return (
    <main className="mx-auto mt-8 max-w-3xl px-6 pb-24">
      <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> account</h1>
      {/*
        * KEYED ON THE ANSWER. The card seeds its input from this prop once, at
        * mount — and this page renders before it has fetched anything, so an
        * unkeyed card would keep the `null` it mounted with and show an empty
        * handle box to someone who has a handle. Re-keying re-seeds it the
        * moment the answer lands (before anyone could have typed into it).
        */}
      <div className="mt-4"><UsernameCard key={data?.username ?? 'loading'} username={data?.username ?? null} /></div>
      <h2 className="mt-8 text-base font-semibold"><span className="text-accent">&gt;</span> tokens</h2>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">Each token is one agent. Revoke one and that agent stops; claim one and its artifacts join your library.</p>
      <div className="mt-5"><ClaimForm /></div>
      <div className="mt-6"><TokensPanel /></div>
      <h2 className="mt-8 text-base font-semibold"><span className="text-accent">&gt;</span> data</h2>
      <div className="mt-4"><DatasetUpload /></div>
    </main>
  );
}
