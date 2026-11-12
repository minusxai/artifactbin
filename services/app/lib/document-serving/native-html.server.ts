import {nativeCodeHtml} from './native-code-html';
import {hasImportedSourceObservation} from '../html-bridge';
import {type HtmlAssemblyInput, type HtmlRuntimeConfig, assembleHtmlPage, downloadableHtml} from '@/lib/html-runtime';
import {buildHtmlAssets} from '@/lib/html-runtime/server';
import {nativeHtmlAssets} from './native-html-assets.server';
import {nativeHtmlStructuralWrapper} from './native-html-structural-wrapper';
import {publishedFileTable,type PublicationRecord} from '@/lib/html-publication-bundle';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { etagOf, publicRevalidatedResponse } from '@/lib/http';
const JS='application/javascript; charset=utf-8';
import type { ArtifactRow } from '@/lib/artifacts';
import { scriptFingerprint } from '@/lib/html-autofix';
import type { HtmlPageLink } from '@artifactbin/contracts';
import { buildDocumentCsp, markupCsp,appendCspExtensions } from '@/lib/page-styles';

import {EMPTY_CSP_EXTENSIONS,type CspExtensions} from '@/lib/document';
import {declaredCspExtensions} from '@/lib/trust';
import { ASSETS_ORIGIN, embedTrustedOrigins } from '@/lib/platform';
import { PLATFORM_FONTS_PATH, PLATFORM_STYLES_PATH, htmlSystemsCss, isHtmlSystem } from '@/lib/html-systems';
import {libraryImports} from '@/lib/libraries';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

/** Inputs from one permission-checked immutable version. No credential belongs here but `captureKey`, for that one response. */
export interface NativeHtmlRender {
  row: Pick<ArtifactRow, 'id' | 'version' | 'source' | 'meta'>;
  appOrigin?: string;
  offline?: boolean;
  /** The owner's saved design system (page metadata), which wins over the page's own meta. */
  designSystem?: string | null;
  /** Offline asset-packed rendering, independent of canonical stored source. */
  renderedHtml?: string;
  /** The platform script nonce; a cached render passes its placeholder (lib/document-serving/render-cache), else a fresh one is drawn. */
  platformScriptNonce?: string;
  /** Served on a anonymous owner host: the page reads its data from that host (html-runtime/domain-reads). */
  domainReads?: boolean;
  /** The head's live revision (lib/artifacts current-page): the frame orders live states by it within a version. */
  live?: number;
  /** Ids the live composition gave blocks typed since the last save: provisional, so never offered as anchors. */
  unsavedIds?: ReadonlySet<string>;
  /** Offline only: the rows the downloading reader's `sql` reads (lib/dataset-access offlinePageSqlData), with the engine that answers them. */
  offlineData?: HtmlAssemblyInput['offlineData'];
  /** Offline only: where the copy reads each file its page published (its bytes, or the platform's door); served pages derive it. */
  files?: Readonly<Record<string, string>>;
  /**
   * The exporter's capture only (./raw.server): the verified key on its own address. The capture holds no session, so
   * each request its page makes to its own asset door (a file it links, a module, a stylesheet and what that names, a
   * file a script fetches through `files`) carries the key. Only in that response's bytes: never an offline copy, the
   * stored source or a shared render.
   */
  captureKey?: string;
}
export interface NativeHtmlDocument { html: string; config: HtmlRuntimeConfig }

