/** Ordered literal packing shared by legacy trees and normalized graph nodes. */
import {parseJsx} from '../jsx/parse';
import type {JsxNode} from '../jsx/types';
type Packed = ['value', unknown] | ['string16', string] | ['array', Packed[]] | ['object', Array<[string | Packed, Packed]>];
import type {DocumentTree as StoredTree} from '@artifactbin/contracts';
export type {DocumentTree as StoredTree} from '@artifactbin/contracts';
function encode16(value:string):string {let bytes='';for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);bytes+=String.fromCharCode(n&255,n>>>8);}return btoa(bytes);}
function decode16(value:string):string {const bytes=atob(value);let text='';for(let i=0;i<bytes.length;i+=2)text+=String.fromCharCode(bytes.charCodeAt(i)|(bytes.charCodeAt(i+1)<<8));return text;}
const needsEncoding=(v:unknown):v is string=>typeof v==='string'&&(v.includes('\0')||!v.isWellFormed());
function pack(v:unknown):Packed {
 if(needsEncoding(v))return ['string16',encode16(v)];
 if(Array.isArray(v))return ['array',v.map(pack)];
 if(v&&typeof v==='object')return ['object',Object.entries(v).map(([k,x])=>[needsEncoding(k)?pack(k):k,pack(x)])];
 return ['value',v];
}
function unpack(v:Packed):unknown {
 switch(v[0]){
  case 'string16':return decode16(v[1]);
  case 'array':return v[1].map(unpack);
  case 'object':return Object.fromEntries(v[1].map(([k,x])=>[typeof k==='string'?k:unpack(k),unpack(x)]));
  case 'value':return v[1];
 }
}
function encode(v:unknown):unknown {
 if(Array.isArray(v))return v.map(encode);
 if(!v||typeof v!=='object')return v;
 return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='start'&&k!=='end').map(([k,x])=>[k,k==='json'?pack(x):encode(x)]));
}
function decode(v:unknown):unknown {
 if(Array.isArray(v))return v.map(decode);
 if(!v||typeof v!=='object')return v;
 return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='json'?unpack(x as Packed):decode(x)]));
}
export const encodeDocumentNodes=(nodes:JsxNode[]):StoredTree=>({schema:1,kind:'jsx',roots:encode(nodes) as unknown[]});
export function decodeDocumentNodes(tree:StoredTree):JsxNode[]{
 if(tree.kind==='jsx')return decode(tree.roots) as JsxNode[];
 const parsed=parseJsx(tree.source);if(!parsed.ok)throw new Error(parsed.error);return parsed.nodes;
}
