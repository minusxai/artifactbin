/** Native XML state operations, dispatched only for rich-native-v1. */
import * as Y from 'yjs';
import { initProseMirrorDoc, prosemirrorToYXmlFragment, updateYFragment } from '@tiptap/y-tiptap';
import type { Node as PMNode } from 'prosemirror-model';
import { REGION_TEXT_MAX_UNITS } from '@artifactbin/contracts';
import { Fragment } from 'prosemirror-model';
import { nativeSchema, NATIVE_ROOT } from './native-schema';
import { readNativeHtml, writeNativeHtml } from './native-html';
import { openRegionDoc, forkRegionDoc } from './region-doc';
import { LiveRegionRefusal } from './refusal';
import { isNodeId, safeHref } from './schema';
const nativeRoot=(doc:Y.Doc)=>doc.getXmlFragment(NATIVE_ROOT);
/** Pure projection: library repair projections may mutate malformed XML, which validation must never do. */
export function nativeDocument(doc:Y.Doc):PMNode {
 const children=(root:Y.XmlFragment):PMNode[]=>root.toArray().flatMap(child=>{
  if(child instanceof Y.XmlText)return child.toDelta().flatMap((run:{insert:unknown;attributes?:Record<string,unknown>})=>typeof run.insert==='string'&&run.insert.length?[nativeSchema.text(run.insert,Object.entries(run.attributes??{}).map(([name,attrs])=>nativeSchema.mark(name,attrs as Record<string,unknown>)))]:[]);
  if(!(child instanceof Y.XmlElement))throw new LiveRegionRefusal('unsupported_content',['native type']);
  return [nativeSchema.nodes[child.nodeName]!.createChecked(child.getAttributes(),children(child))];
 });return nativeSchema.topNodeType.createChecked(null,children(nativeRoot(doc)));
}
export function createNativeState(html:string){const doc=openRegionDoc(undefined,{kind:'rich-native-v1'});prosemirrorToYXmlFragment(readNativeHtml(html),nativeRoot(doc));validateNativeTree(doc);return {state:Y.encodeStateAsUpdate(doc),snapshot:Y.encodeSnapshot(Y.snapshot(doc))};}
export function nativeHtml(state:Uint8Array){return writeNativeHtml(nativeDocument(openRegionDoc(state,{kind:'rich-native-v1'})));}
export function validateNativeTree(doc:Y.Doc):void {
 const fail=(s:string):never=>{throw new LiveRegionRefusal('unsupported_content',[s]);};
 for(const [name,type] of doc.share)if(name!==NATIVE_ROOT || !(type instanceof Y.XmlFragment))fail('foreign native root');
 let units=0;
 const walk=(type:Y.XmlFragment,depth:number)=>{
  if(depth>32)fail('native nesting limit');
  if(!(type instanceof Y.XmlElement)&&[...type._map.values()].some(item=>!item.deleted))fail('native root attributes');
  for(const child of type.toArray()){
   units++;
   if(child instanceof Y.XmlText){if(Object.keys(child.getAttributes()).length)fail('native text attributes');for(const run of child.toDelta()){if(typeof run.insert!=='string')fail('embedded native content');units+=run.insert.length;for(const [key,value] of Object.entries(run.attributes??{})){if(!['bold','italic','code','link'].includes(key)||!value||typeof value!=='object')fail('native mark');if(key==='link'){const attrs=value as Record<string,unknown>;if(typeof attrs.href!=='string'||safeHref(attrs.href)!==attrs.href)fail('native link');for(const k of Object.keys(attrs))if(!['href','target','rel','class','title'].includes(k))fail('link attribute');if(attrs.title!=null&&(typeof attrs.title!=='string'||attrs.title.length>512))fail('link title');if(attrs.class!=null || (attrs.target!=null && attrs.target!=='_blank') || (attrs.rel!=null && attrs.rel!=='noopener noreferrer nofollow'))fail('link attribute');}else if(Object.keys(value as object).length)fail('mark attributes');}}continue;}
   if(!(child instanceof Y.XmlElement)||!nativeSchema.nodes[child.nodeName]||['doc','text'].includes(child.nodeName))fail('native node');
   if (!(child instanceof Y.XmlElement)) return fail('native node');
   const spec=nativeSchema.nodes[child.nodeName]!.spec.attrs??{};
   for(const [key,value] of Object.entries(child.getAttributes())){
    if(!(key in spec))fail('native attribute');
    if(key==='afId'&&value!==null&&!isNodeId(value))fail('native identity');
    if(key==='level'&&(!Number.isInteger(value)||Number(value)<1||Number(value)>6))fail('heading level');
    if(key==='start'&&(!Number.isSafeInteger(value)||Number(value)<1))fail('list start');
    if(key==='checked'&&typeof value!=='boolean')fail('task checked');
    if(key==='language'&&value!==null&&(typeof value!=='string'||!/^[-\w+]{1,64}$/.test(value)))fail('code language');
   }
   walk(child,depth+1);
  }
 };walk(nativeRoot(doc),0);
 if(units>REGION_TEXT_MAX_UNITS)throw new LiveRegionRefusal('too_large');
 try{nativeDocument(doc).check();}catch{fail('native schema');}
}
export function reviseNative(liveBytes:Uint8Array,snapshotBytes:Uint8Array|undefined|null,html:string){
 if(!snapshotBytes?.length)throw new LiveRegionRefusal('missing_snapshot');
 const live=openRegionDoc(liveBytes,{kind:'rich-native-v1'});
 let snapshot:Y.Snapshot;try{snapshot=Y.decodeSnapshot(snapshotBytes);}catch{throw new LiveRegionRefusal('snapshot_mismatch');}
 const known=Y.decodeStateVector(Y.encodeStateVector(live));
 if(!snapshot.sv.size||[...snapshot.sv].some(([client,clock])=>(known.get(client)??0)<clock))throw new LiveRegionRefusal('snapshot_mismatch');
 const fork=forkRegionDoc(live,snapshot);
 const root=nativeRoot(fork);const {mapping}=initProseMirrorDoc(root,nativeSchema);
 const parsed=readNativeHtml(html);
 // Match unchanged siblings before positional edits; insertion must never steal a following block's identity.
 const signature=(node:PMNode):string=>JSON.stringify(node.toJSON(),(key,value)=>key==='afId'?undefined:value);
 const carry=(target:PMNode,base:PMNode|undefined):PMNode=>{
  if(target.isText)return target;
  const attrs={...target.attrs};if(!attrs.afId&&base?.type===target.type&&base.attrs.afId)attrs.afId=base.attrs.afId;
  const targets:PMNode[]=[];target.forEach(child=>targets.push(child));
  const bases:PMNode[]=[];base?.forEach(child=>bases.push(child));
  const used=new Set<number>();
  const matches=targets.map(child=>{
   const at=bases.findIndex((candidate,index)=>!used.has(index)&&(child.attrs.afId?candidate.attrs.afId===child.attrs.afId:signature(child)===signature(candidate)));
   if(at>=0)used.add(at);return at;
  });
  const children=targets.map((child,index)=>{
   let at=matches[index]!;
   if(at<0&&targets.length===bases.length&&!used.has(index)&&bases[index]?.type===child.type){at=index;used.add(at);}
   return carry(child,at>=0?bases[at]:undefined);
  });
  return target.type.create(attrs,Fragment.fromArray(children),target.marks);
 };
 const target=carry(parsed,nativeDocument(fork));
 fork.transact(()=>updateYFragment(fork,root,target,{mapping,isOMark:new Map()}));
 return {update:Y.encodeStateAsUpdate(fork,Y.encodeStateVector(live)),snapshot:Y.encodeSnapshot(Y.snapshot(fork))};
}
/** Write identity-only changes to the existing XML nodes, never replace their text. */
export function nativeIds(doc:Y.Doc,saved:PMNode):Uint8Array {
 const before=Y.encodeStateVector(doc);
 const walk=(root:Y.XmlFragment,node:PMNode)=>{
  const children=root.toArray().filter((child):child is Y.XmlElement=>child instanceof Y.XmlElement);
  let at=0;node.forEach(child=>{if(child.isText)return;const xml=children[at++];if(!xml||xml.nodeName!==child.type.name)throw new LiveRegionRefusal('unsupported_content',['identity shape mismatch']);if(child.attrs.afId!==undefined && xml.getAttribute('afId')!==child.attrs.afId)xml.setAttribute('afId',child.attrs.afId);walk(xml,child);});
 };doc.transact(()=>walk(nativeRoot(doc),saved));return Y.encodeStateAsUpdate(doc,before);
}
