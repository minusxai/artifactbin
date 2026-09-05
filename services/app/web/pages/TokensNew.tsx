/**
 * /tokens/new — the credential is a link (tok-p2, plan §3b). ONE page for logged-in and logged-out:
 * confirm ("Generate a token", with an "Expires in" picker: 1 h · 6 h (default) · 24 h · 7 d · 30 d) →
 * POST /api/tokens/anonymous { expiresInHours } → the secret shown ONCE with "Copy token" and its expiry →
 * logged-out only: POST /api/session/token { token } so the id lands in the agent cookie. Never a GET that
 * mints; nothing is stored; a fresh render shows the confirm step.
 */
import { useState } from 'react';
import { Button, PANEL } from '@/components/ui';
import { useSession } from '../session';

const EXPIRIES = [
  { hours: 1, label: '1 h' },
  { hours: 6, label: '6 h' },
  { hours: 24, label: '24 h' },
  { hours: 7 * 24, label: '7 d' },
  { hours: 30 * 24, label: '30 d' },
] as const;

interface MintedToken {
  token: string;
  expiresAt: string;
}

export function TokensNewPage() {
  const { session } = useSession();
  const [expiresInHours, setExpiresInHours] = useState(6);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/tokens/anonymous', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInHours }),
    }).catch(() => null);
    if (!response?.ok) {
      setBusy(false);
      setError('Could not generate a token. Try again.');
      return;
    }
    const body = (await response.json()) as Partial<MintedToken>;
    if (typeof body.token !== 'string' || typeof body.expiresAt !== 'string') {
      setBusy(false);
      setError('Could not generate a token. Try again.');
      return;
    }
    const next = { token: body.token, expiresAt: body.expiresAt };
    setMinted(next);
    setBusy(false);
    if (!session?.user) {
      const exchange = await fetch('/api/session/token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: next.token }),
      }).catch(() => null);
      if (!exchange?.ok) setError('Token generated, but this browser could not hold its drafts.');
    }
  };

  const copy = async () => {
    if (!minted) return;
    await navigator.clipboard.writeText(minted.token);
    setCopied(true);
  };

  return (
    <main className="mx-auto mt-16 max-w-xl px-6 pb-24">
      <div className="mx-auto max-w-md">
        <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> new token</h1>

        <div className={`${PANEL} mt-5 p-5`}>
          {minted ? (
            <>
              <p className="font-mono text-xs text-muted">Shown once</p>
              <code className="mt-3 block break-all rounded-[4px] border border-edge bg-bg p-3 font-mono text-sm text-fg">{minted.token}</code>
              <p className="mt-3 font-mono text-xs text-muted">Expires {new Date(minted.expiresAt).toLocaleString()}</p>
              <Button className="mt-4" type="button" aria-label="Copy token" onClick={() => void copy()}>
                {copied ? 'copied' : 'copy token'}
              </Button>
              <p className="mt-4 font-sans text-sm text-muted">
                Use it with your agent. <a className="text-accent underline underline-offset-2" href="/docs-human">Instructions</a>
              </p>
            </>
          ) : (
            <>
              <label className="block font-mono text-xs text-muted" htmlFor="token-expiry">Expires in</label>
              <select
                id="token-expiry"
                aria-label="Expires in"
                value={expiresInHours}
                onChange={(event) => setExpiresInHours(Number(event.target.value))}
                className="mt-2 w-full rounded-[4px] border border-edge bg-surface px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
              >
                {EXPIRIES.map((expiry) => <option key={expiry.hours} value={expiry.hours}>{expiry.label}</option>)}
              </select>
              <Button
                className="mt-5"
                type="button"
                aria-label="Generate a token"
                disabled={busy || session === null}
                onClick={() => void generate()}
              >
                {busy ? 'generating…' : 'generate a token'}
              </Button>
            </>
          )}
          {error && <p className="mt-3 font-mono text-xs text-danger">{error}</p>}
        </div>
      </div>
    </main>
  );
}
