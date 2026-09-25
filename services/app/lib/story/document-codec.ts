/** Storage is data, never executable JSX. Literal objects use ordered entries because
 * JSONB key order must not change source hashes, SQL literals or edit-log offsets.
 * Legacy noncanonical sources remain exact until an ordinary validated publication.
 */
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import type {JsxNode} from '../jsx/types';

import {graphSource,type DocumentGraph} from './document-graph';
import {encodeDocumentNodes,decodeDocumentNodes,type StoredTree} from './document-node-codec';
export {encodeDocumentNodes,decodeDocumentNodes,type StoredTree} from './document-node-codec';
export interface StoredProse {value:string;source:string;bytes:number;units:number;revision:number;fixedStart:number;order:number}
export interface SemanticDocument {schema:2;kind:'semantic';tree:StoredTree;prose:Record<string,StoredProse>;epoch:string;hash:string;bytes:number;policy:string;contextRequired:boolean}
export type StoredDocument=StoredTree|SemanticDocument|DocumentGraph;
export function encodeDocument(source:string):StoredTree {
 const parsed=parseJsx(source);
 if(parsed.ok){
  const document=encodeDocumentNodes(parsed.nodes);
  if(decodeDocument(document)===source)return document;
 }
 // A storage migration must not normalize an old source behind existing edit IDs.
 // Validated writes normally take the AST branch; grandfathered bytes remain readable.
 return {schema:1,kind:'source',source};
}
export function decodeDocument(document:StoredDocument):string {
 if(document?.schema===3&&document.kind==='graph')return graphSource(document);
 if(document?.schema===2&&document.kind==='semantic'){
  const nodes=decodeDocumentNodes(document.tree);
  const visit=(node:JsxNode & {slot?:string})=>{
   if(node.type==='text'&&node.slot){const value=document.prose[node.slot];if(!value)throw new Error('Missing prose slot');node.value=value.value;}
   if(node.type==='element')node.children.forEach(visit);
  };nodes.forEach(visit);return serializeJsx(nodes);
 }
 if(!document||document.schema!==1)throw new Error('Unsupported document storage schema');
 if(document.kind==='source'&&typeof document.source==='string')return document.source;
 if(document.kind==='jsx'&&Array.isArray(document.roots))return serializeJsx(decodeDocumentNodes(document));
 throw new Error('Invalid stored document');
}
