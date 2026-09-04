import { parseVisibilityValue } from '@/lib/artifact-wire';
import { artifactQuotaExceeded, createArtifact, type Visibility } from '@/lib/artifacts';
import { assetByteQuotaExceeded } from '@/lib/asset-quota';
import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { baseUrl, json, readJson } from '@/lib/http';
import { storeImageContent } from '@/lib/story/data-tiers';
import { imageRawUrl } from '@/lib/story/ref-data';

/**
 * The one create path both auth modes share (bearer here, session in
 * app/api/my/artifacts). A `Content-Type: image/*` body is raw image bytes — a
 * clipboard paste or a `--data-binary` upload — with title/visibility riding
 * the query string, since there is no JSON envelope to carry them; that branch
 * is transport-only and stays here. Any other content type is the JSON content
 * body (markup | dataset | …), which is the `create_artifact` OPERATION
 * (lib/operations — the same pipeline the MCP tool runs).
 */
export async function createArtifactFromRequest(
  request: Request,
  { tokenId, userId }: { tokenId: string; userId: string | null },
): Promise<Response> {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType.startsWith('image/')) {
    // Two caps, two questions: how many artifacts this token holds, and how
    // many BYTES its owner has caused to be stored (lib/asset-quota, R9 — the
    // account's when the token has one). The JSON body asks the second through
    // `ContentInputCtx.overByteQuota`; this branch never goes through that
    // door, so it asks here, before the bytes are read into memory.
    if (await artifactQuotaExceeded(tokenId)) return json({ error: 'quota_exceeded' }, 403);
    if (await assetByteQuotaExceeded(tokenId)) {
      return json({ error: 'quota_exceeded', details: ['this account is over its stored-byte quota — delete assets you no longer need'] }, 403);
    }
    const stored = await storeImageContent(Buffer.from(await request.arrayBuffer()), contentType);
    if (stored instanceof Response) return stored;
    const q = new URL(request.url).searchParams;
    const v = parseVisibilityValue(q.get('visibility'), !!userId);
    if (v instanceof Response) return v;
    const visibility: Visibility | undefined = v;
    const row = await createArtifact(tokenId, userId, {
      ...stored,
      title: q.get('title'),
      description: null,
      ...(visibility ? { visibility } : {}),
    });
    return json({
      id: row.id, url: `${baseUrl(request)}/a/${row.id}`, version: row.version, visibility: row.visibility,
      edit_id: row.edit_id,
      format: row.format, title: row.title,
      markup: row.source,
      rawUrl: imageRawUrl(row.id, row.version),
    }, 201);
  }
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('create_artifact', request, { tokenId, userId }, body);
}

/** POST /api/artifacts — create from `markup`, a data tier, or raw image bytes; returns the shareable URL. */
export const POST = withTokenAuth((request: Request, { tokenId, userId }) =>
  createArtifactFromRequest(request, { tokenId, userId }),
);

/** GET /api/artifacts — the actor's list (whole account for a claimed token), newest first, no content. */
export const GET = withTokenAuth((request: Request, { tokenId, userId }) =>
  runOperation('list_artifacts', request, { tokenId, userId }, {}),
);
