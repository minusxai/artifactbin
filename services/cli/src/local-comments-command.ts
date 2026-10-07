/** CLI discussion over the same portable annotation store as the local browser editor. */
import {resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {collectionFilters} from './collection-filters';
import {CliError,type ParsedCommand} from './commands';
import {localIdentities} from './identities';
import {resolveReference} from './reference';
import {confinedPath} from './journal';
import {parseDocument,writeDocument} from './document';
import {previewAnnotations} from './preview/annotations';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE,registerLocalFiles,withLocalLock,recoverLocalFiles,migrateLocalDiscussion,saveLocalFile} from './local-workspace';
import type {Workspace} from './workspace';
import {digest} from './files';
import {nodeIndex,stampNodeIds} from '../../app/lib/story/document/node-ids';
import {canonicalQuote,canonicalText} from '../../app/lib/story/annotations/annotation-range';
import type {JsxNode} from '../../app/lib/jsx';
import {BackendRequestError} from '../../app/lib/artifact-backend/errors';

/** Resolve every target before writing so a mixed remote/local request cannot partly mutate locally. */
export async function localCommentCommand(workspace:Workspace,parsed:ParsedCommand,providedBody?:string,options:{hostedIds?:boolean}={}):Promise<unknown|undefined>{
 if(parsed.command!=='comment'||parsed.positionals.some(value=>/^https?:\/\//i.test(value)))return undefined;
 const references=await Promise.all(parsed.positionals.map(ref=>resolveReference(ref,{root:workspace.root,cwd:workspace.cwd,writable:true})));
 // A managed reviewer addresses hosted threads by their event's artifact ID,
 // even after pull registered that ID locally. Explicit files remain offline.
 if(options.hostedIds&&references.some(ref=>ref.kind==='id')){
  if(references.some(ref=>ref.kind==='path'))throw new CliError('unsupported_local_comment','Managed comments cannot mix hosted artifact IDs with local paths.','Use separate commands for hosted threads and local discussions.');
  return undefined;
 }
 const identities=await localIdentities(workspace),targets:Array<{path:string;ref:string}>=[];
 for(const [index,ref] of parsed.positionals.entries()){
  const resolved=references[index]!;
  const path=resolved.kind==='path'?resolved.path:identities[resolved.id];
  if(!path)return undefined;
  if(!path.toLowerCase().endsWith('.jsx'))throw new CliError('not_markup','Local comments require a JSX document.');
  targets.push({path:path.split(sep).join('/'),ref});
 }
 const flags=parsed.flags,body=providedBody??(typeof flags.body==='string'?flags.body:undefined);
 if(flags.image||flags.request||flags.phase)throw new CliError('unsupported_local_comment','Local comments do not support hosted comment images or remote-agent request phases.');
 if(flags.input&&providedBody===undefined)throw new CliError('invalid_comment','Read --input before invoking the local comment operation.');
 if(body!==undefined&&(!body.trim()||body.length>10000))throw new CliError('invalid_comment','A comment needs 1–10000 characters.');
 const filters=collectionFilters('comment',flags.filter as string[]|undefined);
 const mutations=body!==undefined||flags.state!==undefined;
 return withLocalLock(workspace.root,async()=>{
  await recoverLocalFiles(workspace.root);const store=await localWorkspaceState(workspace.root);
  await migrateLocalDiscussion(workspace.root,workspace.home,store);
  const results=[];
  for(const target of targets){
   const original=await readFile(await confinedPath(workspace.root,target.path),'utf8'),document=parseDocument(original);
   const source=mutations&&!flags.thread&&flags.quote?stampNodeIds(document.body).source:document.body;
   const annotations=previewAnnotations(store,LOCAL_WORKSPACE_SCOPE,target.path,source);
   const id=(await localIdentities(workspace));const documentId=Object.entries(id).find(([,path])=>path===target.path)?.[0];
   const context={local:true,path:target.path,...(documentId?{artifact_id:documentId}:{})};
   try{
    if(mutations){
     let node=typeof flags.node==='string'?flags.node:undefined;
     const quote=typeof flags.quote==='string'?canonicalQuote(flags.quote):undefined;
     if(!flags.thread){
      if(quote){
       const text=(node:JsxNode):string=>node.type==='text'?node.value:node.type==='element'?node.children.map(text).join(''):'';
       const matches=[...nodeIndex(source)].filter(([,entry])=>canonicalText(text(entry.node)).includes(quote));
       const leaves=matches.filter(([,entry])=>!matches.some(([,other])=>other!==entry&&other.path.startsWith(entry.path+'.')));
       if(!leaves.length)throw new CliError('quote_not_found','The quote was not found in the local document.');
       if(leaves.length!==1||canonicalText(text(leaves[0]![1].node)).split(quote).length!==2)throw new CliError('ambiguous_quote','The quote is ambiguous in the local document. Use --node instead.');
       node=leaves[0]![0];
      }
      if(!node||!nodeIndex(source).has(node))throw new CliError('invalid_node','That node is not in the local document. Use an authored node ID.');
     }else if(![...annotations.list('open'),...annotations.list('resolved')].some(item=>item.id===flags.thread))throw new CliError('invalid_thread','That thread is not on the local document.');
     if(flags['dry-run']){results.push({...context,dry_run:true,action:flags.thread?(body!==undefined?'reply':'state'):'thread',...(node?{node}:{}),...(quote?{quote}:{}),...(flags.thread?{thread:flags.thread}:{}),...(flags.state?{state:flags.state}:{})});continue;}
     if(source!==document.body)await saveLocalFile(workspace.root,target.path,digest(original),Buffer.from(writeDocument({...document,body:source})));
     await registerLocalFiles(workspace,[resolve(workspace.root,target.path)],{intent:'automatic'});
     const assigned=Object.entries(await localIdentities(workspace)).find(([,path])=>path===target.path)?.[0];
     if(assigned)Object.assign(context,{artifact_id:assigned});
     if(parseDocument(await readFile(await confinedPath(workspace.root,target.path),'utf8')).body!==source)throw new CliError('local_changed','The document changed while preparing the comment. Read it again and retry.');
     const value=store.transaction(()=>flags.thread?annotations.act(String(flags.thread),{...(body!==undefined?{reply:body}:{}),...(flags.state==='resolved'?{resolve:true}:flags.state==='open'?{reopen:true}:{})}):annotations.create({body,node_id:node,...(quote?{quote}:{})},randomUUID()));
     results.push({...value,...context});continue;
    }
    let rows=filters.state==='all'?[...annotations.list('open'),...annotations.list('resolved')]:annotations.list(filters.state);
    if(filters.author)rows=rows.filter(row=>row.thread.some(comment=>comment.author.label===filters.author||comment.author.user_id===filters.author));
    rows.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
    let offset=0;
    if(flags.cursor){try{const decoded=JSON.parse(Buffer.from(String(flags.cursor),'base64url').toString());if(decoded.file!==target.path||!Number.isSafeInteger(decoded.offset)||decoded.offset<0)throw Error();offset=decoded.offset;}catch{throw new CliError('invalid_cursor','Use the cursor returned by local comment listing for this document.');}}
    const limit=typeof flags.limit==='string'?Number(flags.limit):100;
    if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new CliError('invalid_limit','Use a comment limit from 1 to 1000.');
    results.push({...context,annotations:rows.slice(offset,offset+limit),next_cursor:offset+limit<rows.length?Buffer.from(JSON.stringify({file:target.path,offset:offset+limit})).toString('base64url'):null});
   }catch(error){if(error instanceof BackendRequestError)throw new CliError(error.status===404?'invalid_thread':'invalid_comment',error.message);throw error;}
  }
  return results.length===1?results[0]:{local:true,results};
 });
}
