/** Isomorphic admission for inert text operations. Non-prose (SQL, CSS, row
 * expressions, scripts, references) remains with the complete JSX publisher.
 * Certification is installed only after publication, never by a read migration.
 */
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
export interface ProseOperation {path:string[];oldText:string;newText:string}
const scanner=/\b(?:class(?:Name)?|data-design|style)\s*=|<\/?style\b|\{\s*\$_row\.|\/people\//i;
export const inertProse=(value:unknown):value is string=>typeof value==='string'&&!value.includes('\0')&&!value.includes('\r')&&value.isWellFormed()&&!scanner.test(value);
export const proseSource=(value:string):string=>serializeJsx([{type:'text',value,start:0,end:0}]);
/** The client only suggests the operation. SQL checks the server-owned slot and
 * its epoch/revision; client parsing is never a validation certificate. */
export function proseOperation(before:string,after:string):ProseOperation|null{
 const a=parseJsx(before),b=parseJsx(after);if(!a.ok||!b.ok)return null;
 let result:ProseOperation|null=null,valid=true;
 const strip=(v:unknown):unknown=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='start'&&k!=='end').map(([k,x])=>[k,strip(x)])):v;
 const visit=(x:unknown,y:unknown,path:string[])=>{
  if(JSON.stringify(strip(x))===JSON.stringify(strip(y)))return;
  if(x&&y&&typeof x==='object'&&typeof y==='object'&&'type'in x&&'type'in y&&x.type==='text'&&y.type==='text'&&'value'in x&&'value'in y){
   const left=x as {value:unknown},right=y as {value:unknown};
   if(inertProse(left.value)&&inertProse(right.value)&&right.value.length&&!result){result={path:[...path,'value'],oldText:left.value,newText:right.value};return;}
   valid=false;return;
  }
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
