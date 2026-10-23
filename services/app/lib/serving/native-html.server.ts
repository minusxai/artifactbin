import {nativeHtmlAssets} from './native-html-assets.server';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { etagOf, matchingTag } from '@/lib/http/revalidation';
import type { ArtifactRow } from '@/lib/artifacts';
import type { HtmlRuntimeConfig } from '@/lib/html-runtime';
import { assembleHtmlPage, downloadableHtml } from '@/lib/html-runtime';
import { buildHtmlCore } from '@/lib/html-runtime/build.server';
import type { HtmlPageLink } from '@artifactbin/contracts';
import { buildDocumentCsp, markupCsp } from '@/lib/page-styles';
import { ASSETS_ORIGIN } from '@/lib/platform';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

/** Inputs from one permission-checked immutable version. No credentials belong here. */
export interface NativeHtmlRender {
  row: Pick<ArtifactRow, 'id' | 'version' | 'source' | 'meta'>;
  appOrigin?: string;
  offline?: boolean;
}
export interface NativeHtmlDocument { html: string; config: HtmlRuntimeConfig }

// Only code is cached. ACL, source, bindings and viewer state are never retained here.
let core: Promise<string> | undefined;
function htmlCore(): Promise<string> {
  return core ??= buildHtmlCore().catch((error) => { core = undefined; throw error; });
}
export async function nativeHtmlDocument(input: NativeHtmlRender): Promise<NativeHtmlDocument> {
  const links=(input.row.meta as {htmlLinks?:readonly HtmlPageLink[]}).htmlLinks??[];
  const config:HtmlRuntimeConfig={pageId:input.row.id,revision:String(input.row.version),backends:links.map(link=>link.name),bindings:Object.fromEntries(links.map(link=>[link.name,link.kind==='backend'?link.backendId:link.datasetId])),...(input.appOrigin?{appOrigin:new URL(input.appOrigin).origin}:{})};
  const assembly={html:input.offline?input.row.source??'':await nativeHtmlAssets(input.row),config,core:await htmlCore()};
  return {html:input.offline?downloadableHtml(assembly):assembleHtmlPage(assembly),config};
}
/** Inline author code is confined to the per-page origin, or the opaque /raw sandbox. */
export function nativeHtmlPolicy(id:string,base:string,pages?:{self:string;app:string}):string {
  if (!pages)return markupCsp(base,id,ASSETS_ORIGIN??undefined);
  return buildDocumentCsp({self:pages.self,app:pages.app,id,assetOrigin:ASSETS_ORIGIN}).replace(/script-src ([^;]+)/,"script-src 'unsafe-inline' $1");
}
/** Stored metadata wins; native head text supplies the same first-paint name for older heads. */
export function nativeHtmlTitle(row:Pick<ArtifactRow,'title'|'source'>):string {
  if (row.title)return row.title;
  const document=parse(row.source??'');
  const text=(node:DefaultTreeAdapterMap['node']):string=>node.nodeName==='#text'?(node as DefaultTreeAdapterMap['textNode']).value:'childNodes' in node?node.childNodes.map(text).join(''):'';
  const title=(node:DefaultTreeAdapterMap['node']):string=>node.nodeName==='title'?text(node):'childNodes' in node?node.childNodes.map(title).find(Boolean)??'':'';
  return title(document).trim()||'Document';
}

/** Immutable core bytes identify the runtime without assembling or reading a page. */
let coreIdentity: Promise<string> | undefined;
export function nativeHtmlRuntimeIdentity(): Promise<string> {
  return coreIdentity ??= htmlCore().then(core => {
    // Production is one emitted server bundle: its digest also names the assembler
    // and route code. Unbundled module reloads get a new cache identity.
    const file = fileURLToPath(import.meta.url);
    const implementation = /\.[cm]?js$/.test(file)
      ? createHash('sha256').update(readFileSync(file)).digest('hex') : `unbundled:${randomUUID()}`;
    return etagOf({ core, implementation });
  }).catch(error => { coreIdentity = undefined; throw error; });
}

/** Public code only: no page, viewer, cookie or credential is an input to these bytes. */
export async function nativeHtmlCoreResponse(request:Request):Promise<Response>{
 const source=await htmlCore(),etag=etagOf({core:source});
 const headers:Record<string,string>={'content-type':'application/javascript; charset=utf-8','cache-control':'public, max-age=0, must-revalidate','etag':etag,'x-content-type-options':'nosniff','access-control-allow-origin':'*'};
 if(matchingTag(request.headers.get('if-none-match'),etag))return new Response(null,{status:304,headers});
 headers['content-length']=String(new TextEncoder().encode(source).byteLength);
 return new Response(request.method==='HEAD'?null:source,{headers});
}
