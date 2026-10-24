import type {NativePipelineHostContext} from './pipeline-contracts.ts';
import type {NativePublicationBytes,NativePublicationSharedInput,NativeSerializedProductRecipe} from './pipeline-publication-contracts.ts';
import type {NativeV3AssemblyReceipt,NativeV3PublicationModules,NativeV3PublicationHost} from './v3-publication-contracts.ts';
/** One reviewed configuration for the whole selected batch, not a page-specific callback. */
export interface NativePipelinePublicationConfiguration {
 selectionManifest:NativePublicationBytes; approvedSelectionManifestSha256:string;
 refreshManifest?:NativePublicationBytes; approvedRefreshManifestSha256?:string;
 shared:NativePublicationSharedInput; relations:NativePublicationBytes; exportedAt:string; coreUrl:string;
}
export interface NativePipelinePublicationInvocation {
 context:NativePipelineHostContext;
 reviewedRecipe:{assemblySha256:string;authority:{appSchema:string;authSchema:string}};
 files:{sourceHead:Uint8Array;comments:Uint8Array;compiledHtml:Uint8Array};
 publicationModules:NativeV3PublicationModules;
 prepareRuntime(assemblies:readonly NativeV3AssemblyReceipt[],options:{pageId:string;visibility:'public'|'private'|'unlisted';shares:readonly {email:string;role:'viewer'|'commenter'|'editor'}[]}):Promise<{prepareBundle:NonNullable<NativeV3PublicationHost['prepareBundle']>}>;
}
export type NativePipelinePublicationCallback=(input:NativePipelinePublicationInvocation)=>Promise<NativeSerializedProductRecipe>;
