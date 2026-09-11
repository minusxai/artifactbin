import {basename,dirname,extname,join,relative} from 'node:path';
import type {ArtifactResourceFile} from '@artifactbin/contracts';
import type {Snapshot,TrackedFile} from './workspace';
import type {HttpClient} from './http';
import {confinedPath,type FileChange} from './journal';
import {digest,readOptional} from './files';
import {CliError} from './errors';
import {rowsCsv} from './tabular';
import {parseResourceFile,reconcileResource,snapshotResource,writeResourceFile,type ResourceSource} from './resource-file';

/** Prepare YAML and native source bytes together; the caller journals the complete local commit. */
export async function prepareResourcePull(root:string,path:string,snapshot:Snapshot,previous:TrackedFile|undefined,before:Buffer|null,client:HttpClient,force=false){
 const type=snapshot.format==='markup'?'artifact':snapshot.format==='folder'?'folder':snapshot.format==='dataset'?'dataset':'file';
 const changes:FileChange[]=[];
 const backups:Array<{path:string;bytes:Buffer}>=[];
 let source:ResourceSource|undefined;
 let prototype={type} as ArtifactResourceFile;
 if(type!=='folder'){
  const extension=type==='dataset'?'.json':type==='artifact'?'.jsx':snapshot.format==='pdf'?'.pdf':typeof snapshot.filename==='string'?extname(snapshot.filename):'.bin';
  const sourcePath=previous?.source?.path??join(dirname(path),basename(path,extname(path))+extension);
  const absolute=await confinedPath(root,sourcePath);
  const local=await readOptional(absolute);
  const same=previous?.snapshot.version===snapshot.version&&previous.source?.path===sourcePath;
  let bytes=same?Buffer.from(previous!.source!.bytes,'base64'):type==='artifact'?Buffer.from(snapshot.markup??''):(await client.content(`/artifacts/${snapshot.id}/content?version=${snapshot.version}`)).bytes;
  if(type==='dataset'&&!same){
   let rows:unknown;try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_response','Dataset content must be JSON rows.');}
   if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new CliError('invalid_response','Dataset content must contain row objects.');
   bytes=Buffer.from(extname(sourcePath).toLowerCase()==='.csv'?rowsCsv(rows):JSON.stringify(rows,null,2)+'\n');
  }
  source={path:sourcePath,bytes:bytes.toString('base64')};
  prototype={type,source:'./'+relative(dirname(path),sourcePath)} as ArtifactResourceFile;
  const changed=local&&(!previous?.source||!local.equals(Buffer.from(previous.source.bytes,'base64')));
  if(changed&&!same&&!force){
   throw new CliError('merge_conflict',`${sourcePath} has overlapping local and remote content.`,undefined,{fields:['source'],path,local:local.toString('base64'),remote:bytes.toString('base64'),encoding:'base64',head:snapshot},3);
  }
  if(changed&&force&&!local.equals(bytes))backups.push({path:sourcePath,bytes:local});
  if(!local||(!changed||force)&&!local.equals(bytes))changes.push({path:sourcePath,before:local?digest(local):null,data:bytes});
 }
 const canonical=snapshotResource(snapshot,prototype);
 const baseline=Buffer.from(writeResourceFile(canonical));let bytes=baseline;
 if(before&&previous&&!force&&!before.equals(Buffer.from(previous.baseline,'base64'))){
  const merged=reconcileResource(parseResourceFile(Buffer.from(previous.baseline,'base64').toString()),parseResourceFile(before.toString()),canonical);
  if(!merged.ok)throw new CliError('merge_conflict',`${path} has overlapping resource settings.`,undefined,{fields:merged.fields,path,base:Buffer.from(previous.baseline,'base64').toString(),local:before.toString(),remote:baseline.toString(),head:snapshot},3);
  bytes=Buffer.from(writeResourceFile(merged.resource));
 }
 return {bytes,baseline,source,changes,backups};
}
