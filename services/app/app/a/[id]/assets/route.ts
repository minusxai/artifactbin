/**
 * `GET /a/<id>/assets?u=<url>` — one document's FIRST-REQUEST asset import.
 *
 * Publish fetches every external URL a document NAMES. It cannot fetch the ones
 * a reader computes — a bound `<img src="$pick">`, a template a pick completes,
 * a column of logos, a line of author script — because they do not exist until
 * somebody is reading. Those arrive here instead, on the first view that needs
 * them, and are cached globally like every other URL (lib/web-assets).
 *
 * WHY THIS IS NOT AN OPEN IMAGE PROXY, which is the whole reason it is
 * per-document rather than global:
 *   1. the document must EXIST and be READABLE by this caller — a uniform 404,
 *      answered BEFORE anything is fetched, so an id cannot even be probed;
 *   2. a per-document hourly fetch ATTEMPT allowance (lib/auth) — probing is
 *      the abuse shape, and probes fail, so attempts are what is counted;
 *   3. the SSRF guard: private, reserved and link-local addresses refused, with
 *      its own DNS lookup re-run on every redirect (lib/web-ingest);
 *   4. image-only, decided by the BYTES, never by a remote Content-Type;
 *   5. the byte cap, streamed and destroyed at it.
 * And the upstream body is NEVER returned: the answer is a redirect to the
 * content-addressed `/assets/<hash>`, so the only bytes this can ever serve are
 * ones the sniffer approved and we stored.
 *
 * This route is a TRANSLATION LAYER. The read ACL is asked here rather than
 * inside lib/web-assets because lib/artifacts imports that module — the door a
 * document is admitted through belongs with every other door in the app, and
 * the import bounds belong with the importer.
 */
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { verifyExportKey } from '@/lib/export-key';
import { sessionActor } from '@/lib/viewer';
import { importForDocument, WebAssetRefused, WEB_ASSET_KINDS, type WebAssetKind } from '@/lib/web-assets';
import { ASSETS_ORIGIN } from '@/lib/config';
import {publicRefAsset} from '@/lib/public-ref-assets';
import { json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const managed = params.has('kind');
  const headers:Record<string,string>={'Cache-Control':'no-store',...(managed?{'Access-Control-Allow-Origin':'*'}:{})};
  const reply=(body:unknown,status:number)=>json(body,status,headers);
  const missing=()=>new Response('not found',{status:404,headers});
  const url = params.get('u');
  if (!url) return reply({ error: 'missing_url' }, 400);

  // The uniform 404 — an unreachable id and an unreadable one are the same
  // answer, before any fetch, exactly as every other read of a document is.
  const artifact = await getArtifactById(id);
  if (!artifact) return missing();
  const { viewer } = await sessionActor(request);
  // …and the exporter's own credential, on exactly the terms `raw` admits it:
  // a signed, seconds-long key scoped to THIS artifact. The capture runs in a
  // headless browser with no session, so without this a private document's
  // export photographs alt text where its picture should be.
  const key = params.get('key');
  const admitted = (await canReadArtifact(artifact, viewer)) || verifyExportKey(artifact.id, key ?? undefined);
  if (!admitted) return missing();

  const kind = params.get('kind') ?? 'image';
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  if (managed && (!wantsJson || params.getAll('kind').length !== 1 || !WEB_ASSET_KINDS.includes(kind as WebAssetKind))) return reply({error:'invalid_asset_kind'},400);
  if (managed && !ASSETS_ORIGIN) return reply({error:'assets_origin_required'},503);
  if(managed && url.startsWith('ref:')) {
    const row=await publicRefAsset(url.slice(4),kind as WebAssetKind);
    return row ? reply({url:ASSETS_ORIGIN+'/assets/ref/'+row.id},200) : missing();
  }

  try {
    const location = await importForDocument(artifact, url,kind as WebAssetKind);
    /*
     * TWO ANSWERS, ONE IMPORT. An `<img>` gets a 302 and the browser follows
     * it — one request, and the bytes are never this response's. The PAGE,
     * relaying for a framed document that cannot present a session
     * (lib/story-runtime/contract STORY_ASSET_MESSAGE), asks with
     * `Accept: application/json` and gets the address to hand back instead.
     *
     * The header rather than a `format=` param because an `<img>` can never
     * send it — it asks for `image/*` — so the two answers cannot be confused
     * for one another, and the endpoint grows no second URL shape.
     */
    if (wantsJson) return reply({ url: managed ? new URL(location,ASSETS_ORIGIN!).href : location }, 200);
    // Never the bytes: this cannot be used to read a response the caller could
    // not have fetched for themselves.
    return new Response(null, { status: 302, headers: { Location: location } });
  } catch (error) {
    if (error instanceof WebAssetRefused) {
      // A refusal an agent never sees — nothing was published — so it is the
      // RUNTIME that has to say something: the image goes to its alt text with
      // `data-mx-asset="refused"` (lib/story-runtime/StoryRuntimeApp).
      const status = error.code === 'rate_limited' ? 429 : 400;
      return reply({ error: status === 429 ? 'rate_limited' : 'asset_fetch_failed', code: error.code, details: [error.message] }, status);
    }
    throw error;
  }
}
