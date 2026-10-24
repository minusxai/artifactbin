import type {TokenHoldingActor} from '@/lib/accounts';
import type {publishBundleDependencies} from '@/lib/html-publication-bundle';
/** Structurally accepts the admitted assembly receipt; admission remains the projector's responsibility. */
export interface NativeRuntimeAssembly {
 key:{sourceNamespace:string;sourceId:string;version:number};
 sha256:string;
 result:{status:string;html?:string;htmlSha256?:string;files?:readonly {path:string;bytes:Uint8Array;sha256:string}[]};
}
export interface NativeRuntimePreparation {
 pageId:string;
 key:NativeRuntimeAssembly['key'];
 assemblySha256:string;
 sourceHtmlSha256:string;
 html:string;
 htmlSha256:string;
 fileDigests:readonly {path:string;sha256:string}[];
 /** Normal serving metadata: MUST be retained on the corresponding saved page version. */
 dependencies:Readonly<Awaited<ReturnType<typeof publishBundleDependencies>>['receipts']>;
 objects:readonly {path:string;id:string;revision:string;objectKey:string;sha256:string;bytes:number;contentType:string}[];
 assetsSha256:string;
}
export interface NativeRuntimePreparationOptions {
 pageId:string;
 actor:TokenHoldingActor;
 /** Existing application origin, used for normal local API request envelopes; no network call. */
 origin:string;
 visibility:'private'|'unlisted'|'public';
 shares?:readonly {email:string;role:'viewer'|'commenter'|'editor'}[];
}
