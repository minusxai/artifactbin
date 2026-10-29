import {hasImportedSourceObservation} from '../html-bridge/imported-observation';
import {createRuntimeAssetRetention} from '@/lib/html-runtime/asset-retention';
import {retainedRuntimeAssets} from '@/lib/html-runtime/asset-retention.server';
import type {RuntimeAssetRetention} from '@/lib/html-runtime/asset-retention-contract';
import {nativeHtmlAssets} from './native-html-assets.server';
import {nativeHtmlStructuralWrapper} from './native-html-structural-wrapper';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { etagOf, matchingTag, publicRevalidatedResponse } from '@/lib/http/revalidation';
const JS='application/javascript; charset=utf-8';
import type { ArtifactRow } from '@/lib/artifacts';
import type { HtmlRuntimeConfig } from '@/lib/html-runtime';
import { assembleHtmlPage, downloadableHtml } from '@/lib/html-runtime';
import { scriptFingerprint } from '@/lib/html-autofix';
import { buildHtmlAssets } from '@/lib/html-runtime/build.server';
import type { HtmlPageLink } from '@artifactbin/contracts';
import { buildDocumentCsp, markupCsp,appendCspExtensions } from '@/lib/page-styles';

import {EMPTY_CSP_EXTENSIONS,type CspExtensions} from '@/lib/document';
import { ASSETS_ORIGIN } from '@/lib/platform';
import { PLATFORM_FONTS_PATH, PLATFORM_STYLES_PATH, htmlSystemsCss, isHtmlSystem } from '@/lib/html-systems';
import {libraryImports} from '@/lib/libraries';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

/** Inputs from one permission-checked immutable version. No credentials belong here. */
export interface NativeHtmlRender {
  row: Pick<ArtifactRow, 'id' | 'version' | 'source' | 'meta'>;
  appOrigin?: string;
  offline?: boolean;
  /** The owner's saved design system (page metadata), which wins over the page's own meta. */
  designSystem?: string | null;
  /** Offline asset-packed rendering, independent of canonical stored source. */
  renderedHtml?: string;
  /** The platform script nonce; a cached render passes its placeholder (lib/serving/render-cache), else a fresh one is drawn. */
  platformScriptNonce?: string;
  /** Served on a custom domain: the page reads its data from that host (html-runtime/domain-reads). */
  domainReads?: boolean;
}
export interface NativeHtmlDocument { html: string; config: HtmlRuntimeConfig }

// Only code is cached. ACL, source, bindings and viewer state are never retained here.
let assets:ReturnType<typeof buildHtmlAssets>|undefined,retention:RuntimeAssetRetention|undefined;
const htmlAssets=()=>assets??=buildHtmlAssets().then(current=>{
 retention=createRuntimeAssetRetention(current,retainedRuntimeAssets,source=>createHash('sha256').update(source).digest('hex'));
 return retention.expose();
}).catch(error=>{assets=undefined;retention=undefined;throw error;});
function htmlCore(): Promise<string> {
  return htmlAssets().then(assets=>assets.core);
}
export async function nativeHtmlDocument(input: NativeHtmlRender): Promise<NativeHtmlDocument> {
  const links=(input.row.meta as {htmlLinks?:readonly HtmlPageLink[]}).htmlLinks??[];
  const config:HtmlRuntimeConfig={...(hasImportedSourceObservation(input.row)?{annotationObservation:'imported-source-v1' as const}:{}),pageId:input.row.id,revision:String(input.row.version),backends:links.map(link=>link.name),bindings:Object.fromEntries(links.map(link=>[link.name,link.kind==='backend'?link.backendId:link.datasetId])),...(input.appOrigin?{appOrigin:new URL(input.appOrigin).origin}:{}),...(input.domainReads&&!input.offline?{domainReads:true as const}:{}),...(input.offline?{}:{libraries:libraryImports((input.row.meta as {htmlLibraries?:unknown}).htmlLibraries)})};
  const source=input.row.source??'';
  const stored=(input.row.meta as {htmlScriptFingerprint?:unknown}).htmlScriptFingerprint;
  config.scriptFingerprint=typeof stored==='string'?stored:scriptFingerprint(source);
  const portable={version:1 as const,source,...(input.appOrigin?{identity:{platformOrigin:new URL(input.appOrigin).origin,artifactId:input.row.id,baseRevision:String(input.row.version),sourceDigest:createHash('sha256').update(source).digest('hex'),dependencyIdentity:config.bindings}}:{})};
  const rendered=input.offline?input.renderedHtml??source:await nativeHtmlAssets(input.row);
  const assembly={platformScriptNonce:input.platformScriptNonce??randomUUID().replaceAll('-',''),portable,html:nativeHtmlStructuralWrapper(rendered),config,core:await htmlCore(),systemsHref:PLATFORM_STYLES_PATH,designSystem:input.designSystem??null,...(input.offline?{apollo:(await htmlAssets()).apollo,reader:(await htmlAssets()).reader,chrome:(await htmlAssets()).chrome,portableEngine:(await htmlAssets()).portableEngine}:{})};
  return {html:input.offline?downloadableHtml(assembly):assembleHtmlPage(assembly),config};
}
/** Inline author code is confined to the per-page origin, or the opaque /raw sandbox. */
export function nativeHtmlPolicy(id:string,base:string,pages?:{self:string;app:string},extensions:CspExtensions=EMPTY_CSP_EXTENSIONS,options:{domainReads?:boolean}={}):string {
  if (!pages){
    // The opaque raw reader may load only this page's admission-checked linked
    // stylesheets, the platform stylesheet and its hosted fonts (an opaque origin has no 'self'); do not grant the application's other paths as style sources.
    const assets=new URL(`/a/${id}/assets`,base).href,systems=new URL(PLATFORM_STYLES_PATH,base).href;
    // On a custom domain the page reads its data from that host's page GraphQL endpoint (html-runtime/domain-reads); nowhere else.
    const reads=options.domainReads?` ${new URL(`/api/artifacts/${encodeURIComponent(id)}/graphql`,base).href}`:'';
    return appendCspExtensions(markupCsp(base,id,ASSETS_ORIGIN??undefined).replace(/style-src ([^;]+)/,`style-src $1 ${assets} ${systems}`).replace(/font-src ([^;]+)/,`font-src $1 ${new URL(PLATFORM_FONTS_PATH,base).href} ${new URL('/fonts/',base).href}`).replace(/connect-src ([^;]+)/,`connect-src $1${reads}`),extensions);
  }
  return buildDocumentCsp({self:pages.self,app:pages.app,id,assetOrigin:ASSETS_ORIGIN,extensions}).replace(/script-src ([^;]+)/,"script-src 'unsafe-inline' $1");
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
  return coreIdentity ??= htmlAssets().then(({core,systems}) => {
    // Production is one emitted server bundle: its digest also names the assembler
    // and route code. Unbundled module reloads get a new cache identity.
    const file = fileURLToPath(import.meta.url);
    const implementation = /\.[cm]?js$/.test(file)
      ? createHash('sha256').update(readFileSync(file)).digest('hex') : `unbundled:${randomUUID()}`;
    return etagOf({ core, systems: systems ? createHash('sha256').update(systems).digest('hex') : null, implementation });
  }).catch(error => { coreIdentity = undefined; throw error; });
}

