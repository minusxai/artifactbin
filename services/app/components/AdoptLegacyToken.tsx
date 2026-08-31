'use client';

/**
 * The one-time bridge off `localStorage`.
 *
 * Deployed browsers may still hold a pre-cookie credential in
 * `localStorage('mx_token' | 'mx_tokens')`. Authorization is the httpOnly
 * cookie alone (lib/agent-session), so such a browser is a stranger to its
 * own documents — holding a token nothing reads.
 *
 * This exchanges a leftover value for the cookie ONCE and deletes it. It is a
 * bridge, not a store: nothing here writes localStorage, and once it has run
 * the browser holds its credential the way everything else expects.
 *
 * Mounted on the app shell, so it runs wherever a person lands in the app. It
 * cannot run on `/a/<id>` for such an owner — they are served the document
 * itself, which is opaque-origin and cannot reach the app's storage — but that
 * is also where they are headed FROM: the app is what lists their documents.
 *
 * Deletable once no browser plausibly holds a pre-cookie token.
 */
import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation';
import { adoptToken } from '@/lib/browser-session';

const LIST_KEY = 'mx_tokens';
const LEGACY_KEY = 'mx_token';
/** Once per browser session: a dead token must not re-ask on every page. */
const TRIED_KEY = 'mx_legacy_adopted';

const isToken = (v: unknown): v is string => typeof v === 'string' && v.startsWith('mx_');

/**
 * The token this browser last used, by the old list's rule: the LAST entry is
 * the primary (recency order), with the single legacy slot — overwritten on
 * every use — newer still.
 */
function leftoverToken(): string | null {
  try {
    const single = localStorage.getItem(LEGACY_KEY);
    if (isToken(single)) return single;
    const parsed: unknown = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    const list = Array.isArray(parsed) ? parsed.filter(isToken) : [];
    return list.length ? list[list.length - 1] : null;
  } catch {
    return null; // private mode, or a corrupt value: nothing to migrate
  }
}

function forgetLeftovers(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LIST_KEY);
  } catch { /* private mode — there was nothing to clear */ }
}

export default function AdoptLegacyToken() {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    try { if (sessionStorage.getItem(TRIED_KEY)) return; } catch { /* private mode */ }
    const token = leftoverToken();
    if (!token) return;
    try { sessionStorage.setItem(TRIED_KEY, '1'); } catch { /* private mode */ }
    void adoptToken(token).then((ok) => {
      // Cleared either way: adopted (the cookie holds it now) or refused
      // (revoked/unknown), and a dead token must not be retried forever.
      forgetLeftovers();
      // Only a real adoption changes what this page should show.
      if (ok && live) router.refresh();
    });
    return () => { live = false; };
  }, [router]);
  return null;
}
