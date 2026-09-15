import { usePageData } from '../use-page-data';
import { Navigate } from 'react-router';
import DatasetUpload from '@/components/DatasetUpload';
import TokensPanel from '@/components/TokensPanel';
import UsernameCard from '@/components/UsernameCard';
import { useSession } from '../session';

export function AccountPage() {
  const { session } = useSession();
  const { data, error, refresh } = usePageData<{ username: string | null }>('/api/page/account');
  if (session && !session.user) return <Navigate to="/login?callbackUrl=/account" replace />;
  return (
    <main className="mx-auto mt-8 max-w-3xl px-6 pb-24">
      <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> account</h1>
      {error && <button aria-label="Retry account" onClick={() => void refresh(true)}>Could not refresh account. Retry</button>}
      {/*
        * KEYED ON THE ANSWER. The card seeds its input from this prop once, at
        * mount — and this page renders before it has fetched anything, so an
        * unkeyed card would keep the `null` it mounted with and show an empty
        * handle box to someone who has a handle. Re-keying re-seeds it the
        * moment the answer lands (before anyone could have typed into it).
        */}
      <div className="mt-4"><UsernameCard key={data?.username ?? 'loading'} username={data?.username ?? null} /></div>
      <h2 className="mt-8 text-base font-semibold"><span className="text-accent">&gt;</span> connections</h2>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">Each row is one afbin CLI connection, made by approving it in this browser. Revoke one and that agent stops. Run <code>afbin auth</code> on a machine to add another.</p>
      <div className="mt-6"><TokensPanel /></div>
      <h2 className="mt-8 text-base font-semibold"><span className="text-accent">&gt;</span> data</h2>
      <div className="mt-4"><DatasetUpload /></div>
    </main>
  );
}
