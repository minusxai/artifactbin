/** Fixed auth-owner image seam (contracts CANONICAL_ARTIFACT_IMAGE_PATH), behind identity's public internal-path
 * refusal. The caller is the verified human of an artifact read grant. The canonical read seam's own decision runs
 * first (absent and inaccessible alike answer 404), then the export door's dataset rule, then the one export path
 * with that person as the reader: the capture reads data as them and the stored render is theirs. The image is fitted
 * under ARTIFACT_IMAGE_BYTES in the asked format and answered as an ArtifactImage, inside a deadline the identity
 * owner's bound covers. Refusals keep the export door's codes and details.
 */
import {ARTIFACT_IMAGE_BYTES,type Actor,type ArtifactImage} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody} from '@artifactbin/utils';
import {ID_RE} from '@/lib/platform';
import {identityForUser} from '@/lib/accounts';
import {readArtifactSnapshot} from '@/lib/annotations';
import {withReadOnlyAccessFacts} from '@/lib/artifact-access';
import {getArtifactById} from '@/lib/artifacts';
import {liveConnectionOf} from '@/lib/datasets';
import {datasetExportable,datasetReadAccess} from '@/lib/dataset-permissions';
import {exportImageResponse,fitImage} from '@/lib/export';
import {json} from '@/lib/http';

/** The render's share of identity's 25 s bound: the decision, the fit and identity's recheck take the rest. */
const ARTIFACT_IMAGE_RENDER_MS = 18_000;
const KEYS = ['artifact_id', 'format', 'element', 'slide'];
const notFound = () => json({error: 'not_found'}, 404);

export async function canonicalArtifactImage(request: Request, caller: Actor | null | undefined, base: string): Promise<Response> {
  if (caller?.credential !== 'session' || !caller.userId || caller.tokenId || caller.sessionId) return json({error: 'forbidden'}, 403);
  const deadline = Date.now() + ARTIFACT_IMAGE_RENDER_MS;
  let input: Record<string, unknown>;
  try { input = JSON.parse(await readBody(request, {limit: 4096, as: 'text'})); } catch (error) {
    return error instanceof BodyTooLargeError ? json({error: 'too_large'}, 413) : json({error: 'bad_request'}, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !KEYS.includes(key))) return json({error: 'bad_request'}, 400);
  const {artifact_id: id, format = 'png', element, slide} = input;
  if (typeof id !== 'string' || !ID_RE.test(id)) return notFound();
  if (typeof format !== 'string' || element !== undefined && typeof element !== 'string'
    || slide !== undefined && !(Number.isSafeInteger(slide) && Number(slide) > 0)) return json({error: 'bad_request'}, 400);
  const actor = identityForUser(caller.userId);
  return withReadOnlyAccessFacts(async () => {
    // The canonical read seam's decision, as is: what this person may read now.
    if (!await readArtifactSnapshot(actor, id, base, {currentReadOnly: true})) return notFound();
    const artifact = await getArtifactById(id);
    if (!artifact) return notFound();
    // A dataset's image renders every row: only for a role that sees it whole, never a live one (the export door's rule).
    if (artifact.format === 'dataset' && (liveConnectionOf(artifact.meta) || !datasetExportable(await datasetReadAccess(artifact, actor)))) return notFound();
    const rendered = await exportImageResponse(artifact, {
      reader: actor, format, deadline,
      ...(typeof element === 'string' ? {element} : {}),
      ...(slide !== undefined ? {slide: String(slide)} : {}),
    }, base);
    if (!rendered.ok || !rendered.headers.get('content-type')?.startsWith('image/')) return rendered;
    const asked = format as 'png' | 'jpg';
    const fitted = await fitImage(Buffer.from(await rendered.arrayBuffer()), asked);
    if (!fitted.ok) return json({error: 'too_large', bytes: fitted.bytes, width: fitted.width, height: fitted.height, max: ARTIFACT_IMAGE_BYTES,
      hint: `the image is ${fitted.bytes} bytes at ${fitted.width}x${fitted.height}, past ${ARTIFACT_IMAGE_BYTES} even at its narrowest; ask for one element or slide, or jpg`}, 413);
    const answer: ArtifactImage = {id: artifact.id, version: artifact.version, format: asked, mime: asked === 'png' ? 'image/png' : 'image/jpeg',
      width: fitted.width, height: fitted.height, bytes: fitted.bytes.length, data: fitted.bytes.toString('base64')};
    return json(answer, 200, {'cache-control': 'no-store'});
  });
}
