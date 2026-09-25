/** Isomorphic admission for inert text operations. Non-prose (SQL, CSS, row
 * expressions, scripts, references) remains with the complete JSX publisher.
 * Certification is installed only after publication, never by a read migration.
 */
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import type {JsxNode} from '../jsx/types';
export const PROSE_POLICY='inert-prose-v1';
export interface ProseOperation {path:string[];oldText:string;newText:string}
export interface ProseSlot {path:string[];fixedStart:number;order:number;units:number;revision:number}
export interface ProseCertificate {epoch:string;bytes:number;slots:Record<string,ProseSlot>}
const plain=new Set(['section','article','div','p','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','blockquote','header','footer','main','aside','b','i','u','s']);
const scanner=/\b(?:class(?:Name)?|data-design|style)\s*=|<\/?style\b|\{\s*\$_row\.|\/people\//i;
export const inertProse=(value:unknown):value is string=>typeof value==='string'&&!value.includes('\0')&&!value.includes('\r')&&value.isWellFormed()&&!scanner.test(value);
export const proseSource=(value:string):string=>serializeJsx([{type:'text',value,start:0,end:0}]);
export function proseSlots(source:string):Record<string,ProseSlot>|null{
 const parsed=parseJsx(source);if(!parsed.ok||serializeJsx(parsed.nodes)!==source)return null;
 const slots:Record<string,ProseSlot>={};let precedingUnits=0,order=0;
 const visit=(node:JsxNode,path:string[]):boolean=>{
  if(node.type==='text'){
   if(!inertProse(node.value)||source.slice(node.start,node.end)!==proseSource(node.value))return false;
   const valuePath=[...path,'value'];slots[JSON.stringify(valuePath)]={path:valuePath,fixedStart:node.start-precedingUnits,order:order++,units:node.end-node.start,revision:0};precedingUnits+=node.end-node.start;return true;
  }
  return node.type==='element'&&!node.control&&plain.has(node.tag)&&node.attributes.every(a=>['id','className'].includes(a.name)&&a.value.static&&typeof a.value.json==='string'&&!/["'=<>]/.test(a.value.json))&&node.children.every((child,i)=>visit(child,[...path,'children',String(i)]));
 };
 return parsed.nodes.every((node,i)=>visit(node,['roots',String(i)]))?slots:null;
}
/** The client only suggests the operation. SQL checks the server-owned slot and
 * its epoch/revision; client parsing is never a validation certificate. */
export function proseOperation(before:string,after:string):ProseOperation|null{
 const a=parseJsx(before),b=parseJsx(after);if(!a.ok||!b.ok)return null;
 const slots=proseSlots(before);if(!slots)return null;
 let result:ProseOperation|null=null,valid=true;
 const strip=(v:unknown):unknown=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='start'&&k!=='end').map(([k,x])=>[k,strip(x)])):v;
 const visit=(x:unknown,y:unknown,path:string[])=>{
  if(JSON.stringify(strip(x))===JSON.stringify(strip(y)))return;
  const slot=slots[JSON.stringify(path)];
  if(slot&&inertProse(x)&&inertProse(y)&&y.length>0&&!result){result={path,oldText:x,newText:y};return;}
  if(Array.isArray(x)&&Array.isArray(y)&&x.length===y.length){x.forEach((v,i)=>visit(v,y[i],[...path,String(i)]));return;}
  if(x&&y&&typeof x==='object'&&typeof y==='object'&&!Array.isArray(x)&&!Array.isArray(y)){
   const ax=x as Record<string,unknown>,by=y as Record<string,unknown>,keys=Object.keys(ax).filter(k=>k!=='start'&&k!=='end');
   if(keys.length===Object.keys(by).filter(k=>k!=='start'&&k!=='end').length&&keys.every(k=>Object.hasOwn(by,k))){keys.forEach(k=>visit(ax[k],by[k],[...path,k]));return;}
  }
  valid=false;
 };
 visit({roots:a.nodes},{roots:b.nodes},[]);return valid?result:null;
}

export function applyProseOperation(source:string,op:ProseOperation):string|null{
 if(!inertProse(op.oldText)||!inertProse(op.newText)||!Array.isArray(op.path)||op.path.at(-1)!=='value')return null;
 const parsed=parseJsx(source);if(!parsed.ok)return null;
 let node:unknown={roots:parsed.nodes};
 for(const key of op.path.slice(0,-1)){
  if(!node||typeof node!=='object'||!Object.hasOwn(node,key))return null;
  node=(node as Record<string,unknown>)[key];
 }
 if(!node||typeof node!=='object')return null;
 const text=node as {type?:string;value?:string};
 if(text.type!=='text'||text.value!==op.oldText)return null;
 text.value=op.newText;return serializeJsx(parsed.nodes);
}
