'use client';

/**
 * "refresh external images" — the owner's door onto `refresh_asset`.
 *
 * A document keeps the URL its author wrote and we serve our copy of it, which
 * is right until the source changes: the copy is content-addressed by the URL,
 * so the picture behind it is frozen for everyone until somebody asks for it
 * again. This is that ask, over the same pipeline the agent tool runs
 * (`/api/my/artifacts/:id/assets/refresh` → lib/artifact-wire refreshAssetsFor).
 *
 * It SAYS WHAT HAPPENED where it was asked, because the useful answers are the
 * quiet ones: "already up to date" is what stops someone republishing a correct
 * document to be sure, and a failure has to name the URL — the fix (a dead link,
 * a host that now wants a login) is always outside this app.
 *
 * The re-entrancy guard is a REF and not the `busy` state, the fork row's
 * lesson: `setBusy(true)` lands at the next render, so two clicks in one tick
 * both read `false` and both fetch.
 */
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface RefreshReply {
  refreshed?: string[];
  unchanged?: string[];
  failed?: Array<{ code: string; url: string; fix: string }>;
  error?: string;
}

const CONTROL_ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-default disabled:opacity-60';

/** The reply as one line a person reads, ordered by what they most need to know. */
function summarise(reply: RefreshReply, status: number): string[] {
  if (status === 429) return ['too many web imports this hour — try again later'];
  if (status !== 200) return [reply.error ?? `could not refresh (${status})`];
  const lines: string[] = [];
  const refreshed = reply.refreshed?.length ?? 0;
  if (refreshed > 0) lines.push(`${refreshed} refreshed`);
  else if ((reply.unchanged?.length ?? 0) > 0) lines.push('already up to date');
  else if (!reply.failed?.length) lines.push('this document names no external images');
  for (const f of reply.failed ?? []) lines.push(`${f.url} — ${f.fix}`);
  return lines;
}

export default function RefreshAssets({ id }: {
  id: string;
  /** `menu` renders as a full-width document-control row (the fork row's precedent). */
  variant?: 'menu';
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    void (async () => {
      try {
        const res = await fetch(`/api/my/artifacts/${id}/assets/refresh`, { method: 'POST', credentials: 'same-origin' });
        const body = (await res.json().catch(() => ({}))) as RefreshReply;
        if (alive.current) setResult(summarise(body, res.status));
      } catch {
        if (alive.current) setResult(['could not refresh — try again']);
      } finally {
        inFlight.current = false;
        if (alive.current) setBusy(false);
      }
    })();
  }, [id]);

  return (
    <>
      <button
        type="button"
        aria-label="Refresh external images"
        onClick={refresh}
        disabled={busy}
        className={CONTROL_ROW}
      >
        <RefreshCw size={14} strokeWidth={1.75} />
        {busy ? 'refreshing…' : 'refresh external images'}
      </button>
      {result && (
        <div aria-label="Refresh result" role="status" className="mt-1 rounded-[5px] border border-edge bg-raised px-2 py-2 font-mono text-[11px] text-muted">
          {result.map((line) => <p key={line} className="whitespace-pre-wrap break-all">{line}</p>)}
        </div>
      )}
    </>
  );
}
