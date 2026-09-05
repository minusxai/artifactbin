import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useRefreshable } from '@/lib/navigation';
import { useSession } from '../session';

interface TrashFile { id: string; title: string | null; format: string; deleted_at: string }

/**
 * THE TRASH — what this account has deleted and not yet lost.
 *
 * Deliberately the plainest page in the product: a list, a date, and one
 * button per row. Everything a document normally offers (open, share, export)
 * is exactly what a deleted document must not offer — every read of it is the
 * uniform 404 — so the only verb here is the one that makes it a document
 * again.
 */
export function TrashPage() {
  const { session } = useSession();
  const [data, setData] = useState<{ files: TrashFile[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    void fetch('/api/page/trash', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => null);
  }, []);
  useEffect(load, [load]);
  useRefreshable(load);

  const restore = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/my/artifacts/${id}/restore`, { method: 'POST', credentials: 'same-origin' });
      load();
    } finally {
      setBusy(null);
    }
  };

  if (session && !session.user) return <Navigate to="/login?callbackUrl=/trash" replace />;
  const files = data?.files ?? [];
  return (
    <main className="mx-auto mt-8 max-w-3xl px-6 pb-24">
      <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> trash</h1>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">
        Deleted documents stay here. Nothing is ever erased, so there is no deadline to restore by — and a deleted document still counts against your quota. A folder brings back everything that was deleted with it.
      </p>
      {data && files.length === 0
        ? <p className="mt-6 font-mono text-xs text-faint">Nothing deleted.</p>
        : (
          <ul className="mt-6 divide-y divide-edge">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{f.title || 'Untitled'}</span>
                <span className="font-mono text-xs text-faint">{f.format}</span>
                <time className="font-mono text-xs text-faint" dateTime={f.deleted_at}>{new Date(f.deleted_at).toLocaleDateString()}</time>
                <button
                  type="button"
                  aria-label={`Restore ${f.title || 'Untitled'}`}
                  disabled={busy === f.id}
                  onClick={() => void restore(f.id)}
                  className="rounded border border-edge px-2 py-1 font-mono text-xs hover:border-accent disabled:opacity-50"
                >
                  restore
                </button>
              </li>
            ))}
          </ul>
        )}
    </main>
  );
}
