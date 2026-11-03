/** Trusted authoring clients prepare data, never SQL or authorization predicates. */

/** The largest document source, in UTF-8 bytes: the publish door, the graph write, a prepared update and the skill guide all state this one number. */
export const MAX_DOCUMENT_BYTES=2_000_000;
type DocumentTree={schema:1;kind:'jsx';roots:unknown[]}|{schema:1;kind:'source';source:string};
type JsonDocumentPatch=
 | {kind:'set'|'insert';path:string[];value:unknown}
 | {kind:'delete';path:string[]}
 | {kind:'text';path:string[];value:string;start:number;deleteCount:number};
interface DocumentGraphNode {
 ast:DocumentTree|null;selectors:string[];refs:Array<{id:string;kind:string}>;
 parent:string|null;children:string[];parts:string[];bytes:number;units:number;partUnits:number[];subtreeUnits:number;prose:boolean;
 selfVersion:number;childrenVersion:number;subtreeVersion:number;
}
export interface DocumentGraph {
 schema:3;kind:'graph';policy:string;nodes:Record<string,DocumentGraphNode>;claimedIds:Record<string,number>;bytes:number;
}
type GraphFacet='selfVersion'|'childrenVersion'|'subtreeVersion';
interface GraphRead {key:string;facet:GraphFacet;version:number}
interface GraphNodeWrite {patches:JsonDocumentPatch[];self:boolean;children:boolean}
export interface GraphPatch {
 baseVersion:number;reads:GraphRead[];selections:Array<{selector:string;keys:string[]}>;
 inserted:Record<string,DocumentGraphNode>;removed:string[];updated:Record<string,GraphNodeWrite>;touched:string[];
 byteDelta:number;unitDeltas:Record<string,number>;claims:Array<{id:string;version:number|null}>;
}

