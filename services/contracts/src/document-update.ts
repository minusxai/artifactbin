/** Trusted authoring clients prepare data, never SQL or authorization predicates. */
export const MAX_DOCUMENT_BYTES=2_000_000;
export type DocumentTree={schema:1;kind:'jsx';roots:unknown[]}|{schema:1;kind:'source';source:string};
export type JsonDocumentPatch=
 | {kind:'set'|'insert';path:string[];value:unknown}
 | {kind:'delete';path:string[]}
 | {kind:'text';path:string[];value:string;start:number;deleteCount:number};
export interface DocumentGraphNode {
 ast:DocumentTree|null;selectors:string[];refs:Array<{id:string;kind:string}>;
 parent:string|null;children:string[];parts:string[];bytes:number;units:number;partUnits:number[];subtreeUnits:number;prose:boolean;
 selfVersion:number;childrenVersion:number;subtreeVersion:number;
}
export interface DocumentGraph {
 schema:3;kind:'graph';policy:string;nodes:Record<string,DocumentGraphNode>;claimedIds:Record<string,number>;bytes:number;
}
export type GraphFacet='selfVersion'|'childrenVersion'|'subtreeVersion';
export interface GraphRead {key:string;facet:GraphFacet;version:number}
export interface GraphNodeWrite {patches:JsonDocumentPatch[];self:boolean;children:boolean}
export interface GraphPatch {
 baseVersion:number;reads:GraphRead[];selections:Array<{selector:string;keys:string[]}>;
 inserted:Record<string,DocumentGraphNode>;removed:string[];updated:Record<string,GraphNodeWrite>;touched:string[];
 byteDelta:number;unitDeltas:Record<string,number>;claims:Array<{id:string;version:number|null}>;
}
export interface DocumentIdentityTextMap {fromId:string;toId:string;fromText:string;toText:string;segments:Array<{from:number;to:number;length:number}>}
export type DocumentAnnotationOperation={id:string;kind:'map';maps:DocumentIdentityTextMap[]}|{id:string;kind:'undo'|'redo'};
export interface DocumentAssetWarning {code:string;url:string;fix:string}
export interface DocumentResourcePreparation {warnings?:DocumentAssetWarning[];datasetBindings?:Array<{id:string;version:number;source:string|null;meta:Record<string,unknown>}>}
export interface DocumentUpdate extends Pick<DocumentResourcePreparation,'datasetBindings'> {
 mentions?:Array<{nodeId:string;userId:string}>;
 settings?:{visibility?:'private'|'unlisted'|'public';linkRole?:'viewer'|'commenter'|'editor';parentId?:string|null;shares?:Array<{email:string;role:'viewer'|'commenter'|'editor'}>};
 expectedSharingRevision?:number;
 expectedParentIds?:string[];
 annotationOps?:DocumentAnnotationOperation[];
 aliases?:Array<{legacyKey:string;nodeId:string;path:string}>;
 schema:1;
 replacement?:DocumentGraph;
 patch:GraphPatch;
 /** Derived caches are invalidated only when their inputs actually change. */
 effects:{css:boolean;references:boolean};
 metadata?:{title?:string|null;description?:string|null;theme?:string|null;template?:string|null;colorMode?:'light'|'dark'|null};
 expectedMetadata?:Record<string,unknown>;
 /** Whole replacements consume the observed head. Ordinary patches use facets. */
 whole?:boolean;
}

/** Transport shape checks bound SQL work and reject malformed data. Semantic
 * validation belongs to the authoring client; authorization never does. */
