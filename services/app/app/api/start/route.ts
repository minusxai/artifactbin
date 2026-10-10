/**
 * POST /api/start — the zero-to-live-document button.
 *
 * Creates a markup artifact (a blank report with ?mode=blank, otherwise the
 * existing agent placeholder) and hands back the ONE agent starter
 * (lib/agent-copy `existingPaste`), so the home page can give the user a paste
 * for a real, watchable document: they paste it to an agent, and the page they
 * are looking at fills in over the live stream.
 *
 * Creation requires an email account session or its approved CLI bearer.
 * No browser ownership cookie or bearer is issued by this route.
 */
import { auth } from '@/auth';
import { createArtifact } from '@/lib/artifacts';
import { existingPaste } from '@/lib/serving';
import { baseUrl, json, unauthorized } from '@/lib/http';
import { BLANK_REPORT_MARKUP, START_PLACEHOLDER_MARKUP } from '@artifactbin/contracts';
import { resolveToken } from '@/lib/accounts';
import { canAuthenticateUser } from '@/lib/accounts/user-kinds';
import { sessionActor } from '@/lib/accounts';
import { parseContentInput } from '@/lib/publish/document/input';

export async function POST(request: Request) {
  // A browser session takes precedence over an approved CLI bearer.
  // auth() can throw synchronously outside a request context.
  let userId: string | null = null;
  try {
    userId = (await auth())?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const bearer = offered ? await resolveToken(offered) : null;
  const actor = bearer ? null : await sessionActor(request);
  const ownerId = userId ?? bearer?.userId ?? actor?.viewer?.userId ?? null;
  const existingTokenId = bearer?.id ?? actor?.tokenId ?? '';
  if (!await canAuthenticateUser(ownerId)) return unauthorized(request);
  const tokenId = existingTokenId;
  const parsed = await parseContentInput({ markup: new URL(request.url).searchParams.get('mode') === 'blank' ? BLANK_REPORT_MARKUP : START_PLACEHOLDER_MARKUP }, {});
  if (parsed instanceof Response) return parsed; // unreachable: both starting documents are fixed and valid

  const row = await createArtifact(tokenId, ownerId, {
    ...parsed,
    // NULL, not 'Untitled': unnamed must stay distinguishable from named-that,
    // because an unnamed document follows its own heading (lib/document/title.ts)
    // and an explicit title never does.
    title: null,
    description: null,
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
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
