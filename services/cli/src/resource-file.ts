import {ARTIFACT_RESOURCE_TYPES,type ArtifactResourceFile} from '@artifactbin/contracts';
import {parseDatasetPolicy} from '../../utils/src/dataset-policy';
import {dirname,extname,isAbsolute,relative,resolve} from 'node:path';
import {enumArgument} from './arguments';
import {CliError} from './errors';
import {identityFields,metadataFields,normalizeMetadata,parseLiteralYaml,parseDocument} from './document';
import {confinedPath} from './journal';
import {readOptional} from './files';
import {assetInput} from './dependencies';
import {stringify} from 'yaml';
import type {Snapshot} from './workspace';
import {snapshotDocument} from './local';
import {isDeepStrictEqual} from 'node:util';

export interface ResourceSource {path:string;bytes:string;version?:number}
export type ResourceReconciliation={ok:true;resource:ArtifactResourceFile}|{ok:false;fields:string[]};
export function reconcileResource(base:ArtifactResourceFile,local:ArtifactResourceFile,remote:ArtifactResourceFile):ResourceReconciliation{
 if(base.type!==local.type||base.type!==remote.type)return {ok:false,fields:['type']};
 const result={...remote} as Record<string,unknown>,before=base as unknown as Record<string,unknown>,current=remote as unknown as Record<string,unknown>,fields:string[]=[];
 for(const [key,value] of Object.entries(local)){
  if(key==='type'||identityFields.includes(key as never)||key==='policy_revision'||value===undefined||isDeepStrictEqual(value,before[key]))continue;
  if(!isDeepStrictEqual(current[key],before[key])&&!isDeepStrictEqual(value,current[key]))fields.push(key);
  else result[key]=value;
 }
 return fields.length?{ok:false,fields}:{ok:true,resource:result as unknown as ArtifactResourceFile};
}
export async function readResourceSource(resource:ArtifactResourceFile,path:string,root:string):Promise<ResourceSource|undefined>{
 if(resource.type==='folder'||resource.source===undefined)return;
 const source=await confinedPath(root,resolve(root,dirname(path),resource.source));
 const bytes=await readOptional(source);if(!bytes)throw new CliError('missing_source',`Cannot read source ${resource.source}.`);
 return {path:relative(root,source),bytes:bytes.toString('base64')};
}
export function writeResourceFile(resource:ArtifactResourceFile):string{return stringify(resource,{lineWidth:0});}
export function snapshotResource(snapshot:Snapshot,previous:ArtifactResourceFile):ArtifactResourceFile{
 const metadata=snapshotDocument(snapshot).metadata;
 const source='source'in previous?{source:previous.source}:{};
 return {...metadata,type:previous.type,...source,...(previous.type==='dataset'?{
  ...(snapshot.access!==undefined?{access:snapshot.access as 'read'|'readwrite'}:{}),
  ...(snapshot.dataset_policy!==undefined?{policy:snapshot.dataset_policy as Extract<ArtifactResourceFile,{type:'dataset'}>['policy']}:{}),
  ...(snapshot.policy_revision!==undefined?{policy_revision:Number(snapshot.policy_revision)}:{}),
 }:{})} as ArtifactResourceFile;
}

export function parseResourceFile(source:string):ArtifactResourceFile {
 const value=parseLiteralYaml(source);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new CliError('invalid_resource','Resource YAML must be a mapping.');
 const input=value as Record<string,unknown>;
 const type=enumArgument(input.type,ARTIFACT_RESOURCE_TYPES,'type');
 const domain=type==='dataset'?['source','access','policy','policy_revision']:type==='folder'?[]:['source'];
 const common=[...identityFields,...metadataFields];
 for(const key of Object.keys(input))if(key!=='type'&&!common.includes(key as never)&&!domain.includes(key))throw new CliError('unknown_resource_field',`Unknown ${type} field ${key}.`,`Use: type, ${[...common,...domain].join(', ')}.`);
 const result:Record<string,unknown>={type,...normalizeMetadata(Object.fromEntries(Object.entries(input).filter(([key])=>common.includes(key as never))))};
 if(input.source!==undefined){
  if(typeof input.source!=='string'||!input.source||input.source.includes('\0')||isAbsolute(input.source)||/^(?:[a-z][a-z0-9+.-]*:|\\\\)/i.test(input.source))throw new CliError('invalid_resource_source','source must name a local workspace file.');
  result.source=input.source;
 }
 if(input.access!==undefined)result.access=enumArgument(input.access,['read','readwrite'],'access');
 if(input.policy!==undefined){try{result.policy=input.policy===null?null:parseDatasetPolicy(input.policy);}catch(error){throw new CliError('invalid_policy',error instanceof Error?error.message:'Invalid dataset policy.');}}
 if(input.policy_revision!==undefined){
  if(!Number.isSafeInteger(input.policy_revision)||Number(input.policy_revision)<0)throw new CliError('invalid_policy_revision','policy_revision must be a nonnegative integer.');
  result.policy_revision=input.policy_revision;
 }
 return result as unknown as ArtifactResourceFile;
}

/** Read only explicitly named local bytes; shared confinement also rejects escaping symlinks. */
export async function resourceContent(resource:ArtifactResourceFile,path:string,root:string,frozen?:ResourceSource):Promise<Record<string,unknown>>{
 if(resource.type==='folder')return {format:'folder'};
 if(resource.source===undefined){
  if(!resource.id)throw new CliError('resource_source_required',`A new ${resource.type} requires source.`,`Set source to its local ${resource.type==='dataset'?'CSV/JSON':resource.type==='artifact'?'JSX':'asset'} file.`);
  return {};
 }
 const captured=frozen??await readResourceSource(resource,path,root);
 const source=captured!.path,bytes=Buffer.from(captured!.bytes,'base64');
 const extension=extname(source).toLowerCase();
 if(resource.type==='artifact'){
  if(extension!=='.jsx')throw new CliError('invalid_resource_source','An artifact source must be a JSX file.');
  return {markup:parseDocument(bytes.toString()).body};
 }
 if(resource.type==='dataset'&&!['.csv','.json'].includes(extension)||resource.type==='file'&&['.csv','.json','.jsx','.yaml','.yml'].includes(extension))throw new CliError('invalid_resource_source',`The source format does not match type ${resource.type}.`);
 return assetInput(source,bytes);
}
