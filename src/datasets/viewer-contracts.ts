import type { DatasetCallContext } from './contracts.ts';
/** Read-only original reader subject. No email, runtime actor or credentials. */
export interface DatasetViewerSnapshot {
 generation:string;
 /** Null means an actual guest; authenticated unmapped identities are unavailable. */
 id:string|null;
}
export interface DatasetViewerPorts {
 snapshot(context:DatasetCallContext,signal?:AbortSignal):Promise<DatasetViewerSnapshot|null>;
}
export interface DatasetViewerService {
 viewer(context:DatasetCallContext,signal?:AbortSignal):Promise<DatasetViewerSnapshot>;
}
