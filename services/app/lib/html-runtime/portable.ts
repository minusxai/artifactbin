import {parse,type DefaultTreeAdapterMap} from 'parse5';
import { assertStorable } from './apollo/storable';
import type { PortableDocument, PortableIdentity } from './portable-contract';

function isPortablePlatformOrigin(value:string):boolean {
 try{const url=new URL(value);return (url.protocol==='https:' || url.protocol==='http:') && url.origin===value && !url.username && !url.password;}catch{return false;}
}
function identity(value: PortableIdentity): PortableIdentity {
 if(!isPortablePlatformOrigin(value.platformOrigin))throw new Error('Invalid portable platform origin');
 const url=new URL(value.platformOrigin);
 if(!value.artifactId || !value.baseRevision || !/^[a-f0-9]{64}$/.test(value.sourceDigest)) throw new Error('Invalid portable identity');
 return {platformOrigin:url.origin,artifactId:value.artifactId,baseRevision:value.baseRevision,sourceDigest:value.sourceDigest,...(value.dependencyIdentity?{dependencyIdentity:{...value.dependencyIdentity}}:{})};
}
/** Explicit allowlist prevents transport/session fields leaking into downloaded files. */
function portableDocument(value: PortableDocument): PortableDocument {
 if(value.version!==1 || typeof value.source!=='string') throw new Error('Invalid portable document');
 if(value.privateState) assertStorable(value.privateState);
 return {version:1,source:value.source,...(value.renderedDigest?{renderedDigest:value.renderedDigest}:{}),...(value.identity?{identity:identity(value.identity)}:{}),...(value.privateState?{privateState:value.privateState}:{})};
}
export function portableScript(value: PortableDocument): string {
 return `<script type="application/json" data-af="portable">${JSON.stringify(portableDocument(value)).replace(/</g,'\\u003c')}</script>`;
}
function portableBlock(document:DefaultTreeAdapterMap['node']):string|undefined {
 const walk=(node:DefaultTreeAdapterMap['node']):string|undefined=>{
  if('attrs' in node&&node.nodeName==='script'&&node.attrs.some(attr=>attr.name==='data-af'&&attr.value==='portable'))return node.childNodes.filter(child=>child.nodeName==='#text').map(child=>(child as DefaultTreeAdapterMap['textNode']).value).join('');
  if('childNodes' in node)for(const child of node.childNodes){const found=walk(child);if(found!==undefined)return found;}
  return undefined;
 };
 return walk(document);
}
function envelope(block:string):PortableDocument {
 const parsed=JSON.parse(block) as PortableDocument;
 return JSON.parse(JSON.stringify(portableDocument(parsed))) as PortableDocument;
}
export function hasPortableDocument(html:string):boolean{return portableBlock(parse(html))!==undefined;}
export function readPortableDocument(html: string): PortableDocument {
 const block=portableBlock(parse(html));
 if(block===undefined) throw new Error('Canonical portable source is unavailable');
 return envelope(block);
}
/**
 * The envelope a file already parsed (by parse5) carries, read as readPortableDocument reads it (an unreadable one throws);
 * undefined when it carries none. An export is megabytes (its rows and its engine): a caller that walks the file anyway
 * parses it once, not once per question.
 */
export function portableDocumentIn(document:DefaultTreeAdapterMap['document']):PortableDocument|undefined {
 const block=portableBlock(document);
 return block===undefined?undefined:envelope(block);
}
