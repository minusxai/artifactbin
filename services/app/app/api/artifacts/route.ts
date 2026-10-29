import { createArtifactFromBody } from '@/lib/publish/publish';
import { withTokenAuth } from '@/lib/authentication';
import { type TokenHoldingActor } from '@/lib/accounts';
import { runOperation } from '@/lib/operations/http';
import { PUBLISH_BODY_LIMIT, baseUrl, json, readJson } from '@/lib/http';
import { readFileUpload } from '@/lib/datasets/file-store';

/**
 * The one create path both auth modes share (bearer here, session in
 * app/api/my/artifacts). A `Content-Type: image/*` body is raw image bytes — a
 * clipboard paste or a `--data-binary` upload — with title/visibility riding
 * the query string, since there is no JSON envelope to carry them; that branch
 * is transport-only and stays here. `?format=file&filename=...` opts any MIME
 * type into the generic byte-preserving file tier. Other requests use the JSON content
 * body (markup | dataset | …), which is the `create_artifact` OPERATION
 * (lib/operations — the same pipeline every other create door runs).
 */
export async function createArtifactFromRequest(
  request: Request,
  actor: TokenHoldingActor,
): Promise<Response> {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const q = new URL(request.url).searchParams;
  const fileUpload = q.get('format') === 'file';
  if (fileUpload || contentType.startsWith('image/')) {
    const bytes = await readFileUpload(request);
    if (bytes instanceof Response) return bytes;
    // Transport decoding only. Validation, staging, quota and durable replay
    // belong to the same publication pipeline as JSON creates.
    const body = {
      ...(fileUpload ? {file:{filename:q.get('filename')??'',contentType:contentType||'application/octet-stream',base64:bytes.toString('base64')}}
        : {image:`data:${contentType};base64,${bytes.toString('base64')}`}),
      ...(q.has('title')?{title:q.get('title')}:{}),
      ...(q.has('visibility')?{visibility:q.get('visibility')}:{}),
    };
    return createArtifactFromBody(body,actor,baseUrl(request),request);
  }
  const body = await readJson(request, { limit: PUBLISH_BODY_LIMIT });
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('create_artifact', request, actor, body);
}

/** POST /api/artifacts — create from `markup`, a data tier, or raw image bytes; returns the shareable URL. */
export const POST = withTokenAuth((request: Request, { actor }) =>
  createArtifactFromRequest(request, actor),
);

/** GET /api/artifacts — the actor's list (whole account for a claimed token), newest first, no content. */
export const GET = withTokenAuth((request: Request, { actor }) =>
  runOperation('list_artifacts', request, actor, Object.fromEntries(new URL(request.url).searchParams)),
);
