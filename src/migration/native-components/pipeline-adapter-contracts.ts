import type {NativePipelineRequest,NativePipelineHost,NativePipelineHostContext} from './pipeline-contracts.ts';
import type {NativePipelinePublicationConfiguration,NativePipelinePublicationCallback} from './pipeline-publication-adapter-contracts.ts';
export interface NativePipelineAdapterConfiguration {
 format:'native-pipeline-host-v1';revisionScope:'latest';targetRoot:string;targetRevision:string;
 publication:{path:string;sha256:string};lifecycle:{path:string;sha256:string};
 lifecycleConfiguration?:{path:string;sha256:string};
 authority?:{sourceRevision:string;capabilities:readonly string[];runtime:{actor?:unknown;runtimeActorBySourceUserId?:Readonly<Record<string,unknown>>;origin:string}};sha256:string;
}
/** Actual target owns disposable database/schema/auth/camera setup; no source-specific publication callback. */
export interface NativePipelineLifecycle {
 db:unknown;objectsDirectory:string;fixtureAuthSecret?:string;
 captureAndCompare:NativePipelineHost['captureAndCompare'];dispose():Promise<void>;
}
export interface NativePipelineProductHostOptions {
 db:unknown;objectsDirectory:string;fixtureAuthSecret?:string;
 publication:NativePipelinePublicationCallback;captureAndCompare:NativePipelineHost['captureAndCompare'];
}
export interface NativePipelineAdapterPorts {
 configuration(request:NativePipelineRequest):Promise<{configuration:NativePipelineAdapterConfiguration;publication:NativePipelinePublicationConfiguration}>;
 materialize?(request:NativePipelineRequest,context:NativePipelineHostContext,configuration:NativePipelineAdapterConfiguration,publication:NativePipelinePublicationConfiguration):Promise<NativePipelineHostContext>;
 open(request:NativePipelineRequest,context:NativePipelineHostContext,configuration:NativePipelineAdapterConfiguration):Promise<NativePipelineLifecycle>;
 createProductHost(options:NativePipelineProductHostOptions,configuration:NativePipelineAdapterConfiguration):Promise<NativePipelineHost>;
}