export function parseDocumentUpdate(value:unknown):DocumentUpdate|null {
 const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const strings=(x:unknown):x is string[]=>Array.isArray(x)&&x.every(v=>typeof v==='string');
 const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x);
 if(!object(value)||value.schema!==1||!object(value.patch)||!object(value.effects)||typeof value.effects.css!=='boolean'||typeof value.effects.references!=='boolean')return null;
 if(value.mentions!==undefined&&(!Array.isArray(value.mentions)||!value.mentions.every(m=>object(m)&&typeof m.nodeId==='string'&&typeof m.userId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(m.userId))))return null;
 if(value.datasetBindings!==undefined&&(!Array.isArray(value.datasetBindings)||!value.datasetBindings.every(b=>object(b)&&typeof b.id==='string'&&integer(b.version)&&(b.source===null||typeof b.source==='string')&&object(b.meta))))return null;
 const p=value.patch;
 if(!integer(p.baseVersion)||p.baseVersion<1||!integer(p.byteDelta)||!strings(p.removed)||!strings(p.touched)||!object(p.inserted)||!object(p.updated)||!object(p.unitDeltas))return null;
 if(!Object.values(p.unitDeltas).every(integer))return null;
 if(!Array.isArray(p.reads)||!p.reads.every(r=>object(r)&&typeof r.key==='string'&&['selfVersion','childrenVersion','subtreeVersion'].includes(String(r.facet))&&integer(r.version)))return null;
 if(!Array.isArray(p.selections)||!p.selections.every(s=>object(s)&&typeof s.selector==='string'&&strings(s.keys)))return null;
 if(!Array.isArray(p.claims)||!p.claims.every(c=>object(c)&&typeof c.id==='string'&&(c.version===null||integer(c.version))))return null;
 for(const n of Object.values(p.inserted)){
  if(!object(n)||!strings(n.children)||!strings(n.parts)||!strings(n.selectors)||!Array.isArray(n.refs)||!Array.isArray(n.partUnits)||!n.partUnits.every(integer)||!['bytes','units','subtreeUnits','selfVersion','childrenVersion','subtreeVersion'].every(k=>integer(n[k]))||!(n.parent===null||typeof n.parent==='string')||typeof n.prose!=='boolean'||!(n.ast===null||object(n.ast)))return null;
 }
 for(const write of Object.values(p.updated)){
  if(!object(write)||typeof write.self!=='boolean'||typeof write.children!=='boolean'||!Array.isArray(write.patches)||write.patches.length>1024)return null;
  for(const op of write.patches){
   if(!object(op)||!strings(op.path)||!op.path.length||op.path.length>256||!['ast','selectors','refs','parent','children','parts','bytes','units','partUnits','prose'].includes(op.path[0]!))return null;
   if(op.kind==='text'){if(typeof op.value!=='string'||!integer(op.start)||op.start<0||!integer(op.deleteCount)||op.deleteCount<0)return null;}
   else if(op.kind==='set'||op.kind==='insert'){if(!Object.hasOwn(op,'value'))return null;}
   else if(op.kind!=='delete')return null;
  }
 }
 if(value.replacement!==undefined&&(!object(value.replacement)||value.whole!==true||value.replacement.kind!=='graph'||value.replacement.schema!==3||!object(value.replacement.nodes)||!object(value.replacement.claimedIds)||!integer(value.replacement.bytes)||value.replacement.bytes>MAX_DOCUMENT_BYTES))return null;
 if(value.settings!==undefined){
  if(!object(value.settings))return null;
  const s=value.settings;
  if(Object.keys(s).some(k=>!['visibility','linkRole','parentId','shares'].includes(k)))return null;
  if(s.visibility!==undefined&&!['private','unlisted','public'].includes(String(s.visibility)))return null;
  if(s.linkRole!==undefined&&!['viewer','commenter','editor'].includes(String(s.linkRole)))return null;
  if(s.parentId!==undefined&&s.parentId!==null&&typeof s.parentId!=='string')return null;
  if(s.shares!==undefined&&(!Array.isArray(s.shares)||!s.shares.every(e=>object(e)&&typeof e.email==='string'&&['viewer','commenter','editor'].includes(String(e.role)))))return null;
  if(!integer(value.expectedSharingRevision))return null;
  if(s.parentId!==undefined&&!strings(value.expectedParentIds))return null;
 }
 if(value.aliases!==undefined&&(!Array.isArray(value.aliases)||!value.aliases.every(a=>object(a)&&['legacyKey','nodeId','path'].every(k=>typeof a[k]==='string'))))return null;
 if(value.whole!==undefined&&typeof value.whole!=='boolean')return null;
 if(value.metadata!==undefined){
  if(!object(value.metadata)||!Object.entries(value.metadata).every(([k,v])=>['title','description','theme','template','colorMode'].includes(k)&&(v===null||typeof v==='string')))return null;
  if(value.metadata.colorMode!==undefined&&value.metadata.colorMode!==null&&!['light','dark'].includes(String(value.metadata.colorMode)))return null;
 }
 if(value.expectedMetadata!==undefined&&(!object(value.expectedMetadata)||!Object.keys(value.expectedMetadata).every(k=>['title','description','theme','template','colorMode'].includes(k))))return null;
 return value as unknown as DocumentUpdate;
}
