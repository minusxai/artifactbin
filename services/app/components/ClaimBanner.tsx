'use client';

/**
 * "These drafts were made from this browser — add them to your account?"
 *
 * The anonymous path hands a browser a token; attaching that work to an
 * account must not mean pasting the token into a form — that is asking someone
 * for a credential their own browser is already holding. This asks instead,
 * right where they land after logging in.
 *
 * It NAMES what it found and requires a tick, rather than claiming silently.
 * Claiming is a one-way ownership transfer, and browsers are shared: seeing
 * "Q3 Revenue, Sales deck" is what lets someone recognise drafts that are not
 * theirs and leave them alone. A bare count could not carry that.
 *
 * There is no "dismiss" to remember: the offer ages out server-side (see
 * CLAIM_OFFER_WINDOW_HOURS), so ignoring it is already the way to decline, and
 * no invisible state accumulates.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { Button, PANEL } from '@/components/ui';

interface Claimable {
  tokenId: string;
  titles: string[];
  artifacts: number;
}

export default function ClaimBanner() {
  const router = useRouter();
  const [offers, setOffers] = useState<Claimable[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // What this browser holds is in its httpOnly cookie, so the SERVER decides
    // what is on offer — the page cannot name the tokens it holds.
    // An empty answer is the ordinary case and costs one cheap request.
    void fetch('/api/tokens/claimable', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { claimable?: Claimable[] } | null) => {
        if (!live || !body?.claimable?.length) return;
        setOffers(body.claimable);
        setPicked(Object.fromEntries(body.claimable.map((c) => [c.tokenId, true])));
      })
      // A failed probe is not a prompt: stay silent rather than show a broken
      // banner over an offer we could not actually verify.
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const claim = useCallback(async () => {
    const chosen = offers.filter((o) => picked[o.tokenId]);
    if (chosen.length === 0) return;
    setBusy(true);
    // One request per token, deliberately: /api/tokens/claim is per-token and
    // re-claiming is a no-op, so a single revoked token cannot sink the batch.
    const outcomes = await Promise.all(chosen.map(async (o) => {
      const res = await fetch('/api/tokens/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: o.tokenId }),
      }).catch(() => null);
      return { ok: !!res?.ok, offer: o };
    }));
    const ok = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.length - ok;
    setBusy(false);
    setResult(failed === 0
      ? `Added ${ok} to your account.`
      : `Added ${ok}. ${failed} could not be added — they may have been revoked.`);
    // The tokens STAY in the cookie: claiming changes who owns the artifacts,
    // not whether this browser may still edit them.
    setOffers((prev) => prev.filter((o) => !outcomes.some((x) => x.ok && x.offer.tokenId === o.tokenId)));
    if (ok > 0) router.refresh();
  }, [offers, picked, router]);

  const reject = useCallback(async (tokenId: string) => {
    if (!confirm('Reject these drafts? The token is gone for good and cannot be recovered.')) return;
    setRejecting(tokenId);
    const res = await fetch('/api/tokens/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId }),
    }).catch(() => null);
    setRejecting(null);
    if (!res?.ok) {
      setResult('Could not reject these drafts. Try again.');
      return;
    }
    setResult(null);
    setOffers((prev) => prev.filter((offer) => offer.tokenId !== tokenId));
    setPicked((prev) => {
      const next = { ...prev };
      delete next[tokenId];
      return next;
    });
  }, []);

  if (offers.length === 0 && !result) return null;

  return (
    <section aria-label="Unclaimed drafts" className={`${PANEL} mb-6 p-4`}>
      {offers.length > 0 && (
        <>
          <p className="font-sans text-sm text-fg">
            Made from this browser before you signed in — add to your account?
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {offers.map((o) => {
              // A token that has published nothing is still worth claiming: it
              // is this browser's identity, and what it publishes NEXT should
              // land in the account rather than be orphaned.
              const label = o.titles.length > 0
                ? o.titles.join(', ')
                : 'an unsaved session from this browser';
              const more = o.artifacts - o.titles.length;
              return (
                <li key={o.tokenId} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Claim ${o.titles[0] ?? 'this session'}`}
                    checked={!!picked[o.tokenId]}
                    onChange={(e) => setPicked((p) => ({ ...p, [o.tokenId]: e.target.checked }))}
                    className="mt-0.5 cursor-pointer"
                  />
                  <span className="min-w-0 flex-1 font-mono text-xs text-muted">
                    {label}{more > 0 ? ` +${more} more` : ''}
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    aria-label={`Reject ${o.tokenId}`}
                    disabled={busy || rejecting === o.tokenId}
                    onClick={() => void reject(o.tokenId)}
                    className="shrink-0 px-2 py-1"
                  >
                    {rejecting === o.tokenId ? 'rejecting…' : 'reject'}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <Button
              type="button"
              aria-label="Add to my account"
              disabled={busy}
              onClick={() => void claim()}
            >
              {busy ? 'adding…' : 'add to my account'}
            </Button>
          </div>
        </>
      )}
      {result && (
        <p aria-label="Claim result" className="mt-2 font-mono text-[11px] text-muted">{result}</p>
      )}
    </section>
  );
}
