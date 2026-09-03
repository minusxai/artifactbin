/**
 * /tokens/new — the credential is a link (tok-p2, plan §3b). ONE page for logged-in and logged-out:
 * confirm ("Generate a token", with an "Expires in" picker: 1 h · 6 h (default) · 24 h · 7 d · 30 d) →
 * POST /api/tokens/anonymous { expiresInHours } → the secret shown ONCE with "Copy token" and its expiry →
 * logged-out only: POST /api/session/token { token } so the id lands in the agent cookie. Never a GET that
 * mints; nothing is stored; a fresh render shows the confirm step.
 *
 * `?source=<surface>` (m4). Nobody arrives here for fun: an agent hit a wall, told its human to stop, and
 * sent them for a string that expires in six hours. That is the one moment a human is receptive to "install
 * the plugin and never do this again", and this page used to spend it in silence. So the connect card sits
 * ABOVE the mint, opened on the surface the agent named — a recommendation, never a gate: the mint below is
 * byte-for-byte the flow it always was, same clicks, same secret. There is no second copy of the connect
 * copy here; it is `GetStarted`, the same component the landing page shows. The query carries a SURFACE KEY
 * and nothing else — a token still never rides a URL.
 */
import { useState } from 'react';
import { useLocation } from 'react-router';
import GetStarted, { sourceSurface } from '@/components/GetStarted';
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
  const { search } = useLocation();
  // Read once, here: below this line a surface is a SurfaceKey or nothing, never a query string.
  const namedSurface = sourceSurface(search);
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

        {/* The better answer, offered first. A pasted token expires; this does not — and the human is
          * standing here precisely because the last one ran out or never existed. */}
        <div className="mt-5">
          <GetStarted initialSurface={namedSurface ?? undefined} />
        </div>

        {/* …and the thing they actually came for, unchanged and one click away. The label is a signpost
          * between two cards, not a toll: nothing above has to be done before this works. */}
        <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
          or take a token
        </p>
        <div className={`${PANEL} mt-2 p-5`}>
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
