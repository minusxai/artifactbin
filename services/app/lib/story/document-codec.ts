/** Storage is data, never executable JSX. Literal objects use ordered entries because
 * JSONB key order must not change source hashes, SQL literals or edit-log offsets.
 * Legacy noncanonical sources remain exact until an ordinary validated publication.
 */
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import type {JsxNode} from '../jsx/types';

type Packed = ['value', unknown] | ['string16', string] | ['array', Packed[]] | ['object', Array<[string | Packed, Packed]>];
export type StoredDocument = {schema: 1; kind: 'jsx'; roots: unknown[]} | {schema: 1; kind: 'source'; source: string};
const needsEncoding=(v:unknown):v is string=>typeof v==='string'&&(v.includes('\0')||!v.isWellFormed());
function pack(v:unknown):Packed {
 if(needsEncoding(v))return ['string16',Buffer.from(v,'utf16le').toString('base64')];
 if(Array.isArray(v))return ['array',v.map(pack)];
 if(v&&typeof v==='object')return ['object',Object.entries(v).map(([k,x])=>[needsEncoding(k)?pack(k):k,pack(x)])];
 return ['value',v];
}
function unpack(v:Packed):unknown {
 switch(v[0]){
  case 'string16':return Buffer.from(v[1],'base64').toString('utf16le');
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
export function encodeDocument(source:string):StoredDocument {
 const parsed=parseJsx(source);
 if(parsed.ok){
  const document:StoredDocument={schema:1,kind:'jsx',roots:encode(parsed.nodes) as unknown[]};
  if(decodeDocument(document)===source)return document;
 }
 // A storage migration must not normalize an old source behind existing edit IDs.
 // Validated writes normally take the AST branch; grandfathered bytes remain readable.
 return {schema:1,kind:'source',source};
}
export function decodeDocument(document:StoredDocument):string {
 if(!document||document.schema!==1)throw new Error('Unsupported document storage schema');
 if(document.kind==='source'&&typeof document.source==='string')return document.source;
 if(document.kind==='jsx'&&Array.isArray(document.roots))return serializeJsx(decode(document.roots) as JsxNode[]);
 throw new Error('Invalid stored document');
}
