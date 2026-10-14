/**
 * THE LOCAL COMMENT FEED — the hosted changes contract (`/api/artifacts/{id}/annotations/changes`) over one workspace
 * file's own discussion: the preview's browser comments and `afbin comment` on the file, offline and without a sign-in.
 *
 * Same events (`commentChangeEvent`, shared with the server), same opaque checkpoints, same replay: comments carry feed
 * positions from one workspace counter (preview/annotations.ts), and a read derives events from them exactly as the
 * server derives its own from `seq` and `change_seq`. Human comments are the person at this workspace (`you: true`);
 * `--agent` comments and agent edits are never events, as hosted. Waiting polls the workspace store.
 */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {commentChangeEvent,watchComments} from '@artifactbin/utils/comment-watch';
import {COMMENT_CHANGES_MAX_WAIT_SECONDS,type CommentChangesPage,type CommentChangeEvent} from '@artifactbin/contracts';
import {CliError,type ParsedCommand} from './commands';
import {localIdentities} from './identities';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE,registerLocalFiles} from './local-workspace';
import type {Stored} from './preview/annotations';
import type {Workspace} from './workspace';

const POLL_MS=250;
interface Cursor {v:1;scope:string;seq:string}
const invalidCursor=()=>new CliError('invalid_cursor','Use a checkpoint this watch printed for this file.','Start again without --cursor to follow comments from now.');

/** One file's feed: `read` answers like the changes route with wait=0; `wait` long-polls the workspace store. */
export async function localCommentFeed(workspace:Workspace,file:string){
 await registerLocalFiles(workspace,[resolve(workspace.root,file)],{intent:'automatic'});
 const artifactId=Object.entries(await localIdentities(workspace)).find(([,path])=>path===file)?.[0];
 if(!artifactId)throw new CliError('unregistered_file',`${file} has no local identity.`,'Run afbin add <file>, then watch it.');
 const state=await localWorkspaceState(workspace.root);
 const scope=createHash('sha256').update(JSON.stringify([workspace.root,file])).digest('hex');
 const encode=(seq:bigint)=>Buffer.from(JSON.stringify({v:1,scope,seq:String(seq)} satisfies Cursor)).toString('base64url');
 const decode=(raw:string):bigint=>{
  try{
   if(raw.length>1024||!/^[A-Za-z0-9_-]+$/.test(raw))throw invalidCursor();
   const cursor=JSON.parse(Buffer.from(raw,'base64url').toString()) as Cursor;
   if(cursor.v!==1||cursor.scope!==scope||typeof cursor.seq!=='string'||!/^(0|[1-9]\d{0,18})$/.test(cursor.seq))throw invalidCursor();
   return BigInt(cursor.seq);
  }catch{throw invalidCursor();}
 };
 /** Every comment of this file with its positions; a deleted thread or reply is simply absent. */
 const rows=()=>state.list<Stored>(LOCAL_WORKSPACE_SCOPE,'preview-thread').map(row=>row.value).filter(entry=>entry.file===file).flatMap(entry=>entry.value.thread.map(comment=>{
  const at=entry.positions?.[comment.id],seq=BigInt(at?.seq??0),change=BigInt(at?.change??0);
  return {id:comment.id,rootId:comment.id===entry.value.id?null:entry.value.id,authorKind:comment.author.kind,label:comment.author.label,userId:comment.author.user_id,
   body:comment.body,createdAt:comment.created_at,editedAt:comment.edited_at??null,seq,key:seq>change?seq:change,you:comment.author.kind==='human'};
 }));
 const read=(after:string,limit:number):CommentChangesPage=>{
  const all=rows();
  if(after==='now')return {events:[],next_cursor:encode(all.reduce((max,row)=>row.key>max?row.key:max,0n)),has_more:false};
  const from=decode(after);
  const scanned=all.filter(row=>row.key>from).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const page=scanned.slice(0,limit);
  const events=page.flatMap(row=>commentChangeEvent(row,artifactId,from)??[]) as CommentChangeEvent[];
  return {events,next_cursor:encode(page.length?page[page.length-1]!.key:from),has_more:scanned.length>limit};
 };
 const wait=async(after:string,limit:number,waitSeconds:number,signal?:AbortSignal):Promise<CommentChangesPage>=>{
  const deadline=Date.now()+Math.min(waitSeconds,COMMENT_CHANGES_MAX_WAIT_SECONDS)*1000;
  for(;;){
   const page=read(after,limit);
   if(after==='now'||page.events.length||page.has_more||Date.now()>=deadline)return page;
   await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);done();},POLL_MS);const stop=()=>{clearTimeout(timer);fail(signal?.reason);};signal?.addEventListener('abort',stop,{once:true});});
  }
 };
 return {artifactId,read,wait};
}

/** `afbin watch <file> --comments --json`: the shared watch loop over the local feed — stdout events, stderr checkpoints, no network. */
export async function localWatchCommand(workspace:Workspace,parsed:ParsedCommand,file:string,options:{stdout:(value:string)=>void;stderr:(value:string)=>void;signal?:AbortSignal}):Promise<void>{
 if(!parsed.flags.comments||!parsed.flags.json)throw new CliError('invalid_arguments','Use afbin watch <file> --comments --json.');
 if(!file.toLowerCase().endsWith('.jsx'))throw new CliError('not_markup','Local comments live on JSX documents.');
 const feed=await localCommentFeed(workspace,file);
 const controller=new AbortController(),stop=()=>controller.abort();
 const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  for await(const event of watchComments({artifactId:feed.artifactId,signal,cursor:typeof parsed.flags.cursor==='string'?parsed.flags.cursor:undefined,
   // The same request the hosted watch makes, answered from the workspace store.
   request:async(path,requestOptions)=>{const query=new URL(path,'local:/').searchParams;return feed.wait(query.get('after')??'now',Number(query.get('limit')??100),Number(query.get('wait')??0),requestOptions.signal);},
   onCheckpoint:cursor=>{options.stderr(JSON.stringify({checkpoint:cursor})+'\n');},
  })){if(signal.aborted)return;options.stdout(JSON.stringify(event)+'\n');}
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
