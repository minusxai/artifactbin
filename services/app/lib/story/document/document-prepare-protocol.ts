import type {DocumentGraph,DocumentUpdate,GraphPatch} from '@artifactbin/contracts';
import type {ClientDocumentChange,ClientDocumentSnapshot} from '../graph/document-update-client';

/** One save preparation for the worker: the graph rides along only when it changed since the last request. */
export interface PrepareRequest {id:number;kind?:'prepare';document?:DocumentGraph;base:Omit<ClientDocumentSnapshot,'document'>;change:ClientDocumentChange}
/** An accepted save: the worker advances the graph it holds by the patch the server applied, and answers its source. */
export interface AdvanceRequest {id:number;kind:'advance';version:number;patch:GraphPatch}
export type WorkerRequest=PrepareRequest|AdvanceRequest;
/** A refusal comes back as its message, so the page reports exactly what the in-page preparation would. */
export type PrepareResponse={id:number;ok:true;update:DocumentUpdate;context?:string}|{id:number;ok:true;source:string}|{id:number;ok:false;message:string};
