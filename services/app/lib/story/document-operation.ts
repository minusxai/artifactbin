/** Pure candidate construction, not publication admission. Every result must pass
 * the complete publisher before a server-owned certificate can reach SQL. */
import {MAX_DOCUMENT_OPERATIONS,type DocumentOperation,type DocumentPath,type DocumentValue} from '@artifactbin/contracts';
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import type {JsxNode,JsxElement} from '../jsx/types';

export class DocumentOperationError extends Error {
 constructor(message:string,readonly operationIndex:number){super(message);this.name='DocumentOperationError';}
}
const validPath=(path:unknown):path is DocumentPath=>Array.isArray(path)&&path.length<=128&&path.every(index=>Number.isSafeInteger(index)&&index>=0);
const validValue=(value:unknown,depth=0):value is DocumentValue=>depth<128&&(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||Array.isArray(value)&&value.every(x=>validValue(x,depth+1))||!!value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Object.values(value).every(x=>validValue(x,depth+1)));
export function parseDocumentOperations(value:unknown):DocumentOperation[]|null {
 if(!Array.isArray(value)||!value.length||value.length>MAX_DOCUMENT_OPERATIONS)return null;
 for(const op of value){
  if(!op||typeof op!=='object')return null;
  if(op.kind==='replaceDocument'){if(typeof op.source!=='string')return null;continue;}
  if(op.kind==='insert'){if(!validPath(op.parent)||!Number.isSafeInteger(op.index)||op.index<0||typeof op.source!=='string')return null;continue;}
  if(!validPath(op.path)||!op.path.length)return null;
  switch(op.kind){
   case 'setText':if(typeof op.value!=='string')return null;break;
   case 'setAttribute':if(!validValue(op.value))return null;
   // Both attribute operations share name validation.
   // eslint-disable-next-line no-fallthrough
   case 'removeAttribute':if(typeof op.name!=='string'||!/^[A-Za-z_][\w:.-]*$/.test(op.name))return null;break;
   case 'replace':if(typeof op.source!=='string')return null;break;
   case 'move':if(!validPath(op.parent)||!Number.isSafeInteger(op.index)||op.index<0)return null;break;
   case 'delete':break;
   default:return null;
  }
 }
 return value as DocumentOperation[];
}
export function applyDocumentOperations(source:string,operations:readonly DocumentOperation[]):string {
 const parsed=parseJsx(source);
 if(!parsed.ok)throw new DocumentOperationError(parsed.error,-1);
 return serializeJsx(applyOperationsToNodes(parsed.nodes,operations));
}
/** Internal projection planning retains server-owned slot annotations on nodes. */
export function applyOperationsToNodes(nodes:JsxNode[],operations:readonly DocumentOperation[]):JsxNode[] {
 if(!parseDocumentOperations(operations))throw new DocumentOperationError('Malformed document operations',-1);
 let operationIndex=-1;
 const fail=(message:string):never=>{throw new DocumentOperationError(message,operationIndex);};
 const parse=(text:string):JsxNode[]=>{const parsed=parseJsx(text);return parsed.ok?parsed.nodes:fail(parsed.error);};
 let roots=structuredClone(nodes);
 const list=(path:DocumentPath):JsxNode[]=>{
  let result=roots;
  for(const index of path){const node=result[index];if(!node||node.type!=='element')return fail('Parent is not an element');result=node.children;}
  return result;
 };
 const nodeAt=(path:DocumentPath):JsxNode=>list(path.slice(0,-1))[path[path.length-1]!]??fail('Node does not exist');
 for(const op of operations){
  operationIndex++;
  if(op.kind==='replaceDocument'){roots=parse(op.source);continue;}
  if(op.kind==='insert'){const target=list(op.parent);if(op.index>target.length)fail('Insertion index is out of range');target.splice(op.index,0,...parse(op.source));continue;}
  const node=nodeAt(op.path);
  switch(op.kind){
   case 'setText':if(node.type!=='text')fail('Target is not a text node');else {node.value=op.value;delete (node as JsxNode & {slot?:string}).slot;}break;
   case 'setAttribute':case 'removeAttribute':{
    if(node.type!=='element')fail('Target is not an element');
    const element=node as JsxElement,index=element.attributes.findIndex(a=>a.name===op.name);
    if(op.kind==='removeAttribute'){if(index>=0)element.attributes.splice(index,1);break;}
    const attribute={name:op.name,value:{static:true as const,json:structuredClone(op.value)},start:0,end:0};
    if(index>=0)element.attributes[index]=attribute;else element.attributes.push(attribute);break;
   }
   case 'delete':case 'replace':{
    list(op.path.slice(0,-1)).splice(op.path[op.path.length-1]!,1,...(op.kind==='replace'?parse(op.source):[]));break;
   }
   case 'move':{
    if(op.parent.length>=op.path.length&&op.path.every((index,i)=>index===op.parent[i]))fail('Cannot move a node into itself or its descendant');
    const target=list(op.parent),origin=list(op.path.slice(0,-1));
    const max=target.length-(target===origin?1:0);if(op.index>max)fail('Move index is out of range');
    origin.splice(op.path[op.path.length-1]!,1);target.splice(op.index,0,node);break;
   }
  }
 }
 return roots;
}
