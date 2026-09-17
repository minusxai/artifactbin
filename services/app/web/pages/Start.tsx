import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

/** Anonymous entry point. A shared promise survives StrictMode's effect replay;
 * replacing history means refreshing the destination never creates another doc.
 * Do not retry an uncertain POST automatically: it may already have committed. */
export function StartPage() {
  const navigate = useNavigate();
  const creation = useRef<Promise<string> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    creation.current ??= fetch('/api/start', { method: 'POST' }).then(async response => {
      if (!response.ok) throw new Error('Creation failed');
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error('Missing artifact');
      return `/a/${encodeURIComponent(body.id)}`;
    });
    void creation.current.then(path => { if (active) void navigate(path, { replace: true }); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [navigate]);
  return <main className="mx-auto flex min-h-[70svh] max-w-xl flex-col justify-center gap-4 px-6">
    {failed ? <>
      <p role="alert">Could not create your artifact. The request may have completed; check your workspace before trying again.</p>
      <a href="/" className="text-accent underline">Open workspace</a>
    </> : <p role="status" className="font-mono text-sm text-muted">Creating your artifact…</p>}
  </main>;
}
