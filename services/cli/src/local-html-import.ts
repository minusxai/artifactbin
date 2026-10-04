/** An HTML file is untrusted data. Parse its JSON carrier, never run its embedded reader or author scripts. */
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {readFile,stat,realpath,lstat} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {isAbsolute,relative,resolve,join,sep} from 'node:path';
import {parseArtifactFile,sourceDigest,type ArtifactFile} from '../../app/lib/offline/file-format';
import {resolveStoredStoryDesign} from '../../app/lib/data/story/story-themes';
import {collectRefUses} from '../../app/lib/story/data/refs';
import {validateMarkupStructure} from '../../app/lib/story/document/local-validation';
import {parseJsx} from '../../app/lib/jsx';
import {nodeIndex} from '../../app/lib/story/document/node-ids';
import {parseAnnotationRange} from '../../app/lib/story/annotations/annotation-range';
import type {AnnotationWire} from '../../app/lib/annotations/store';
import {confinedPath,type FileChange} from './journal';
import {atomicWrite,digest,readOptional,privateDirectory,isMissing} from './files';
import {parseDocument,writeDocument} from './document';
import type {Workspace} from './workspace';
import {CliError} from './errors';
import {withLocalLock,localWorkspaceState,LOCAL_WORKSPACE_SCOPE,stageLocalFiles,recoverLocalFiles} from './local-workspace';

const MAX_BYTES=25*1024*1024;
const ID=/^[A-Za-z0-9]{6,12}$/;
const safePath=(path:string)=>!!path&&!isAbsolute(path)&&!/[\\:\x00-\x1f]/.test(path)&&path.split('/').every(part=>!!part&&!part.startsWith('.')&&part!=='node_modules');
const damaged=(message:string)=>new CliError('invalid_html',message);

export function readArtifactFileHtml(html:string):ArtifactFile{
 if(Buffer.byteLength(html)>MAX_BYTES)throw damaged('The HTML file exceeds the 25 MB import limit.');
 const payloads:string[]=[];
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('tagName' in node&&node.attrs.some(attr=>attr.name==='id'&&attr.value==='afbin-file')){
   if(node.tagName!=='script'||!node.attrs.some(attr=>attr.name==='type'&&attr.value==='application/json'))throw damaged('Invalid artifact file payload.');
   payloads.push(node.childNodes.map(child=>'value' in child?child.value:'').join(''));
  }
  if('childNodes' in node)for(const child of node.childNodes)visit(child);
 };
 visit(parse(html));
 if(payloads.length!==1)throw damaged('Expected exactly one artifact file payload.');
 let parsed:unknown;try{parsed=JSON.parse(payloads[0]!);}catch{throw damaged('The artifact file payload is not valid JSON.');}
 return parseArtifactFile(parsed);
}

async function noSymlink(root:string,path:string):Promise<void>{
 let current=root;for(const part of path.split('/')){current=join(current,part);try{if((await lstat(current)).isSymbolicLink())throw damaged('Imported paths may not follow symlinks.');}catch(error){if(isMissing(error))break;throw error;}}
}

function validThreads(file:ArtifactFile):void{
 const ids=new Set<string>();
 for(const thread of file.threads){
  if(!thread||typeof thread.id!=='string'||!thread.id||thread.id.length>200||ids.has(thread.id)||!['open','resolved'].includes(thread.status)||!Array.isArray(thread.thread)||!thread.thread.length||thread.thread.length>1000)throw damaged('Invalid or duplicate comment thread.');
  ids.add(thread.id);
  if(thread.range!=null&&!parseAnnotationRange(thread.range))throw damaged('Invalid comment selection.');
  if(thread.anchor!==null&&(!thread.anchor||typeof (thread.anchor.nodeId??thread.anchor.key)!=='string'||(thread.anchor.nodeId??thread.anchor.key).length>200))throw damaged('Invalid comment anchor.');
  for(const reply of thread.thread)if(!reply||typeof reply.id!=='string'||typeof reply.body!=='string'||reply.body.length>10000||!reply.author||reply.author.label!==null&&(typeof reply.author.label!=='string'||reply.author.label.length>100)||typeof reply.created_at!=='string')throw damaged('Invalid comment reply.');
 }
}