// Only code is cached. ACL, source, bindings and viewer state are never retained here.
const htmlAssets=buildHtmlAssets;
function htmlCore(): Promise<string> {
  return htmlAssets().then(assets=>assets.core);
}
export async function nativeHtmlDocument(input: NativeHtmlRender): Promise<NativeHtmlDocument> {
  // A stored link of a removed kind (a page function's) is no link.
  const links=((input.row.meta as {htmlLinks?:readonly HtmlPageLink[]}).htmlLinks??[]).filter(link=>(link as {kind:string}).kind!=='backend');
  const config:HtmlRuntimeConfig={...(hasImportedSourceObservation(input.row)?{annotationObservation:'imported-source-v1' as const}:{}),pageId:input.row.id,revision:String(input.row.version),...(input.live!==undefined?{live:input.live}:{}),backends:links.map(link=>link.name),...(links.some(link=>link.kind==='dataset')?{datasets:links.flatMap(link=>link.kind==='dataset'?[link.name]:[])}:{}),bindings:Object.fromEntries(links.flatMap(link=>link.kind==='dataset'?[[link.name,link.datasetId]]:[])),...(input.appOrigin?{appOrigin:new URL(input.appOrigin).origin}:{}),...(input.domainReads&&!input.offline?{domainReads:true as const}:{}),...(input.offline?{}:{libraries:libraryImports((input.row.meta as {htmlLibraries?:unknown}).htmlLibraries)})};
  // A page script's fetch of a file its publication recorded reads it at the page's asset door, on every surface
  // (html-runtime page-fetch); the address is relative, so it resolves on whichever origin serves the page.
  const captureKey=input.offline?null:input.captureKey??null;
  const files=input.offline?input.files:publishedFileTable(input.row.meta as PublicationRecord,input.row.id,input.row.version,captureKey?receipt=>`/a/${input.row.id}/assets?dependency=${receipt.id}&revision=${receipt.revision}&version=${input.row.version}&key=${encodeURIComponent(captureKey)}`:undefined);
  if(files&&Object.keys(files).length)config.files=files;
  const source=input.row.source??'';
  // The hosts the page declares it connects to: its core sends a GET to one through the page's own fetch door
  // (html-runtime page-fetch), which checks this reader's trust. A download and a publishing host have no door.
  const connect=input.offline||input.domainReads?[]:declaredCspExtensions(source).connect;
  if(connect.length)config.connect=connect;
  const stored=(input.row.meta as {htmlScriptFingerprint?:unknown}).htmlScriptFingerprint;
  config.scriptFingerprint=typeof stored==='string'?stored:scriptFingerprint(source);
  const portable={version:1 as const,source,...(input.appOrigin?{identity:{platformOrigin:new URL(input.appOrigin).origin,artifactId:input.row.id,baseRevision:String(input.row.version),sourceDigest:createHash('sha256').update(source).digest('hex'),dependencyIdentity:config.bindings}}:{})};
  const rendered=input.offline?input.renderedHtml??source:await nativeHtmlAssets(input.row,captureKey);
  const assembly={platformScriptNonce:input.platformScriptNonce??randomUUID().replaceAll('-',''),...(input.unsavedIds?.size?{unsavedNodeIds:input.unsavedIds}:{}),portable,html:nativeHtmlStructuralWrapper(nativeCodeHtml(rendered)),config,core:await htmlCore(),systemsHref:PLATFORM_STYLES_PATH,designSystem:input.designSystem??null,...(input.offline?{apollo:(await htmlAssets()).apollo,reader:(await htmlAssets()).reader,chrome:(await htmlAssets()).chrome,portableEngine:(await htmlAssets()).portableEngine,collab:(await htmlAssets()).collab,state:(await htmlAssets()).state,...(input.offlineData?.tables.length?{offlineData:input.offlineData,offlineSql:(await htmlAssets()).offlineSql}:{})}:{})};
  return {html:input.offline?downloadableHtml(assembly):assembleHtmlPage(assembly),config};
}
/** Inline author code is confined to the per-page origin, or the opaque /raw sandbox. */
export function nativeHtmlPolicy(id:string,base:string,pages?:{self:string;app:string},extensions:CspExtensions=EMPTY_CSP_EXTENSIONS,options:{domainReads?:boolean;captureSql?:boolean}={}):string {
  if (!pages){
    // The opaque raw reader may load only this page's admission-checked linked
    // stylesheets, the platform stylesheet and its hosted fonts (an opaque origin has no 'self'); do not grant the application's other paths as style sources.
    const assets=new URL(`/a/${id}/assets`,base).href,systems=new URL(PLATFORM_STYLES_PATH,base).href;
    // On a anonymous owner host, and in the exporter's capture, the page reads its data from its own page GraphQL endpoint (html-runtime/domain-reads); nowhere else.
    // The exporter's capture alone also reads its `sql` from the page SQL door (lib/page-doors `opaqueSqlRead`).
    const reads=options.domainReads?` ${new URL(`/api/artifacts/${encodeURIComponent(id)}/graphql`,base).href}${options.captureSql?` ${new URL(`/api/artifacts/${encodeURIComponent(id)}/sql`,base).href}`:''}`:'';
    return appendCspExtensions(markupCsp(base,id,ASSETS_ORIGIN??undefined).replace(/style-src ([^;]+)/,`style-src $1 ${assets} ${systems}`).replace(/font-src ([^;]+)/,`font-src $1 ${[PLATFORM_FONTS_PATH].map(dir=>new URL(dir,base).href).join(' ')}`).replace(/connect-src ([^;]+)/,`connect-src $1${reads}`),extensions);
  }
  return buildDocumentCsp({self:pages.self,app:pages.app,id,assetOrigin:ASSETS_ORIGIN,extensions,framers:embedTrustedOrigins()}).replace(/script-src ([^;]+)/,"script-src 'unsafe-inline' $1");
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

/** Public code only: no page, viewer, cookie or credential is an input to these bytes. /af/core.js. */
export async function nativeHtmlCoreResponse(request:Request):Promise<Response>{
 return publicRevalidatedResponse(request,await htmlCore(),JS);
}

/** A flat runtime module (D17: /af/apollo.js, /af/reader.js, /af/chrome.js, /af/portable.js, /af/morph.js, /af/collab.js, /af/state.js) or the document host module (/af/host.js) and its comments (/af/host-comments.js), always this build's bytes. */
export type NativeHtmlModule='apollo'|'reader'|'chrome'|'portableEngine'|'morph'|'nativeRegions'|'nativeMarkdown'|'collab'|'state'|'host'|'hostComments';
export async function nativeHtmlModuleResponse(request:Request,module:NativeHtmlModule):Promise<Response>{
 const source=(await htmlAssets())[module];
 if(!source)return new Response('Not found',{status:404});
 return publicRevalidatedResponse(request,source,JS);
}

/** The platform stylesheet (lib/html-systems) at its one stable address: public, revalidated on every load by its content hash.
 * `?system=NAME` answers that one system's sheet (what an offline copy or the skill's local preview inlines). */
export async function nativeHtmlSystemsResponse(request:Request):Promise<Response>{
 const system=new URL(request.url).searchParams.get('system');
 if(system!==null)return isHtmlSystem(system)?publicRevalidatedResponse(request,htmlSystemsCss([system]),'text/css; charset=utf-8'):new Response('Not found',{status:404});
 const {systems}=await htmlAssets();
 if(!systems)return new Response('Not found',{status:404});
 return publicRevalidatedResponse(request,systems,'text/css; charset=utf-8');
}