/** Public code only: no page, viewer, cookie or credential is an input to these bytes. /af/core.js and its /af/v1 alias. */
export async function nativeHtmlCoreResponse(request:Request):Promise<Response>{
 return publicRevalidatedResponse(request,await htmlCore(),JS);
}

/** A flat runtime module (D17: /af/apollo.js, /af/reader.js, /af/chrome.js, /af/portable.js, /af/morph.js), always this build's bytes. */
export type NativeHtmlModule='apollo'|'reader'|'chrome'|'portableEngine'|'morph';
export async function nativeHtmlModuleResponse(request:Request,module:NativeHtmlModule):Promise<Response>{
 const source=(await htmlAssets())[module];
 if(!source)return new Response('Not found',{status:404});
 return publicRevalidatedResponse(request,source,JS);
}

/** The pre-D17 content-addressed alias (/af/v1/apollo|reader/<sha256>): exact retained bytes, so pages opened before a deploy keep loading. */
export async function nativeHtmlApolloResponse(request:Request,digest:string):Promise<Response>{
 await htmlAssets();
 const source=await retention!.read(digest);
 if(source===null)return new Response('Not found',{status:404});
 const headers={'content-type':JS,'cache-control':'public, max-age=31536000, immutable','access-control-allow-origin':'*','x-content-type-options':'nosniff','etag':`"${digest}"`};
 if(matchingTag(request.headers.get('if-none-match'),headers.etag))return new Response(null,{status:304,headers});
 return new Response(request.method==='HEAD'?null:source,{headers});
}

/** Same public, digest-verified code store and cache policy as the author engine. */
export async function nativeHtmlReaderResponse(request:Request,digest:string):Promise<Response>{return nativeHtmlApolloResponse(request,digest);}

/** The platform stylesheet (lib/html-systems) at its one stable address: public, revalidated on every load by its content hash.
 * `?system=NAME` answers that one system's sheet (what an offline copy or the skill's local preview inlines). */
export async function nativeHtmlSystemsResponse(request:Request):Promise<Response>{
 const system=new URL(request.url).searchParams.get('system');
 if(system!==null)return isHtmlSystem(system)?publicRevalidatedResponse(request,htmlSystemsCss([system]),'text/css; charset=utf-8'):new Response('Not found',{status:404});
 const {systems}=await htmlAssets();
 if(!systems)return new Response('Not found',{status:404});
 return publicRevalidatedResponse(request,systems,'text/css; charset=utf-8');
}
