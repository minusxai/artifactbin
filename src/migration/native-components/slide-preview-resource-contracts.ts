/** Exact resource evidence supplied to the passive slide-preview image port. */
export interface NativeSlidePreviewImageResource {readonly src:string;readonly sha256:string;readonly bytes:number;readonly mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp'}
export interface NativeSlidePreviewResourceInput {readonly files:readonly {readonly path:string;readonly bytes:Uint8Array;readonly sha256:string}[];readonly urls:readonly {readonly source:string;readonly target:string;readonly sha256:string}[]}
