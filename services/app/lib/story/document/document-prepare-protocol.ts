import type {DocumentGraph,DocumentUpdate} from '@artifactbin/contracts';
import type {ClientDocumentChange,ClientDocumentSnapshot} from '../graph/document-update-client';

/** One save preparation for the worker: the graph rides along only when it changed since the last request. */
export interface PrepareRequest {id:number;document?:DocumentGraph;base:Omit<ClientDocumentSnapshot,'document'>;change:ClientDocumentChange}
/** A refusal comes back as its message, so the page reports exactly what the in-page preparation would. */
export type PrepareResponse={id:number;ok:true;update:DocumentUpdate;context?:string}|{id:number;ok:false;message:string};
