import { escapeSourceAttribute } from '@artifactbin/utils/escape';
import {isRuntimeCoreSrc,RUNTIME_CORE_PATH} from '../html-page/core-script';
import {INLINE_SCRIPT_POLICY} from './inline-scripts';
import {sha256Hex} from '@artifactbin/utils/sha256';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { readPortableDocument,hasPortableDocument } from './portable';
const generated=new Set(['runtime','apollo','reader','portable','chrome','portable-engine','collab','state-module','offline-data','offline-sql','core',INLINE_SCRIPT_POLICY]);
/** Recover author bytes from an explicitly selected disk file, never the running DOM. */
export function recoverPortableRendering(fileBytes:string):string {
 if(!hasPortableDocument(fileBytes))return fileBytes;
 readPortableDocument(fileBytes);
 const document=parse(fileBytes,{sourceCodeLocationInfo:true});
 const spans:{start:number;end:number;replacement:string}[]=[];
 const walk=(node:DefaultTreeAdapterMap['node'])=>{
  if('attrs' in node && (node.nodeName==='script'||node.nodeName==='meta'&&node.attrs.some(attr=>attr.name==='data-af'&&attr.value===INLINE_SCRIPT_POLICY)) && generated.has(node.attrs.find(attr=>attr.name==='data-af')?.value??'')) {
   const location=node.sourceCodeLocation;
   if(!location)throw new Error('Portable bootstrap has no source location');
   const core=node.attrs.some(attr=>attr.name==='data-af'&&attr.value==='core');
   const id=node.attrs.find(attr=>attr.name==='data-af-id')?.value;
   spans.push({start:location.startOffset,end:location.endOffset,replacement:core?`<script src="${RUNTIME_CORE_PATH}"${id?` data-af-id="${escapeSourceAttribute(id)}"`:''}></script>`:''});
  }
  if('childNodes' in node)for(const child of node.childNodes)walk(child);
 };
 walk(document);
 let source=fileBytes;
 for(const span of spans.sort((a,b)=>b.start-a.start))source=source.slice(0,span.start)+span.replacement+source.slice(span.end);
 return source;
}
/** Compare normalized parser output while ignoring only the replaceable core loader. */
export function portableRenderedDigest(html:string):string {
 const doc=parse(html);
 const clean=(node:DefaultTreeAdapterMap['node'])=>{if('childNodes' in node){node.childNodes=node.childNodes.filter(child=>!('attrs' in child&&(child.nodeName==='script'||child.nodeName==='meta'&&child.attrs.some(attr=>attr.name==='data-af'&&attr.value===INLINE_SCRIPT_POLICY))&&child.attrs.some(attr=>attr.name==='src'&&isRuntimeCoreSrc(attr.value)||attr.name==='data-af'&&(attr.value==='core'||attr.value===INLINE_SCRIPT_POLICY))));for(const child of node.childNodes)clean(child);}};
 clean(doc);return sha256Hex(serialize(doc));
}
/** The envelope's source when the file's own rendering still matches it, else null; and that rendering, stripped. */
function envelopeSource(fileBytes:string):{source:string|null;rendering:string} {
 const envelope=readPortableDocument(fileBytes),rendering=recoverPortableRendering(fileBytes),digest=portableRenderedDigest(rendering);
 return {source:digest===portableRenderedDigest(envelope.source)||digest===envelope.renderedDigest?envelope.source:null,rendering};
}
/** A file a person picked (local publish, the skill): its source, or its disk edits with every generated block removed. */
export function recoverPortableSource(fileBytes:string):string {
 if(!hasPortableDocument(fileBytes))return fileBytes;
 const recovered=envelopeSource(fileBytes);
 return recovered.source??recovered.rendering;
}
/** Why a server refuses a portable file: it no longer verifies, so no source in it can be trusted to be the author's. */
export class PortableSourceUnverified extends Error {
 constructor(){super('This HTML is an exported copy that no longer matches the source it carries: publish the original source, or export the page again.');this.name='PortableSourceUnverified';}
}
/**
 * What a server stores of submitted HTML (lib/publish): an export reduced to the source its envelope carries, never
 * its generated blocks (its reader's rows, the engine, the runtime). Unlike recoverPortableSource it never keeps a
 * stripped rendering: an export edited outside its envelope, or one whose envelope is unreadable, throws
 * PortableSourceUnverified. HTML with no envelope is returned as it is.
 */
export function verifiedPortableSource(html:string):string {
 if(!hasPortableDocument(html))return html;
 let source:string|null=null;
 try{source=envelopeSource(html).source;}catch{/* An unreadable envelope verifies nothing. */}
 if(source===null)throw new PortableSourceUnverified();
 return source;
}
