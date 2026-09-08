import { useCallback, useEffect, useRef, useState } from 'react';
import {pageJson} from '../page-data';
import { useRefreshable } from '@/lib/navigation';
import { Navigate } from 'react-router';
import ClaimForm from '@/components/ClaimForm';
import DatasetUpload from '@/components/DatasetUpload';
import TokensPanel from '@/components/TokensPanel';
import UsernameCard from '@/components/UsernameCard';
import { useSession } from '../session';
import {PageStatus} from '../PageStatus';

export function AccountPage() {
  const { session,error:sessionError,reload } = useSession();
  const [data, setData] = useState<{ username: string | null } | null>(null);
  const [error,setError] = useState<string|null>(null);
  const request=useRef<AbortController|null>(null);
  const userId=session?.user?.id;
  const load = useCallback(() => {
    request.current?.abort();if(!userId){setData(null);return;}
    const pending=new AbortController();request.current=pending;setError(null);
    void pageJson<{username:string|null}>('/api/page/account',pending.signal).then(next=>{if(!pending.signal.aborted)setData(next);}).catch(cause=>{if(!pending.signal.aborted){setData(null);setError(cause.message);}});
  }, [userId]);
  useEffect(()=>{load();return()=>request.current?.abort();}, [load]);
  useRefreshable(load);
  if (!session) return <PageStatus label="account" error={sessionError} retry={()=>void reload()}/>;
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
      <div className="mt-4">{data?<UsernameCard key={data.username ?? 'none'} username={data.username}/>:<PageStatus label="account" error={error} retry={load}/>}</div>
      <h2 className="mt-8 text-base font-semibold"><span className="text-accent">&gt;</span> tokens</h2>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">Each token is one agent. Revoke one and that agent stops; claim one and its artifacts join your library.</p>
      <div className="mt-5"><ClaimForm /></div>
      <div className="mt-6"><TokensPanel /></div>
      <h2 className="mt-8 text-base font-semibold"><span className="text-accent">&gt;</span> data</h2>
      <div className="mt-4"><DatasetUpload /></div>
    </main>
  );
}
