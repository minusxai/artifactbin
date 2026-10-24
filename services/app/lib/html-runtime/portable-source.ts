import {sha256Hex} from '@artifactbin/utils/sha256';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { readPortableDocument,hasPortableDocument } from './portable';
const generated=new Set(['runtime','apollo','reader','portable','chrome','portable-engine','core']);
/** Recover author bytes from an explicitly selected disk file, never the running DOM. */
export function recoverPortableRendering(fileBytes:string):string {
 if(!hasPortableDocument(fileBytes))return fileBytes;
 readPortableDocument(fileBytes);
 const document=parse(fileBytes,{sourceCodeLocationInfo:true});
 const spans:{start:number;end:number;replacement:string}[]=[];
 const walk=(node:DefaultTreeAdapterMap['node'])=>{
  if('attrs' in node && node.nodeName==='script' && generated.has(node.attrs.find(attr=>attr.name==='data-af')?.value??'')) {
   const location=node.sourceCodeLocation;
   if(!location)throw new Error('Portable bootstrap has no source location');
   const core=node.attrs.some(attr=>attr.name==='data-af'&&attr.value==='core');
   const id=node.attrs.find(attr=>attr.name==='data-af-id')?.value;
   spans.push({start:location.startOffset,end:location.endOffset,replacement:core?`<script src="/af/v1/core.js"${id?` data-af-id="${id.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"`:''}></script>`:''});
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
 const clean=(node:DefaultTreeAdapterMap['node'])=>{if('childNodes' in node){node.childNodes=node.childNodes.filter(child=>!('attrs' in child&&child.nodeName==='script'&&child.attrs.some(attr=>attr.name==='src'&&attr.value==='/af/v1/core.js'||attr.name==='data-af'&&attr.value==='core')));for(const child of node.childNodes)clean(child);}};
 clean(doc);return sha256Hex(serialize(doc));
}
export function recoverPortableSource(fileBytes:string):string {
 if(!hasPortableDocument(fileBytes))return fileBytes;
 const envelope=readPortableDocument(fileBytes),source=recoverPortableRendering(fileBytes),digest=portableRenderedDigest(source);
 return digest===portableRenderedDigest(envelope.source)||digest===envelope.renderedDigest?envelope.source:source;
}
