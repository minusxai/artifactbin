import {readFile} from 'node:fs/promises';
import {runTool,resolveTarget,selectedServer,makeClient,positional,requireFlags,integer,enumValue,jsonFile,journalIntent,createJournal,resumeJournal,ToolError,serverOrigin} from './toolbox-client.mjs';
import {watchComments} from './toolbox-comments.mjs';
export async function commentCommand({sub,values,positionals},options={}){
 if(values.resume){positional(positionals,0);if(Object.keys(values).some(key=>!['resume','server','json','output'].includes(key)))throw new ToolError('resume_overrides','Resume accepts no changed comment fields.',2);const saved=await jsonFile(values.resume),client=makeClient(serverOrigin(selectedServer(values,options.env)??saved.server),options);const result=await resumeJournal(values.resume,client,'comment');return {thread:result.receipt,journal:result.journal};}
 const {server,id}=resolveTarget(positional(positionals),selectedServer(values,options.env)),client=makeClient(server,options);
 if(sub==='list'){
  const query=new URLSearchParams({status:values.status?enumValue(values.status,['open','resolved','all'],'status'):'open'});if(values.cursor)query.set('cursor',values.cursor);if(values.limit)query.set('limit',String(integer(values.limit,'limit',1,100)));
  return await client.request(`/api/artifacts/${id}/annotations?${query}`);
 }
 if(sub==='watch'){const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());await watchComments(client,id,values,{signal:controller.signal,...options});return;}
 let body={},route=`/api/artifacts/${id}/annotations`,method='POST';
 if(['add','reply','edit'].includes(sub)){requireFlags(values,['body-file']);body.body=await readFile(values['body-file'],'utf8');if(!body.body.trim())throw new ToolError('empty_body','Comment text must be nonblank.',2);}
 if(sub==='add'){
  requireFlags(values,['anchor']);body.anchor=await jsonFile(values.anchor);
  const anchor=body.anchor;if(anchor?.kind!=='html-node'||anchor.v!==1||typeof anchor.revision!=='string'||typeof anchor.nodeId!=='string'||typeof anchor.quote!=='string')throw new ToolError('invalid_anchor','Provide a native html-node anchor with canonical revision/nodeId/quote.',2);
 }else if(sub==='react'){
  requireFlags(values,['comment','active']);if(!/^[A-Za-z0-9_-]+$/.test(values.comment))throw new ToolError('invalid_comment_id','Invalid comment ID.',2);
  method='PUT';route+='/'+values.comment+'/reactions';body={kind:enumValue(values.kind??'thumbs_up',['thumbs_up'],'kind'),active:enumValue(values.active,['true','false'],'active')==='true'};
 }else{
  requireFlags(values,[sub==='edit'?'comment':'thread',...(sub==='reply'&&!values.resolve?[]:['expected-revision'])]);const thread=values[sub==='edit'?'comment':'thread'];if(!/^[A-Za-z0-9_-]+$/.test(thread))throw new ToolError('invalid_comment_id','Invalid comment/thread ID.',2);route+='/'+thread;if(values['expected-revision']!==undefined)body.expected_revision=integer(values['expected-revision'],'expected_revision',0);
  if(sub==='edit')method='PATCH';else if(sub==='reply'){body.reply=body.body;delete body.body;if(values.resolve)body.resolve=true;}else body[sub==='resolve'?'resolve':'reopen']=true;
 }
 const journal=await createJournal(journalIntent({server,method,path:route,body,operation:'comment'}),{file:values.request,root:client.root});
 const result=await resumeJournal(journal,client,'comment');return {thread:result.receipt,journal};
}
await runTool('comment',import.meta.url,commentCommand);
