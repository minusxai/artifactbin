import {basename,dirname,extname,join,relative} from 'node:path';
import type {ArtifactResourceFile} from '@artifactbin/contracts';
import {baselineOf,type Snapshot,type TrackedFile,type Workspace} from './workspace';
import type {HttpClient} from './http';
import {confinedPath,type FileChange} from './journal';
import {digest,readOptional} from './files';
import {CliError} from './errors';
import {datasetRows,endLine} from './dataset-source';
import {rowsCsv} from './tabular';
import {parseResourceFile,reconcileResource,snapshotResource,writeResourceFile,type ResourceSource} from './resource-file';

/** Prepare YAML and native source bytes together; the caller journals the complete local commit. */
export async function prepareResourcePull(workspace:Workspace,path:string,snapshot:Snapshot,previous:TrackedFile|undefined,before:Buffer|null,client:HttpClient,force=false){
 const root=workspace.root;
 const type=snapshot.format==='markup'?'artifact':snapshot.format==='folder'?'folder':snapshot.format==='dataset'?'dataset':'file';
 const changes:FileChange[]=[];
 const backups:Array<{path:string;bytes:Buffer}>=[];
 let source:ResourceSource|undefined;
 let prototype={type} as ArtifactResourceFile;
 if(type!=='folder'){
  const previousPath=previous?.source?.path;
  const same=!!previous?.source&&(previous.source.version??previous.snapshot.version)===snapshot.version;
  const fetched=same||type==='artifact'?undefined:await client.content(`/artifacts/${snapshot.id}/content?version=${snapshot.version}`);
  // A dataset's source is its rows when the server serves rows, and its <Dataset> definition otherwise.
  // The served representation is the only discriminator every actor can see; a reader's catalog is stripped.
  const definition=type==='dataset'&&(fetched?!fetched.contentType.startsWith('application/json'):extname(previousPath??'').toLowerCase()==='.jsx');
  const extension=type==='dataset'?definition?'.jsx':'.json':type==='artifact'?'.jsx':snapshot.format==='pdf'?'.pdf':typeof snapshot.filename==='string'?extname(snapshot.filename):'.bin';
  const sourcePath=previousPath??join(dirname(path),basename(path,extname(path))+extension);
  const absolute=await confinedPath(root,sourcePath);
  const local=await readOptional(absolute);
  let bytes=same?Buffer.from(previous!.source!.bytes,'base64'):type==='artifact'?Buffer.from(snapshot.markup??''):fetched!.bytes;
  if(type==='dataset'&&!same)bytes=definition?Buffer.from(endLine(bytes.toString())):Buffer.from(extname(sourcePath).toLowerCase()==='.csv'?rowsCsv(datasetRows(bytes)):JSON.stringify(datasetRows(bytes),null,2)+'\n');
  const declared=relative(dirname(path),sourcePath);
  source={path:sourcePath,declared,bytes:bytes.toString('base64'),version:snapshot.version};
  prototype={type,source:declared} as ArtifactResourceFile;
  const changed=local&&(!previous?.source||!local.equals(Buffer.from(previous.source.bytes,'base64')));
  if(changed&&!same&&!force){
   throw new CliError('merge_conflict',`${sourcePath} has overlapping local and remote content.`,undefined,{fields:['source'],path,local:local.toString('base64'),remote:bytes.toString('base64'),encoding:'base64',head:snapshot},3);
  }
  if(changed&&force&&!local.equals(bytes))backups.push({path:sourcePath,bytes:local});
  if(!local||(!changed||force)&&!local.equals(bytes))changes.push({path:sourcePath,before:local?digest(local):null,data:bytes});
 }
 const canonical=snapshotResource(snapshot,prototype);
 const canonicalBytes=Buffer.from(writeResourceFile(canonical));let bytes=canonicalBytes;
 const accepted=previous?await baselineOf(workspace,path,previous):null;
 if(before&&previous&&accepted&&!force&&digest(before)!==previous.file){
  const merged=reconcileResource(parseResourceFile(accepted.toString()),parseResourceFile(before.toString()),canonical);
  if(!merged.ok)throw new CliError('merge_conflict',`${path} has overlapping resource settings.`,undefined,{fields:merged.fields,path,base:accepted.toString(),local:before.toString(),remote:canonicalBytes.toString(),head:snapshot},3);
  bytes=Buffer.from(writeResourceFile(merged.resource));
 }
 return {bytes,accepted:canonicalBytes,source,changes,backups};
}
