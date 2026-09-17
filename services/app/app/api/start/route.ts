/**
 * POST /api/start — the zero-to-live-document button.
 *
 * Creates an empty markup artifact and hands back the ONE agent starter
 * (lib/agent-copy `existingPaste`), so the home page can give the user a paste
 * for a real, watchable document: they paste it to an agent, and the page they
 * are looking at fills in over the live stream.
 *
 * Signed-in callers keep account ownership. A new guest browser receives a
 * signed HttpOnly ownership cookie; no bearer leaves this route. The CLI must
 * connect to that owner through browser approval before editing.
 *
 * A caller that already HAS a credential (an agent's bearer, a browser holding
 * the agent cookie) keeps acting as it: the document it creates joins the ones
 * that credential already reaches, exactly as any other create does.
 */
import { auth } from '@/auth';
import { createArtifact } from '@/lib/artifacts';
import { existingPaste } from '@/lib/agent-copy';
import { baseUrl, json } from '@/lib/http';
import { START_PLACEHOLDER_MARKUP } from '@/lib/start-placeholder';
import { resolveToken } from '@/lib/tokens';
import { sessionActor } from '@/lib/viewer';
import { parseContentInput } from '@/lib/story/input';
import { createGuestOwner } from '@/lib/guest-owner';

export async function POST(request: Request) {
  // If no account session resolves, use browser guest ownership below.
  // auth() can throw synchronously outside a request context.
  let userId: string | null = null;
  try {
    userId = (await auth())?.user?.id ?? null;
  } catch {
    userId = null;
  }

  // Whatever credential the caller already presented — an agent's own bearer
  // (afbin, after its browser approval), or the agent cookie a browser holds.
  // The document joins that identity; only a new guest needs a new owner.
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const bearer = offered ? await resolveToken(offered) : null;
  const actor = bearer ? null : await sessionActor(request);
  const ownerId = userId ?? bearer?.userId ?? actor?.viewer?.userId ?? null;
  const existingTokenId = bearer?.id ?? actor?.tokenId ?? '';
  const guest = !ownerId && !existingTokenId ? await createGuestOwner() : null;
  const tokenId = existingTokenId || guest?.tokenId || '';
  const parsed = await parseContentInput({ markup: START_PLACEHOLDER_MARKUP }, {});
  if (parsed instanceof Response) return parsed; // unreachable: the placeholder is fixed and valid

  const row = await createArtifact(tokenId, ownerId ?? guest?.userId ?? null, {
    ...parsed,
    // NULL, not 'Untitled': unnamed must stay distinguishable from named-that,
    // because an unnamed document follows its own heading (lib/story/title.ts)
    // and an explicit title never does.
    title: null,
    description: null,
    // The starter has always been link-readable, including guest creation.
    ...(guest || actor?.credential === 'agent-cookie' ? { visibility: 'public' as const } : {}),
  });

  const base = baseUrl(request);
  const response = json(
    {
      id: row.id,
      url: `${base}/a/${row.id}`,
      edit_id: row.edit_id,
      prompt: existingPaste(base, row.id),
    },
    201,
  );
  if (guest) response.headers.set('Set-Cookie', guest.cookie);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
