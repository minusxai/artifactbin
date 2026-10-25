import type {NativePipelineHostContext} from './pipeline-contracts.ts';
import type {NativeAssemblyFile,NativeAssemblyInput,NativeAssemblyResult} from './assemble-contracts.ts';
import type {NativeV3AssemblyReceipt} from './v3-publication-contracts.ts';
export interface NativePipelineEncodedFile extends Omit<NativeAssemblyFile,'bytes'>{bytes:{encoding:'base64';data:string;sha256:string}}
export interface NativePipelineContextWire {
 format:'native-pipeline-host-context-v1';
 context:Omit<NativePipelineHostContext,'assembly'>&{assembly:Omit<NativeV3AssemblyReceipt,'input'|'result'>&{input:Omit<NativeAssemblyInput,'files'>&{files?:readonly NativePipelineEncodedFile[]};result:(Omit<Extract<NativeAssemblyResult,{status:'complete'}>,'files'>&{files:readonly NativePipelineEncodedFile[]})|Extract<NativeAssemblyResult,{status:'blocked'}>}};
 sha256:string;
}
