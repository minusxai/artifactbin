/**
 * POST /api/start — the zero-to-live-document button.
 *
 * Creates an empty markup artifact and hands back the ONE agent starter
 * (lib/agent-copy `existingPaste`), so the home page can give the user a paste
 * for a real, watchable document: they paste it to an agent, and the page they
 * are looking at fills in over the live stream.
 *
 * NOTHING IS MINTED HERE. The afbin CLI's device approval is the only way any
 * client obtains a credential, so this route hands out no token, sets no
 * agent cookie and names no expiry — the same body for a signed-in and a
 * signed-out caller. A signed-in caller's document is stamped with their
 * account (it appears in their dashboard, and the CLI connected to that
 * account edits it); a signed-out caller's document is unowned and born
 * public, which is what makes it watchable in the tab that created it and
 * readable by whoever holds the link.
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

export async function POST(request: Request) {
  // A session only decides OWNERSHIP, never access. If it cannot be resolved,
  // the document is simply unowned. (Failing open costs nothing here: no
  // session means fewer privileges, not more. try/catch, not .catch(): auth()
  // throws synchronously off-request.)
  let userId: string | null = null;
  try {
    userId = (await auth())?.user?.id ?? null;
  } catch {
    userId = null;
  }

  // Whatever credential the caller already presented — an agent's own bearer
  // (afbin, after its browser approval), or the agent cookie a browser holds.
  // It is never created here, only honoured: the document joins what that
  // credential already reaches.
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const bearer = offered ? await resolveToken(offered) : null;
  const actor = bearer ? null : await sessionActor(request);
  const tokenId = bearer?.id ?? actor?.tokenId ?? '';
  const parsed = await parseContentInput({ markup: START_PLACEHOLDER_MARKUP }, {});
  if (parsed instanceof Response) return parsed; // unreachable: the placeholder is fixed and valid

  const row = await createArtifact(tokenId, userId ?? bearer?.userId ?? actor?.viewer?.userId ?? null, {
    ...parsed,
    // NULL, not 'Untitled': unnamed must stay distinguishable from named-that,
    // because an unnamed document follows its own heading (lib/story/title.ts)
    // and an explicit title never does.
    title: null,
    description: null,
  });

  const base = baseUrl(request);
  return json(
    {
      id: row.id,
      url: `${base}/a/${row.id}`,
      edit_id: row.edit_id,
      prompt: existingPaste(base, row.id),
    },
    201,
  );
}
