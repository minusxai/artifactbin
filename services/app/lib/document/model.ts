/** Pure client/import document model. SQL persistence never calls the full-tree validator. */
import type {DocumentInline, DocumentJson, DocumentNode, DocumentPrimitive, RichDocument} from '@artifactbin/contracts';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const prohibited = new Set(['__proto__', 'prototype', 'constructor']);
const prose = new Set(['paragraph', 'heading', 'code']);
export class DocumentError extends Error {}
function requireThat(value: unknown, message: string): asserts value {if (!value) throw new DocumentError(message);}
export function validNodeId(id: string): boolean {return ID.test(id) && !prohibited.has(id);}
export function assertJson(value: unknown, depth = 0): asserts value is DocumentJson {
 requireThat(depth <= 100, 'Document nesting is too deep');
 if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
 if (typeof value === 'number') {requireThat(Number.isFinite(value), 'Numbers must be finite');return;}
 requireThat(typeof value === 'object' && value !== null, 'Expected JSON data');
 for (const [key, entry] of Object.entries(value)) {requireThat(!prohibited.has(key), 'Unsafe object key');assertJson(entry, depth + 1);}
}
export function childIds(node: DocumentNode): string[] {
 return [...(node.children ?? []), ...Object.values(node.slots ?? {}).flat(), ...(node.content ?? []).flatMap(item => item.type === 'nodeRef' ? [item.nodeId] : [])];
}
export function assertDocumentNode(node: DocumentNode): void {
 requireThat(node && typeof node.type === 'string' && node.props && !Array.isArray(node.props), 'Invalid node');assertJson(node);
 requireThat(['document','paragraph','heading','code','blockquote','list','listItem','thematicBreak','table','tableRow','tableCell','component','html','expression','declaration'].includes(node.type), 'Unknown node type');
 if(node.type==='component')requireThat(typeof node.name==='string'&&node.name.length>0,'Component name is required');
 if(node.type==='html')requireThat(typeof node.tag==='string'&&node.tag.length>0,'HTML tag is required');
 if(node.type==='heading')requireThat(Number.isInteger(node.props.depth)&&Number(node.props.depth)>=1&&Number(node.props.depth)<=6,'Invalid heading depth');
 if(node.props.float!==undefined)requireThat(['left','right','disabled'].includes(String(node.props.float)),'Invalid float');
 if(node.children!==undefined)requireThat(Array.isArray(node.children)&&node.children.every(id=>typeof id==='string'&&validNodeId(id)),'Invalid children');
 if(node.slots!==undefined)requireThat(!Array.isArray(node.slots)&&Object.values(node.slots).every(ids=>Array.isArray(ids)&&ids.every(validNodeId)),'Invalid slots');
 if(node.content!==undefined){
  requireThat(Array.isArray(node.content),'Invalid inline content');
  for(const item of node.content){
   requireThat(item && ['text','break','nodeRef'].includes(item.type),'Invalid inline item');
   if(item.type==='text'){requireThat(typeof item.text==='string'&&Array.isArray(item.marks),'Invalid text run');for(const mark of item.marks)requireThat(typeof mark.type==='string'&&['strong','emphasis','strike','code','link','span','underline','sup','sub'].includes(mark.type),'Invalid mark');}
   if(item.type==='nodeRef')requireThat(validNodeId(item.nodeId),'Invalid inline reference');
  }
 }
 if(node.name==='Flex'){
  requireThat(node.props.direction==='row'||node.props.direction==='column','Invalid Flex direction');
  requireThat(Array.isArray(node.children)&&Array.isArray(node.props.sizes)&&node.props.sizes.length===node.children.length&&node.props.sizes.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0),'Flex sizes must match children');
 }
}
/** Independent invariant oracle for import and tests; not invoked by the save service. */
export function assertDocument(value: unknown): asserts value is RichDocument {
 const d=value as RichDocument;requireThat(d?.schemaVersion===1&&validNodeId(d.rootId)&&d.nodes&&typeof d.nodes==='object'&&!Array.isArray(d.nodes),'Invalid document');
 const entries=Object.entries(d.nodes);requireThat(entries.length>0&&entries.length<=20000,'Invalid node count');
 for(const [id,node] of entries){requireThat(validNodeId(id),'Invalid node ID');assertDocumentNode(node);}
 requireThat(d.nodes[d.rootId]?.type==='document','Missing document root');
 const seen=new Set<string>();
 function visit(id:string,depth:number){requireThat(depth<=100,'Document nesting is too deep');requireThat(!seen.has(id),'Cycle or duplicate ownership');seen.add(id);const n=d.nodes[id];requireThat(n,'Missing child');
  if(n.type==='list')requireThat((n.children??[]).every(c=>d.nodes[c]?.type==='listItem'),'Lists contain list items');
  if(n.type==='table')requireThat((n.children??[]).every(c=>d.nodes[c]?.type==='tableRow'),'Tables contain rows');
  if(n.type==='tableRow')requireThat((n.children??[]).every(c=>d.nodes[c]?.type==='tableCell'),'Rows contain cells');
  for(const c of childIds(n))visit(c,depth+1);
 }
 visit(d.rootId,0);requireThat(seen.size===entries.length,'Unreachable node');
}
export function parentMap(d:RichDocument): Map<string,string> {const result=new Map<string,string>();for(const [id,n] of Object.entries(d.nodes))for(const c of childIds(n))result.set(c,id);return result;}
export function ancestorsOf(id:string,parents:Map<string,string>):string[]{const out:string[]=[];let p=parents.get(id);while(p){requireThat(!out.includes(p),'Cyclic ancestry');out.push(p);p=parents.get(p);}return out;}
export function documentChanges(before:RichDocument,after:RichDocument):{changedIds:string[];ancestorIds:string[]}{
 const oldParents=parentMap(before),newParents=parentMap(after);
 const changedIds=[...new Set([...Object.keys(before.nodes),...Object.keys(after.nodes)])].filter(id=>JSON.stringify(before.nodes[id])!==JSON.stringify(after.nodes[id])||oldParents.get(id)!==newParents.get(id));
 const ancestorIds=[...new Set(changedIds.flatMap(id=>[...ancestorsOf(id,oldParents),...ancestorsOf(id,newParents)]))];return {changedIds,ancestorIds};
}
export function assertPrimitive(op:DocumentPrimitive):void{
 requireThat(op&&typeof op==='object','Invalid operation');
 if(op.kind==='addNodes'){requireThat(op.nodes&&Object.keys(op.nodes).length>0,'Empty node addition');for(const [id,n] of Object.entries(op.nodes)){requireThat(validNodeId(id),'Invalid node ID');assertDocumentNode(n);}return;}
 if(op.kind==='removeNodes'){requireThat(Array.isArray(op.ids)&&op.ids.length>0&&op.ids.every(validNodeId),'Invalid node removal');return;}
 requireThat(['set','unset','text','insert','remove'].includes(op.kind)&&validNodeId(op.nodeId),'Invalid operation');
 requireThat(Array.isArray(op.path)&&op.path.length>0&&op.path.length<=100&&op.path.every(p=>typeof p==='string'&&p.length>0&&!prohibited.has(p)),'Invalid path');
 if(op.kind==='set'||op.kind==='insert')assertJson(op.value);
 if(op.kind==='text')requireThat(typeof op.text==='string'&&Number.isSafeInteger(op.start)&&op.start>=0&&Number.isSafeInteger(op.deleteCount)&&op.deleteCount>=0,'Invalid text range');
 if(op.kind==='insert'||op.kind==='remove')requireThat(Number.isSafeInteger(op.index)&&op.index>=0,'Invalid array index');
}
function at(value:unknown,path:string[]):unknown {let v=value;for(const p of path){requireThat(v!==null&&typeof v==='object'&&Object.hasOwn(v,p),'Missing path');v=(v as Record<string,unknown>)[p];}return v;}
export function applyDocumentOperations(before:RichDocument,ops:DocumentPrimitive[]):RichDocument{
 const d=structuredClone(before);
 for(const op of ops){assertPrimitive(op);
  if(op.kind==='addNodes'){for(const [id,n] of Object.entries(op.nodes)){requireThat(!Object.hasOwn(d.nodes,id),'Existing node ID');d.nodes[id]=structuredClone(n);}continue;}
  if(op.kind==='removeNodes'){for(const id of op.ids){requireThat(id!==d.rootId&&Object.hasOwn(d.nodes,id),'Invalid node removal');delete d.nodes[id];}continue;}
  const node=d.nodes[op.nodeId];requireThat(node,'Missing node');
  const parent=at(node,op.path.slice(0,-1));requireThat(parent!==null&&typeof parent==='object','Missing parent');const key=op.path.at(-1)!;const object=parent as Record<string,unknown>;
  if(op.kind==='set'){if(Array.isArray(parent))requireThat(/^\d+$/.test(key)&&Number(key)<parent.length,'Invalid array replacement');object[key]=structuredClone(op.value);}
  if(op.kind==='unset'){requireThat(!Array.isArray(parent)&&Object.hasOwn(parent,key),'Missing optional field');delete object[key];}
  if(op.kind==='text'){const value=at(node,op.path);requireThat(typeof value==='string','Expected string');const chars=Array.from(value);requireThat(op.start+op.deleteCount<=chars.length,'Invalid text range');chars.splice(op.start,op.deleteCount,...Array.from(op.text));object[key]=chars.join('');}
  if(op.kind==='insert'||op.kind==='remove'){const arr=at(node,op.path);requireThat(Array.isArray(arr)&&op.index<=(op.kind==='insert'?arr.length:arr.length-1),'Invalid array range');if(op.kind==='insert')arr.splice(op.index,0,structuredClone(op.value));else arr.splice(op.index,1);}
 }
 assertDocument(d);return d;
}
export function diffDocument(before:RichDocument,after:RichDocument):DocumentPrimitive[]{
 const ops:DocumentPrimitive[]=[];const added:Record<string,DocumentNode>={};
 for(const [id,node] of Object.entries(after.nodes)){
  const old=before.nodes[id];if(!old){added[id]=node;continue;}
  for(const key of new Set([...Object.keys(old),...Object.keys(node)])){
   const prev=(old as unknown as Record<string,DocumentJson>)[key],next=(node as unknown as Record<string,DocumentJson>)[key];
   if(JSON.stringify(prev)===JSON.stringify(next))continue;
   ops.push(next===undefined?{kind:'unset',nodeId:id,path:[key]}:{kind:'set',nodeId:id,path:[key],value:next});
  }
 }
 if(Object.keys(added).length)ops.unshift({kind:'addNodes',nodes:added});
 const removed=Object.keys(before.nodes).filter(id=>!after.nodes[id]);if(removed.length)ops.push({kind:'removeNodes',ids:removed});return ops;
}
function children(d:RichDocument,id:string):string[]{const n=d.nodes[id];requireThat(n&&Array.isArray(n.children),'Destination has no editable child slot');return n.children;}
function removeChild(d:RichDocument,parent:string,id:string):number {const n=d.nodes[parent],list=children(d,parent),index=list.indexOf(id);requireThat(index>=0,'Missing child');list.splice(index,1);if(n.name==='Flex')(n.props.sizes as DocumentJson[]).splice(index,1);return index;}
function insertChild(d:RichDocument,parent:string,id:string,index:number):void{const n=d.nodes[parent],list=children(d,parent);requireThat(Number.isInteger(index)&&index>=0&&index<=list.length,'Invalid destination');list.splice(index,0,id);if(n.name==='Flex')(n.props.sizes as DocumentJson[]).splice(index,0,1);}
export function moveDocumentNode(before:RichDocument,id:string,parent:string,index:number):RichDocument{
 const d=structuredClone(before),parents=parentMap(d),source=parents.get(id);requireThat(source&&id!==d.rootId&&id!==parent&&!ancestorsOf(parent,parents).includes(id),'Invalid move');
 removeChild(d,source,id);insertChild(d,parent,id,index);assertDocument(d);return d;
}
function splitInline(content:DocumentInline[],offset:number):[DocumentInline[],DocumentInline[]]{const left:DocumentInline[]=[],right:DocumentInline[]=[];let rest=offset;
 for(const item of content){const size=item.type==='text'?Array.from(item.text).length:1;if(rest>=size){left.push(item);rest-=size;}else if(rest>0&&item.type==='text'){const chars=Array.from(item.text);left.push({...item,text:chars.slice(0,rest).join('')});right.push({...item,text:chars.slice(rest).join('')});rest=0;}else right.push(item);}
 requireThat(Number.isInteger(offset)&&offset>=0&&rest===0,'Invalid split position');return [left,right];}