/** Remote downloads already carry approved rows and inlined bytes; recover them without contacting their origin. */
function downloadedAssets(file:ArtifactFile,identity:string):NonNullable<ArtifactFile['localWorkspace']>['assets']{
 const result:NonNullable<ArtifactFile['localWorkspace']>['assets']=Object.create(null) as NonNullable<ArtifactFile['localWorkspace']>['assets'];
 for(const imported of file.island.dataflow?.flow.imports??[]){
  const tables=file.snapshot.held?.[imported.name],table=tables?.rows;
  if(!table||Object.keys(tables!).some(name=>name!=='rows'))throw damaged(`Dataset ${imported.ref} has no complete local rows in this download.`);
  result[imported.ref]={path:`imported-${identity}/${imported.ref}.json`,contentType:'application/json',base64:Buffer.from(JSON.stringify(table.rows)).toString('base64')};
 }
 for(const ref of collectRefUses(file.source)??[]){
  if(result[ref.id]||!['image','file','pdf','asset'].includes(ref.kind))continue;
  const data=file.island.refData[ref.id],url=data&&'url' in data?data.url:null;
  const match=typeof url==='string'?/^data:([-\w.+]+\/[-\w.+]+)(;base64)?,([\s\S]*)$/.exec(url):null;
  if(!match)throw damaged(`Asset ${ref.id} has no embedded bytes in this download.`);
  let bytes:Buffer;try{bytes=match[2]?Buffer.from(match[3]!,'base64'):Buffer.from(decodeURIComponent(match[3]!));}catch{throw damaged('An embedded asset is damaged.');}
  const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','application/pdf':'pdf','text/csv':'csv','application/json':'json'};
  result[ref.id]={path:`imported-${identity}/${ref.id}.${extensions[match[1]!]??'bin'}`,contentType:match[1]!,base64:bytes.toString('base64')};
 }
 return result;
}

