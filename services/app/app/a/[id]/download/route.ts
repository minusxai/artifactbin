import {packOfflineDependencies} from '@/lib/offline-dependencies';
import {loadBundleAssetResources} from '@/lib/html-publication-bundle';
/**
 * The offline file: one self-contained `.html` a reader can open without a
 * network and pass on. Assembly and access live in lib/offline/assemble.server
 * (the same read rule as viewing); this door only answers in HTTP. A refusal
 * the caller may not learn about is the uniform 404 every read door gives.
 */
import {packOfflineHtmlImages,OfflineHtmlMediaError} from '@/lib/export';
import {loadImage} from '@/lib/object-store/image-store';
import { requestOrSessionActor } from '@/lib/accounts';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { getArtifactById, refusingUnservable, canReadArtifact, archivedVersionFor, servedRow } from '@/lib/artifacts';
import { nativeHtmlDocument, nativeHtmlTitle } from '@/lib/serving/native-html.server';

const OFFLINE_FILE_MAX_BYTES = 25 * 1024 * 1024;

/** A filename every OS accepts, from the document's title. */
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'artifact'}.html`;

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return refusingUnservable(() => download(request, ctx));
}

async function download(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const artifact=await getArtifactById(id);
  if (artifact?.format === 'html') {
    const actor = await requestOrSessionActor(request);
    if (actor.tokenId !== artifact.token_id && !await canReadArtifact(artifact, actor)) return json({ error: 'not_found' }, 404);
    const at = await archivedVersionFor(request, artifact);
    if (at === 'not_found') return json({ error: 'not_found' }, 404);
    const row = { ...servedRow(artifact, at), version: at?.version ?? artifact.version };
    let packed:string;
    try{
      packed=await packOfflineHtmlImages({html:row.source??'',admittedIds:((row.meta as {refs?:Array<{id:string}>}).refs??[]).map(ref=>ref.id),maxBytes:OFFLINE_FILE_MAX_BYTES,
        loadImage:async id=>{
          const image=await getArtifactById(id);
          if(image?.format!=='image'||!await canReadArtifact(image,actor))return null;
          const stored=await loadImage(image);return stored?{bytes:stored.body,mime:stored.contentType}:null;
        }});
    }catch(error){
      if(!(error instanceof OfflineHtmlMediaError))throw error;
      return error.reason==='too_large'?json({error:'too_large'},413):error.reason==='unsupported_type'?json({error:'unsupported_image'},415):json({error:'not_found'},404);
    }
    let resources:Awaited<ReturnType<typeof loadBundleAssetResources>>;
    try{resources=await loadBundleAssetResources(request,actor,id);}catch{return json({error:'not_found'},404);}
    if(resources.length){try{packed=(await packOfflineDependencies({html:packed,baseUrl:new URL(request.url).href,resources})).html;}catch{return json({error:'offline_dependency_unavailable'},422);}}
    const { html } = await nativeHtmlDocument({ row, renderedHtml:packed, appOrigin:new URL(baseUrl(request)).origin, offline: true });
    if (Buffer.byteLength(html) > OFFLINE_FILE_MAX_BYTES) return json({ error: 'too_large' }, 413);
    const name = fileName(nativeHtmlTitle(row));
    return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    } });
  }
  return json({ error: 'not_found' }, 404);
}
