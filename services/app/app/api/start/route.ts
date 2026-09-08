/**
 * POST /api/start — the zero-to-live-document button.
 *
 * Mints an anonymous token AND an empty markup artifact in one call, so the
 * home page can hand the user a paste for a real, watchable
 * document: they paste it to an agent, and the page they are looking at fills
 * in over the live stream.
 *
 * It composes two things that already exist (anonymous mint, create) rather
 * than adding a third way to do either — same IP rate limit, same artifact
 * shape. Signed-in callers get the artifact stamped with their account so it
 * appears in their dashboard immediately. Anonymous callers receive the new
 * token once, inline in the decided paste; signed-in callers receive the owned
 * paste and use an account token they already gave their agent.
 */
import { auth } from '@/auth';
import { createArtifact } from '@/lib/artifacts';
import { anonymousPaste, ownedPaste } from '@/lib/agent-copy';
import { baseUrl, json } from '@/lib/http';
import { START_PLACEHOLDER_MARKUP } from '@/lib/start-links';
import { mintToken, resolveToken } from '@/lib/tokens';
import { withAgentSession } from '@/lib/agent-session';
import { sessionActor } from '@/lib/viewer';
import { parseContentInput } from '@/lib/story/input';

// The placeholder document lives with the start-link protocol
// (lib/start-links): the brief's fill-vs-edit mode is derived from its
// waiting-line anchor, so the markup and the check must not drift apart.
const PLACEHOLDER = START_PLACEHOLDER_MARKUP;

export async function POST(request: Request) {
  // Anonymous-first: a session only decides OWNERSHIP, never access. If it
  // cannot be resolved, fall back to an unowned document — the user can still
  // claim its token later, which is exactly what claiming is for. (Failing
  // open costs nothing here: no session means fewer privileges, not more.
  // try/catch, not .catch(): auth() throws synchronously off-request.)
  let userId: string | null = null;
  try {
    userId = (await auth())?.user?.id ?? null;
  } catch {
    userId = null;
  }

  // An AGENT that sent its own bearer keeps acting as that token: the document
  // it is about to write joins the ones it already reaches.
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const existing = offered ? await resolveToken(offered) : null;

  // A BROWSER holds its tokens as ids in an httpOnly cookie, so there is no
  // plaintext left to hand the agent — and an anonymous token only reaches what
  // it created, so a start link carrying some OTHER token would produce a
  // document its own agent could not edit. This document therefore gets a fresh
  // token, which the agent receives through the link and the browser ADDS to
  // what it holds — the cookie is a LIST precisely so a second document's
  // token never orphans the first's.
  const held = existing ? null : await sessionActor(request);
  const minted: { id: string; token: string | null; expiresAt?: string | null } = existing
    ? { id: existing.id, token: offered }
    : await mintToken('agent-link');
  const parsed = await parseContentInput({ markup: PLACEHOLDER }, {});
  if (parsed instanceof Response) return parsed; // unreachable: the placeholder is fixed and valid

  const row = await createArtifact(minted.id, userId ?? existing?.userId ?? held?.viewer?.userId ?? null, {
    ...parsed,
    // NULL, not 'Untitled': unnamed must stay distinguishable from named-that,
    // because an unnamed document follows its own heading (lib/story/title.ts)
    // and an explicit title never does.
    title: null,
    description: null,
  });

  const base = baseUrl(request);
  const url = `${base}/a/${row.id}`;
  const signedIn = userId !== null;
  const prompt = signedIn
    ? ownedPaste(base, row.id)
    : anonymousPaste(base, row.id, minted.token!);
  const res = json(
    {
      id: row.id,
      url,
      edit_id: row.edit_id,
      expiresAt: minted.expiresAt,
      prompt,
      ...(!signedIn ? { token: minted.token } : {}),
    },
    201,
  );
  // The BROWSER's copy of the capability also rides back as an httpOnly cookie,
  // so this tab can edit the document it just made. Skipped for an agent's own
  // bearer call: it has no cookie and needs none.
  // A browser that started this document holds its token from here on — the
  // proxy's cookie (by instruction) or the app's own, never both.
  return existing ? res : withAgentSession(request, res, minted.id);
}
