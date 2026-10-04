/** Local discussions publish through the existing durable mutation journal. */
import {readFile} from 'node:fs/promises';
import type {AnnotationWire,AnnotationCommentWire} from '../../app/lib/annotations/store';
import {nodeIndex} from '../../app/lib/story/document/node-ids';
import {CliError} from './errors';
import {digest} from './files';
import {confinedPath} from './journal';
import {parseDocument} from './document';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from './local-workspace';
import {previewAnnotations} from './preview/annotations';
import {stateFor} from './state-access';
import {recoverableOperation,pendingOperation} from './recoverable-operation';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';
interface StoredThread {file:string;node:string;value:AnnotationWire}
interface Binding {file:string;artifactId:string;threadId:string;status:'open'|'resolved';revision:number;comments:Record<string,{id:string;hash:string;body:string}>}
interface Context {thread:string;comment?:string;hash?:string;body?:string;file:string;artifactId:string;binding?:Binding;before:string[];status?:'open'|'resolved'}
const key=(thread:string)=>'local-comments/'+thread;
const hash=(comment:AnnotationCommentWire)=>digest(JSON.stringify([comment.body,comment.author.label]));
const bodyFor=(comment:AnnotationCommentWire)=>comment.author.label&&comment.author.label!=='You'?`Offline note by ${comment.author.label} (unverified):\n\n${comment.body}`:comment.body;
export async function publishLocalComments(workspace:Workspace,stage:Workspace,paths:string[],client:HttpClient,options:{force?:boolean}={}):Promise<Array<Record<string,unknown>>>{
 if(stage.tracking&&client.account&&stage.tracking.account!==client.account)throw new CliError('account_mismatch','Local comment publication belongs to another account.');
 const portable=await localWorkspaceState(workspace.root),store=await stateFor(stage.home),selected=new Set(paths),operations:Array<Record<string,unknown>>=[];
 try{
 const finish=async(response:Record<string,unknown>,value:unknown)=>{
  const context=value as Context,wire=response as unknown as AnnotationWire;
  if(typeof wire.id!=='string'||!Array.isArray(wire.thread)||!Number.isSafeInteger(wire.revision)||!['open','resolved'].includes(wire.status))throw new CliError('invalid_response','The comment receipt is incomplete; recovery was retained.');
  const binding:Binding=context.binding?{...context.binding,comments:{...context.binding.comments}}:{file:context.file,artifactId:context.artifactId,threadId:wire.id,status:wire.status,revision:wire.revision!,comments:{}};
  if(binding.threadId!==wire.id)throw new CliError('invalid_response','The comment receipt changed the thread identity; recovery was retained.');
  if(context.comment){
   const candidates=wire.thread.filter(comment=>!context.before.includes(comment.id)&&comment.body===context.body);
   if(candidates.length!==1)throw new CliError('comment_receipt_ambiguous','The confirmed reply could not be uniquely identified; recovery was retained.');
   binding.comments[context.comment]={id:candidates[0]!.id,hash:context.hash!,body:context.body!};
  }
  binding.status=wire.status;binding.revision=wire.revision!;binding.file=context.file;
  store.put(stage.root,'archive',key(context.thread),binding);
 };
 const mutate=async(identity:Record<string,unknown>,path:string,body:Record<string,unknown>,prepare:()=>Promise<{body:unknown;context:Context}>)=>{
  const result=await recoverableOperation(stage,client,{identity,path,method:'POST',body,prepare,finalize:finish});
  operations.push({path:identity.file,status:'comment_published',thread:result.id,comment:identity.comment??null});
 };
 const pending=await pendingOperation(stage);
 if(pending){
  if((pending.identity as {type?:string})?.type!=='local-comment-publication')throw new CliError('pending_recovery','A different mutation is pending in this publication copy.');
  await mutate(pending.identity as Record<string,unknown>,pending.path,pending.body as Record<string,unknown>,async()=>({body:pending.body,context:pending.context as Context}));
 }
 // Migrate legacy notes with the same production wire used by preview.
 for(const file of selected)if(stage.tracking?.files[file]?.snapshot.markup!==undefined){const source=parseDocument((await readFile(await confinedPath(workspace.root,file))).toString()).body;previewAnnotations(portable,LOCAL_WORKSPACE_SCOPE,file,source);}
 const threads=portable.list<StoredThread>(LOCAL_WORKSPACE_SCOPE,'preview-thread').map(row=>row.value).filter(thread=>selected.has(thread.file));
 const localThreads=new Map(threads.map(thread=>[thread.value.id,thread]));
 for(const record of store.list<Binding>(stage.root,'archive'))if(record.key.startsWith('local-comments/')&&selected.has(record.value.file)){
  const thread=localThreads.get(record.key.slice('local-comments/'.length));
  if(!thread)throw new CliError('comment_conflict','A published local thread was deleted.','Remote comments were preserved; delete the remote thread explicitly if intended.');
  for(const [id,comment] of Object.entries(record.value.comments)){
   const local=thread.value.thread.find(entry=>entry.id===id);
   if(!local||hash(local)!==comment.hash)throw new CliError('comment_conflict','A published local comment was edited or deleted.','The API supports replies and state changes; preserve the original and add a new reply instead.');
  }
 }
 for(const thread of threads){
  const artifact=stage.tracking?.files[thread.file];if(!artifact||artifact.snapshot.markup===undefined)continue;
  let binding=store.get<Binding>(stage.root,'archive',key(thread.value.id))?.value;
  if(binding&&binding.artifactId!==artifact.id)throw new CliError('comment_conflict','The published thread belongs to another document identity.');
  for(const comment of thread.value.thread){
   if(binding?.comments[comment.id])continue;
   const body=bodyFor(comment),identity={type:'local-comment-publication',file:thread.file,thread:thread.value.id,comment:comment.id},path=`/artifacts/${artifact.id}/annotations${binding?'/'+binding.threadId:''}`;
   const initialBinding=binding;
   await mutate(identity,path,initialBinding?{reply:body}:{body,node_id:thread.node,...(thread.value.quote?{quote:thread.value.quote}:{}),...(thread.value.range?{range:thread.value.range}:{})},async()=>{
    const head=await client.request<{capabilities?:{comment?:boolean;comment_receipts?:boolean}}>(`/artifacts/${artifact.id}`);
    if(!head.capabilities?.comment_receipts)throw new CliError('unsupported_server','The server does not support recoverable comments.');
    if(head.capabilities.comment===false)throw new CliError('comment_required','Sign in with an account allowed to publish these local comments.');
    let before:string[]=[],input:Record<string,unknown>;
    if(initialBinding){const remote=await readThread(client,artifact.id,initialBinding.threadId);verifyRemote(initialBinding,remote,!!options.force);before=remote.thread.map(entry=>entry.id);input={reply:body,expected_revision:remote.revision};}
    else{if(!nodeIndex(artifact.snapshot.markup!).has(thread.node))throw new CliError('comment_anchor_missing','The offline comment target is no longer in the published document.','The note remains local; restore its target or re-anchor it before publishing.');input={body,node_id:thread.node,...(thread.value.quote?{quote:thread.value.quote}:{}),...(thread.value.range?{range:thread.value.range}:{})};}
    return{body:input,context:{file:thread.file,artifactId:artifact.id,thread:thread.value.id,comment:comment.id,hash:hash(comment),body,binding:initialBinding,before}};
   });
   binding=store.get<Binding>(stage.root,'archive',key(thread.value.id))!.value;
  }
  if(binding&&binding.status!==thread.value.status){
   const initialBinding=binding;
   await mutate({type:'local-comment-publication',file:thread.file,thread:thread.value.id,action:thread.value.status},`/artifacts/${artifact.id}/annotations/${binding.threadId}`,thread.value.status==='resolved'?{resolve:true}:{reopen:true},async()=>{
    const remote=await readThread(client,artifact.id,initialBinding.threadId);verifyRemote(initialBinding,remote,!!options.force);
    return{body:{...(thread.value.status==='resolved'?{resolve:true}:{reopen:true}),expected_revision:remote.revision},context:{file:thread.file,artifactId:artifact.id,thread:thread.value.id,binding:initialBinding,before:remote.thread.map(entry=>entry.id),status:thread.value.status}};
   });
  }
 }
 return operations;
 }catch(error){if(error instanceof CliError)throw new CliError(error.code,error.message,error.fix,{...(error.details&&typeof error.details==='object'?error.details:{}),completed_operations:operations,local_comments_preserved:true},error.exitCode);throw error;}
}
async function readThread(client:HttpClient,artifact:string,id:string):Promise<AnnotationWire>{
 let cursor:string|undefined;const seen=new Set<string>();
 do{
  const page=await client.request<{annotations:AnnotationWire[];next_cursor:string|null}>(`/artifacts/${artifact}/annotations?status=all&limit=200${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
  const thread=page.annotations.find(value=>value.id===id);if(thread)return thread;
  cursor=page.next_cursor??undefined;if(cursor&&seen.has(cursor))throw new CliError('invalid_response','The comment listing repeated its cursor.');if(cursor)seen.add(cursor);
 }while(cursor);
 throw new CliError('comment_conflict','The published thread was removed remotely.','Local discussion was preserved; recreate it explicitly after reviewing the remote deletion.');
}
function verifyRemote(binding:Binding,remote:AnnotationWire,force:boolean):void{
 if(!Number.isSafeInteger(remote.revision))throw new CliError('unsupported_server','The server does not expose annotation revisions.');
 for(const published of Object.values(binding.comments))if(!remote.thread.some(comment=>comment.id===published.id&&comment.body===published.body))throw new CliError('comment_conflict','A published comment changed or disappeared remotely.','Local comments were preserved; compare both conversations before resolving.');
 if(remote.revision!==binding.revision&&!force)throw new CliError('comment_conflict','The remote conversation changed since publication.','Review the remote thread, then push --force to append your replies while preserving remote messages.');
}
