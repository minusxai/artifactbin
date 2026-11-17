/**
 * POST /api/page/drafts — show the signed-in reader's own unpublished page (lib/page-drafts): `{html, entryPath?, title?,
 * files: [{path, base64, contentType?}]}` in, `{src, origin, appOrigin, revision: 'draft', limits}` out, where `src` is the
 * draft's own origin carrying a one-time ticket for its document. Nothing is stored, published or uploaded.
 * Same-origin only (the app's own pages and a shell at its address): a document or draft origin, another site or a
 * bearer without an Origin is refused. A refusal is `{error, message}` with a code the embedding app shows
 * (contracts DraftRefusalCode). Never cached.
 */
import { browserActor } from '@/lib/authentication';
import { draftOriginFor, json, pagesFrameUrl, pagesSite, PayloadTooLarge, PUBLISH_BODY_LIMIT, readJson } from '@/lib/http';
import { createDraft, DRAFT_LIMITS, DraftRefusal } from '@/lib/page-drafts';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const site = pagesSite();
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  if (!actor.userId) return json({ error: 'unauthorized', message: 'Sign in to show a draft.' }, 401, NO_STORE);
  if (request.headers.get('origin') !== site.app) return json({ error: 'forbidden', message: 'a draft is shown only by a page at the app\'s own address' }, 403, NO_STORE);
  let body: unknown;
  try { body = await readJson(request, { limit: PUBLISH_BODY_LIMIT }); }
  catch (error) { if (error instanceof PayloadTooLarge) return json({ error: 'draft_too_large', message: `the page and its files are over ${DRAFT_LIMITS.totalBytes} bytes` }, 413, NO_STORE); throw error; }
  try {
    const { label, ticket, entryPath } = await createDraft(actor.userId, body, site.app);
    const origin = draftOriginFor(label, site);
    const src = pagesFrameUrl(origin, '', ticket).replace(`${origin}/`, `${origin}/${entryPath.split('/').map(encodeURIComponent).join('/')}`);
    return json({ src, origin, appOrigin: site.app, revision: 'draft', limits: DRAFT_LIMITS }, 200, NO_STORE);
  } catch (error) {
    if (error instanceof DraftRefusal) return json({ error: error.code, message: error.message }, error.status, NO_STORE);
    throw error;
  }
}
