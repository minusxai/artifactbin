/** Exact resource evidence supplied to the passive slide-preview image port. */
export interface NativeSlidePreviewImagePlaceholderResource {readonly src:string;readonly sha256:string;readonly bytes:number;readonly mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp';readonly backgroundSize:'cover';readonly backgroundRepeat:'no-repeat'}
export interface NativeSlidePreviewImageResource {readonly src:string;readonly sha256:string;readonly bytes:number;readonly mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp';readonly placeholder?:NativeSlidePreviewImagePlaceholderResource}
export interface NativeSlidePreviewResourceInput {readonly files:readonly {readonly path:string;readonly bytes:Uint8Array;readonly sha256:string}[];readonly urls:readonly {readonly source:string;readonly target:string;readonly sha256:string}[]}

/** An inert, source-byte-bound HTML dependency surface used by ordinary publication URL rewriting. */
export interface NativeSlidePreviewResourceProjection {readonly descriptorSha256:string;readonly templateHtml:string;readonly registrationExpression:string}
export interface NativeSlidePreviewResourceProjectionInput {readonly resources:readonly NativeSlidePreviewImageResource[];readonly authoredHtml:string}

/** The sole additional image attribute inserted by ordinary HTML persistence after assembly. */
export interface NativeSlidePreviewPlatformIdentityPolicy {readonly attribute:'data-af-id';readonly valuePattern:'^af-[1-9][0-9]*$'}

/** Compiler-attested image metadata paint; never taken from arbitrary rendered HTML. */
export interface NativeSlidePreviewPlaceholderInput {readonly resources:readonly NativeSlidePreviewImageResource[];readonly analysis:import('./analyze-contracts.ts').NativeTypedAnalysis;readonly presentation?:import('./assemble-contracts.ts').NativeAssemblyPresentation;readonly urls:readonly {readonly source:string;readonly target:string;readonly sha256:string}[];readonly sourceImages?:readonly NativeSlidePreviewSourceImage[]}
export interface NativeSlidePreviewPlaceholderProof {readonly sourceNode:string;readonly sourceNodeSha256:string;readonly sourceRef:string;readonly imageSourceRowSha256:string;readonly sourceSha256:string;readonly analysisSha256:string;readonly compilerSha256:string;readonly resourcePatchSha256:string;readonly sourceStyleSha256:string;readonly primarySrc:string;readonly primarySha256:string;readonly sourceUrls:readonly string[];readonly placeholder:NativeSlidePreviewImagePlaceholderResource}
export interface NativeSlidePreviewPlaceholderResult {readonly resources:readonly NativeSlidePreviewImageResource[];readonly proofs:readonly NativeSlidePreviewPlaceholderProof[]}

/** Exact canonical image metadata and the already verified full primary object asset. */
export interface NativeSlidePreviewSourceRow {readonly row:Readonly<Record<string,unknown>>;readonly rowSha256:string}
export interface NativeSlidePreviewSourceImage extends NativeSlidePreviewSourceRow {readonly primarySha256:string;readonly primarySourceUrls:readonly string[]}