export function normalizeInline(content:DocumentInline[]):DocumentInline[]{const out:DocumentInline[]=[];for(const item of content){if(item.type==='text'&&!item.text)continue;const last=out.at(-1);if(last?.type==='text'&&item.type==='text'&&JSON.stringify(last.marks)===JSON.stringify(item.marks))last.text+=item.text;else out.push(structuredClone(item));}return out;}
export function splitDocumentBlock(before:RichDocument,id:string,offset:number,newId:string):RichDocument{
 const d=structuredClone(before),node=d.nodes[id],parent=parentMap(d).get(id);requireThat(node&&prose.has(node.type)&&node.content&&parent&&validNodeId(newId)&&!d.nodes[newId],'Invalid split');const [left,right]=splitInline(node.content,offset);node.content=left;d.nodes[newId]={...structuredClone(node),content:right};insertChild(d,parent,newId,children(d,parent).indexOf(id)+1);assertDocument(d);return d;
}
export function joinDocumentBlocks(before:RichDocument,left:string,right:string):RichDocument{
 const d=structuredClone(before),parents=parentMap(d),p=parents.get(left),a=d.nodes[left],b=d.nodes[right];requireThat(p&&p===parents.get(right)&&children(d,p).indexOf(right)===children(d,p).indexOf(left)+1&&a?.content&&b?.content&&a.type===b.type,'Blocks must be compatible neighbors');a.content=normalizeInline([...a.content,...b.content]);removeChild(d,p,right);delete d.nodes[right];assertDocument(d);return d;
}
export function removeDocumentNodes(before:RichDocument,ids:string[],emptyId:string):RichDocument{
 const d=structuredClone(before),parents=parentMap(d);requireThat(!ids.includes(d.rootId)&&validNodeId(emptyId)&&!d.nodes[emptyId],'Invalid deletion');const selected=new Set(ids),roots=ids.filter(id=>!ancestorsOf(id,parents).some(p=>selected.has(p)));
 function remove(id:string){const n=d.nodes[id];requireThat(n,'Missing node');for(const child of childIds(n))remove(child);delete d.nodes[id];}
 for(const id of roots){const p=parents.get(id);requireThat(p,'Missing parent');removeChild(d,p,id);remove(id);}
 let i=0;for(const [id,n] of Object.entries(d.nodes))if(n.children?.length===0&&['document','listItem','tableCell','blockquote'].includes(n.type)){const fresh=i++?emptyId+'_'+i:emptyId;d.nodes[fresh]={type:'paragraph',props:{},content:[]};insertChild(d,id,fresh,0);}
 assertDocument(d);return d;
}
