import {createHash} from 'node:crypto';
import {nativeDigest} from './selection.ts';import {nativeReceiptDigest} from './receipt-digest.ts';
import type {NativePipelineHostContext} from './pipeline-contracts.ts';import type {NativeAssemblyFile} from './assemble-contracts.ts';
import type {NativePipelineContextWire,NativePipelineEncodedFile} from './pipeline-context-contracts.ts';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function encodeFile(file:NativeAssemblyFile):NativePipelineEncodedFile{if(!(file.bytes instanceof Uint8Array)||hash(file.bytes)!==file.sha256)throw Error('native_pipeline_context_file_digest');return {...file,bytes:{encoding:'base64',data:Buffer.from(file.bytes).toString('base64'),sha256:file.sha256}};}
function decodeFile(file:NativePipelineEncodedFile):NativeAssemblyFile{if(file.bytes?.encoding!=='base64'||typeof file.bytes.data!=='string')throw Error('native_pipeline_context_file_encoding');const bytes=Buffer.from(file.bytes.data,'base64');if(bytes.toString('base64')!==file.bytes.data||hash(bytes)!==file.sha256||file.bytes.sha256!==file.sha256)throw Error('native_pipeline_context_file_digest');return {...file,bytes:new Uint8Array(bytes)};}
/** Only the two assembly file collections are binary transport fields. Authored literals are never revived. */
export function encodeNativePipelineContext(context:NativePipelineHostContext):NativePipelineContextWire{
 const assembly=context.assembly,{sha256,...body}=assembly;if(nativeReceiptDigest(body)!==sha256)throw Error('native_pipeline_context_assembly_digest');
 const {files,...inputBody}=assembly.input;const input={...inputBody,...(files?{files:files.map(encodeFile)}:{})},result=assembly.result.status==='complete'?{...assembly.result,files:assembly.result.files.map(encodeFile)}:assembly.result;
 const payload={format:'native-pipeline-host-context-v1' as const,context:{...context,assembly:{...assembly,input,result}}};return {...payload,sha256:nativeDigest(payload)};
}
export function decodeNativePipelineContext(wire:NativePipelineContextWire):NativePipelineHostContext{
 const {sha256,...body}=wire;if(wire.format!=='native-pipeline-host-context-v1'||nativeDigest(body)!==sha256)throw Error('native_pipeline_context_digest');
 const assembly=wire.context.assembly,{files,...inputBody}=assembly.input,input={...inputBody,...(files?{files:files.map(decodeFile)}:{})},result=assembly.result.status==='complete'?{...assembly.result,files:assembly.result.files.map(decodeFile)}:assembly.result;
 const decoded={...wire.context,assembly:{...assembly,input,result}},{sha256:assemblySha,...assemblyBody}=decoded.assembly;if(nativeReceiptDigest(assemblyBody)!==assemblySha)throw Error('native_pipeline_context_assembly_digest');return decoded;
}