/** Applies source, assets, identities and comments in one replayable workspace journal. */
export async function importLocalHtml(workspace:Workspace,input:string,target?:string):Promise<{path:string;assets:string[];comments:number}>{
 workspace={...workspace,root:await realpath(workspace.root),cwd:await realpath(workspace.cwd)};
 const inputPath=await confinedPath(workspace.root,resolve(workspace.cwd,input));
 if((await stat(inputPath)).size>MAX_BYTES)throw damaged('The HTML file exceeds the 25 MB import limit.');
 const html=await readFile(inputPath,'utf8'),file=readArtifactFileHtml(html);
 const checked=validateMarkupStructure(file.source);
 if(!parseJsx(file.source).ok||checked.errors.length)throw damaged('The imported document is invalid: '+checked.errors.map(error=>error.message).join('; '));
 validThreads(file);
 const provenance=file.localWorkspace;
 if(provenance&&(!ID.test(provenance.documentId)||provenance.documentId!==file.artifactId||provenance.baseDigest!==sourceDigest(file.base.source)))throw damaged('The local document baseline or identity is inconsistent.');
 const inputName=relative(workspace.root,inputPath).split(sep).join('/').replace(/(\.jsx)?\.html?$/i,'.jsx');
 const path=relative(workspace.root,target?resolve(workspace.cwd,target):join(workspace.root,inputName)).split(sep).join('/');
 if(!safePath(path)||!path.endsWith('.jsx'))throw damaged('Import destination must be a JSX file inside the workspace.');
 await noSymlink(workspace.root,path);await confinedPath(workspace.root,path);
 if(workspace.tracking?.files[path])throw new CliError('tracked_import','Import into a local document, then publish explicitly; this destination is bound to a remote artifact.');
 return withLocalLock(workspace.root,async()=>{
  await recoverLocalFiles(workspace.root);
  const state=await localWorkspaceState(workspace.root),scope=LOCAL_WORKSPACE_SCOPE;
  const original=await readOptional(await confinedPath(workspace.root,path));
  const current=original?parseDocument(original.toString()):null;
  const identity=provenance?.documentId??(current?.metadata.id||randomBytes(3).toString('hex'));
  const registered=state.list<{id:string}>(scope,'draft-identity');
  if(registered.some(row=>row.value.id===identity&&row.key!==path))throw damaged('This document identity already belongs to another workspace file.');
  const preserveConflict=async(reason:string):Promise<never>=>{
   const directory=await confinedPath(workspace.root,'.artifactbin/conflicts');await privateDirectory(directory);
   const saved=join(directory,randomUUID()+'.html');await atomicWrite(saved,html,{exclusive:true});
   throw new CliError('import_conflict',reason,`Your local files were retained. The incoming copy is saved at ${saved}.`);
  };
  if(current&&(current.metadata.id!==undefined&&current.metadata.id!==identity||current.body!==file.base.source&&current.body!==file.source))return preserveConflict('Import conflict: the local document and offline copy both changed.');
  const changes:FileChange[]=[];
  const assets=Object.entries(provenance?.assets??downloadedAssets(file,identity));
  const destinations=new Set<string>([path]);let bytes=Buffer.byteLength(html);
  for(const [id,asset] of assets){
   if(!ID.test(id)||!asset||!safePath(asset.path)||/(^|\/)(package(?:-lock)?\.json|npm-shrinkwrap\.json)$/i.test(asset.path)||!/^[-\w.+]+\/[-\w.+]+$/.test(asset.contentType)||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.base64))throw damaged('Invalid imported asset metadata or path.');
   await noSymlink(workspace.root,asset.path);
   const destination=await confinedPath(workspace.root,asset.path);
   if(destinations.has(asset.path))throw damaged('Duplicate imported asset path.');destinations.add(asset.path);
   const content=Buffer.from(asset.base64,'base64');if(content.toString('base64')!==asset.base64)throw damaged('An imported asset has invalid base64 bytes.');bytes+=content.length;if(bytes>MAX_BYTES)throw damaged('The import exceeds its 25 MB size limit.');
   const old=await readOptional(destination);
   const known=state.get<{id:string}>(scope,'draft-identity',asset.path)?.value.id;
   if(workspace.tracking?.files[asset.path])throw damaged('Imported assets cannot overwrite remotely tracked files.');
   if(registered.some(row=>row.value.id===id&&row.key!==asset.path)||known&&known!==id)throw damaged('An imported asset identity conflicts with the workspace.');
   if(old&&!old.equals(content))return preserveConflict(`Import conflict: local asset ${asset.path} differs from the offline copy.`);
   if(old&&!known)throw damaged(`Imported asset ${asset.path} would overwrite an unregistered file.`);
   changes.push({path:asset.path,before:old?digest(old):null,data:content});
  }
  type Stored={file:string;node:string;value:AnnotationWire};
  const currentThreads=state.list<Stored>(scope,'preview-thread').map(row=>row.value).filter(row=>row.file===path);
  for(const thread of file.threads){const prior=state.get<Stored>(scope,'preview-thread',thread.id);if(prior&&prior.value.file!==path)throw damaged('An imported comment identity belongs to another document.');}
  const existing=currentThreads.map(row=>row.value),same=digest(JSON.stringify(existing))===digest(JSON.stringify(file.threads));
  const unchangedIncoming=provenance?.threadsDigest===digest(JSON.stringify(file.threads));
  const unchangedLocal=provenance?.threadsDigest===digest(JSON.stringify(existing));
  if(existing.length&&!same&&!unchangedIncoming&&!unchangedLocal)return preserveConflict('Import conflict: local comments and offline comments both changed.');
  const replaceThreads=!unchangedIncoming||existing.length===0;
  const anchors=nodeIndex(file.source);
  const fields=['title','description','theme','template','colorMode'] as const;
  const merged={...file.metadata};
  if(current){
   const baseline=provenance?.metadataBaseline,design=resolveStoredStoryDesign(current.metadata.theme,current.metadata.colorMode);
   const local={...current.metadata,theme:design.theme,colorMode:design.colorMode};
   for(const key of fields){
    const incoming=file.metadata[key],before=baseline?.[key],value=local[key]??(key==='title'?before??incoming:null);
    if(baseline&&value!==before&&incoming!==before&&value!==incoming||!baseline&&local[key]!==undefined&&value!==incoming)return preserveConflict(`Import conflict: document metadata ${key} changed in both copies.`);
    if(baseline&&incoming===before)(merged as Record<string,unknown>)[key]=value;
   }
  }
  const metadata={...(current?.metadata??{}),...Object.fromEntries(fields.map(key=>[key,merged[key]])),id:identity};
  changes.unshift({path,before:original?digest(original):null,data:Buffer.from(writeDocument({metadata,body:file.source}))});
  await stageLocalFiles(workspace.root,changes,store=>{
   store.put(scope,'draft-identity',path,{id:identity});
   if(!provenance)store.put(scope,'archive','import-baseline/'+path,{artifactId:file.artifactId,origin:file.origin,base:file.base,source:file.source});
   for(const [id,asset] of assets)store.put(scope,'draft-identity',asset.path,{id});
   if(replaceThreads){
    for(const thread of currentThreads)store.delete(scope,'preview-thread',thread.value.id);
    for(const thread of file.threads){const node=thread.anchor?.nodeId??thread.anchor?.key??'';store.put(scope,'preview-thread',thread.id,{file:path,node,value:{...thread,orphaned:!anchors.has(node)}} satisfies Stored);}
   }
  });
  await recoverLocalFiles(workspace.root);
  return {path,assets:assets.map(([,asset])=>asset.path),comments:replaceThreads?file.threads.length:existing.length};
 });
}
