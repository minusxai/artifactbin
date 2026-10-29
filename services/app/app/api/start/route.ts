/**
 * POST /api/start — the zero-to-live-document button.
 *
 * Creates a native HTML document and hands back the ONE agent starter
 * (lib/agent-copy `existingPaste`), so the home page can give the user a paste
 * for a real, watchable document: they paste it to an agent, and the page they
 * are looking at fills in over the live stream.
 *
 * Creation requires an email account session or its approved CLI bearer.
 * No browser ownership cookie or bearer is issued by this route.
 */
import { createArtifact } from '@/lib/artifacts';
import { existingPaste } from '@/lib/agent-copy';
import { baseUrl, json, readJson, unauthorized } from '@/lib/http';
import {artifactStarter} from '@/lib/workspace/artifact-starters';
import {canUseDeploymentIdentity} from '@/lib/deployment';
import { canAuthenticateUser } from '@/lib/accounts';
import { requestOrSessionActor, sessionActor, withAccountToken } from '@/lib/accounts';
import { parseContentInput } from '@/lib/publish/document/input';
import {parseArtifactDestination} from '@/lib/artifacts';
import {DatasetError} from '@/lib/datasets/errors';

export async function POST(request: Request) {
  // A browser session takes precedence over a bearer; both are the original request identity
  // (lib/accounts request-identity). A session creates through the account's own token, as every browser create does.
  const session = await sessionActor(request);
  const actor = session.credential === 'session' ? session : await requestOrSessionActor(request);
  const creator = actor.userId ? await withAccountToken(actor) : null;
  if (!creator || !await canUseDeploymentIdentity(creator.userId) || !await canAuthenticateUser(creator.userId)) return unauthorized(request);
  const parsed = await parseContentInput(artifactStarter('doc'), {});
  if (parsed instanceof Response) return parsed; // unreachable: both starting documents are fixed and valid

  const body = await readJson(request, {allowEmpty:true});
  if (!body) return json({error:'invalid_json'},400);
  let row: Awaited<ReturnType<typeof createArtifact>>;
  try { row = await createArtifact(creator.tokenId, creator.userId, {
    ...parsed,
    meta: { ...parsed.meta, ...(new URL(request.url).searchParams.get('mode') !== 'blank' ? {startPlaceholder: true} : {}) },
    destination: parseArtifactDestination(body.destination),
    title: parsed.derivedTitle,
    description: parsed.derivedDescription??null,
  }); } catch(error) {
    if(error instanceof DatasetError)return json({error:'dataset_error',details:[error.message]},error.status);
    throw error;
  }

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
