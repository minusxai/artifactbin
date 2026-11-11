import {designSystemChoice} from '@/lib/html-systems';
import {withOfflineSystemStyle} from '@/lib/html-systems/server';
import {packOfflineDependencies,type OfflineDependencyInput} from '@/lib/offline-dependencies';
import {loadBundleAssetResources,publishedFileTable,type PublicationRecord} from '@/lib/html-publication-bundle';
import {referencedBoundaryFiles,referencedLibraryResources} from '@/lib/libraries/server';
/**
 * The offline file: one self-contained `.html` a reader can open without a
 * network and pass on. Assembly and access live in lib/offline/assemble.server
 * (the same read rule as viewing); this door only answers in HTTP. A refusal
 * the caller may not learn about is the uniform 404 every read door gives.
 */
import {packOfflineHtmlImages,OfflineHtmlMediaError} from '@/lib/export';
import {loadImage} from '@/lib/object-store';
import { requestOrSessionActor } from '@/lib/authentication';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { getArtifactById, refusingUnservable, canReadArtifact, archivedVersionFor, servedRow } from '@/lib/artifacts';
import { holdsCreatingToken } from '@/lib/artifact-access';
import { nativeHtmlDocument, nativeHtmlTitle } from '@/lib/document-serving';
import { offlinePageSqlData } from '@/lib/dataset-access';
import type { HtmlPageLink, HtmlDatasetLink } from '@artifactbin/contracts';

const OFFLINE_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** The most the rows an offline copy's `sql` reads (lib/dataset-access offline-sql) may take; past it the copy carries none. */
const OFFLINE_SQL_DATA_MAX_BYTES = 16 * 1024 * 1024;

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
    if (!holdsCreatingToken(artifact, actor) && !await canReadArtifact(artifact, actor)) return json({ error: 'not_found' }, 404);
    const at = await archivedVersionFor(request, artifact, async () => actor);
    if (at === 'not_found') return json({ error: 'not_found' }, 404);
    const platformOrigin=new URL(baseUrl(request)).origin;
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
    let resources:Array<OfflineDependencyInput['resources'][number]>;
    try{resources=await loadBundleAssetResources(request,actor,id);}catch{return json({error:'not_found'},404);}
    // A script's fetch of a file the page published reads it from disk too (html-runtime page-fetch): the copy carries the
    // bytes this reader was just admitted to, or, past the size limit, the file's address on the platform.
    const published=new Map(resources.map(resource=>[resource.url,resource]));
    // The platform's boundary files the page fetches by their path (/geojson/NAME.json) ride in the same table.
    const boundaries=await referencedBoundaryFiles([row.source??'',...resources.filter(resource=>/javascript/.test(resource.contentType)).map(resource=>Buffer.from(resource.bytes).toString('utf8'))]);
    const files=(embed:boolean)=>{
      const table={...publishedFileTable(row.meta as PublicationRecord,id,row.version,receipt=>{
        const resource=published.get(`/a/${id}/assets?dependency=${receipt.id}&revision=${receipt.revision}`);if(!resource)return null;
        return embed?`data:${resource.contentType.split(';')[0]!.trim()||'application/octet-stream'};base64,${Buffer.from(resource.bytes).toString('base64')}`:`${platformOrigin}/a/${id}/assets?dependency=${receipt.id}&revision=${receipt.revision}&version=${row.version}`;
      }),...Object.fromEntries(Object.entries(boundaries).map(([url,bytes])=>[url,embed?`data:application/json;base64,${Buffer.from(bytes).toString('base64')}`:platformOrigin+url]))};
      return Object.keys(table).length?table:undefined;
    };
    try{resources.push(...await referencedLibraryResources(packed,resources,request.url));}catch{return json({error:'offline_dependency_unavailable'},422);}
    // The platform stylesheet, active system only: its rules inline, its fonts embedded by the packer.
    try{const styled=withOfflineSystemStyle(packed,request.url,designSystemChoice(artifact.meta));packed=styled.html;resources.push(...styled.resources);}catch{return json({error:'offline_dependency_unavailable'},422);}
    // A link to a file the page published works from disk: the copy carries the file (bytes this reader was just
    // admitted to above), or, past the size limit, names the file on the platform, whose door checks every reader.
    const unpacked=packed,pack=async(embed:boolean)=>resources.length?(await packOfflineDependencies({html:unpacked,baseUrl:new URL(request.url).href,resources,links:{embed,origin:platformOrigin}})).html:unpacked;
    try{packed=await pack(true);}catch{return json({error:'offline_dependency_unavailable'},422);}
    // What this reader's `sql` could read through the page, carried so the copy computes its own tables offline.
    const links=((row.meta as {htmlLinks?:readonly HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
    const offlineData=await offlinePageSqlData(actor,links,id,OFFLINE_SQL_DATA_MAX_BYTES,request.signal).catch(()=>null);
    let embedded=true;
    const render=(data:typeof offlineData)=>nativeHtmlDocument({ row, renderedHtml:packed, appOrigin:platformOrigin, offline: true, designSystem:designSystemChoice(artifact.meta), files:files(embedded), ...(data?{offlineData:data}:{}) });
    const tooLarge=(value:string)=>Buffer.byteLength(value)>OFFLINE_FILE_MAX_BYTES;
    let { html } = await render(offlineData);
    // A copy too large with its linked files is the copy that links them, and one still too large with its data is
    // that copy without the data.
    if (tooLarge(html)) {
      try{packed=await pack(false);}catch{return json({error:'offline_dependency_unavailable'},422);}
      embedded=false;
      ({ html } = await render(offlineData));
      if (offlineData && tooLarge(html)) ({ html } = await render(null));
    }
    if (tooLarge(html)) return json({ error: 'too_large' }, 413);
    const name = fileName(nativeHtmlTitle(row));
    return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    } });
  }
  return json({ error: 'not_found' }, 404);
}
