import type {DocumentGraph,DocumentUpdate,GraphPatch} from '@artifactbin/contracts';
import type {ClientDocumentChange,ClientDocumentSnapshot} from './document-update-client';

/**
 * One save preparation for the worker: the graph rides along only when it changed since the last request — whole
 * when it is small, or `staged`: sent before it in parts (GraphPartRequest), so no one message clones a report's
 * graph on the page thread.
 */
export interface PrepareRequest {id:number;kind?:'prepare';document?:DocumentGraph;staged?:true;base:Omit<ClientDocumentSnapshot,'document'>;change:ClientDocumentChange}
/** A slice of a graph's nodes and claimed ids; the first slice carries the rest of the graph and starts it afresh. No reply. */
interface GraphPartRequest {id:number;kind:'graph-part';graph?:Omit<DocumentGraph,'nodes'|'claimedIds'>;nodes:DocumentGraph['nodes'];claimedIds:DocumentGraph['claimedIds']}
/** An accepted save: the worker advances the graph it holds by the patch the server applied, and answers its source. */
interface AdvanceRequest {id:number;kind:'advance';version:number;patch:GraphPatch}
export type WorkerRequest=PrepareRequest|AdvanceRequest|GraphPartRequest;
/** A refusal comes back as its message, so the page reports exactly what the in-page preparation would. */
export type PrepareResponse={id:number;ok:true;update:DocumentUpdate;context?:string}|{id:number;ok:true;source:string}|{id:number;ok:false;message:string};
