import {createServer} from 'node:http';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {actorReceiver,overHttp} from '@artifactbin/utils';
import {fileURLToPath} from 'node:url';
import {bundleProgram,DesignRunner} from './runner.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});
const assistant=()=>({role:'assistant',content:[],api:'openai-completions',provider:'openai',model:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});

/** Deterministic model over actual HTTP/SSE; no paid provider or live account. */
export async function fixtureModel(mode='normal'){
 const requests=[];
 const server=createServer(async(req,res)=>{
 let raw='';for await(const bytes of req)raw+=bytes;const body=JSON.parse(raw);requests.push({body,authorized:req.headers.authorization==='Bearer fixture-key'});
 if(req.headers.authorization!=='Bearer fixture-key'){res.writeHead(401);res.end();return;}
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(mode==='hang')return;
 const latestUser=body.messages.findLastIndex(m=>m.role==='user');const count=body.messages.slice(latestUser+1).filter(m=>m.role==='tool').length;
 const name=count===0?'read_artifact':'reply_comment';
 const chunks=count<2?[{choices:[{delta:{tool_calls:[{index:0,id:`call-${count}`,function:{name,arguments:''}}]}}]},... (count===0?['{','}']:['{"body":"validated reply ','café"}']).map(part=>({choices:[{delta:{tool_calls:[{index:0,function:{arguments:part}}]}}]})),{choices:[{delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:11,completion_tokens:7}}]:[{choices:[{delta:{content:'Done café'}}]},{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7}}];
 const encoded=Buffer.from(chunks.map(c=>`data: ${JSON.stringify(c)}\n\n`).join('')+(mode==='truncated'?'':'data: [DONE]\n\n'));
 // Split on arbitrary byte boundaries, including inside UTF-8 and tool arguments.
 for(let at=0;at<encoded.length;at+=3)res.write(encoded.subarray(at,at+3));res.end();
 });
 const url=await listen(server);return {url,requests,close:()=>close(server)};
}

export async function readModel(response){
 if(!response.ok)throw Error(`ai_http_${response.status}`);
 const message=assistant(),decoder=new TextDecoder(),tools=new Map();let buffered='',done=false,finish=false;
 for await(const bytes of response.body){buffered+=decoder.decode(bytes,{stream:true});let boundary;
 while((boundary=buffered.indexOf('\n\n'))>=0){const frame=buffered.slice(0,boundary);buffered=buffered.slice(boundary+2);const data=frame.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');if(!data)continue;if(data==='[DONE]'){done=true;continue;}
 const chunk=JSON.parse(data),choice=chunk.choices?.[0];if(chunk.usage)message.usage={...message.usage,input:chunk.usage.prompt_tokens,output:chunk.usage.completion_tokens,totalTokens:chunk.usage.prompt_tokens+chunk.usage.completion_tokens};
 if(choice?.finish_reason){finish=true;message.stopReason=choice.finish_reason==='tool_calls'?'toolUse':'stop';}
 if(choice?.delta?.content){if(!message.content[0])message.content.push({type:'text',text:''});message.content[0].text+=choice.delta.content;}
 for(const delta of choice?.delta?.tool_calls??[]){const t=tools.get(delta.index)??{id:'',name:'',arguments:''};t.id+=delta.id??'';t.name+=delta.function?.name??'';t.arguments+=delta.function?.arguments??'';tools.set(delta.index,t);}
 }}
 if(!done||!finish||buffered.trim())throw Error('stream_truncated');
 for(const tool of tools.values())message.content.push({type:'toolCall',id:tool.id,name:tool.name,arguments:JSON.parse(tool.arguments)});
 return message;
}
const openaiMessages=context=>context.messages.map(m=>m.role==='toolResult'?{role:'tool',tool_call_id:m.toolCallId,content:JSON.stringify(m.content)}:m.role==='assistant'?{role:'assistant',content:m.content.filter(c=>c.type==='text').map(c=>c.text).join(''),tool_calls:m.content.filter(c=>c.type==='toolCall').map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.arguments)}}))}:{role:'user',content:typeof m.content==='string'?m.content:JSON.stringify(m.content)});

export async function runDesignPath({db,actor,routes,artifactId,threadId,work,session,modelMode='normal',history=[],retryReplies=false}){
 const app=new Hono(),secret='disposable-validation-signing-key';actorReceiver(secret).mount(app);
 app.get('/api/artifacts/:id',c=>routes.read(c.req.raw,c.req.param('id')));
 app.post('/api/artifacts/:id/annotations/:annId',c=>routes.reply(c.req.raw,c.req.param('id'),c.req.param('annId')));
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise(r=>server.listening?r():server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`,forward=overHttp(base,secret),model=await fixtureModel(modelMode),streams=new Map(),observed=[];
 const runner=new DesignRunner(db,async(id,run,operation,args)=>{
 const controller=new AbortController();run.controllers.add(controller);
 try{
 if(operation==='read'||operation==='reply'){
 // Deliberately construct fresh headers; program identity/auth/URL arguments are never forwarded.
 const path=operation==='read'?`/api/artifacts/${artifactId}`:`/api/artifacts/${artifactId}/annotations/${threadId}`;
 const headers={'content-type':'application/json'};if(operation==='reply')Object.assign(headers,{'X-Artifactbin-Remote-Session':session.id,'X-Artifactbin-Remote-Proof':session.runnerKey,'Idempotency-Key':`${work.id}-${args.phase}`});
 const request=new Request(base+path,{method:operation==='read'?'GET':'POST',headers,signal:controller.signal,...(operation==='reply'?{body:JSON.stringify({reply:args.body,request_id:work.id,phase:args.phase})}:{})});
 const retry=request.clone();const response=await forward(request,actor);if(retryReplies&&operation==='reply'){const again=await forward(retry,actor);if(again.status!==response.status)throw Error('reply_replay_failed');await again.arrayBuffer();}observed.push({operation,status:response.status});if(!response.ok)throw Error(`artifactbin_http_${response.status}`);return response.json();
 }
 if(operation==='ai.open'){
 const response=await fetch(model.url+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer fixture-key'},body:JSON.stringify({model:'fixture',stream:true,messages:openaiMessages(args.context),tools:args.context.tools.map(t=>({type:'function',function:{name:t.name,parameters:t.parameters}}))}),signal:controller.signal});
 const message=await readModel(response);run.usage.push(message.usage);const streamId=`${id}:${streams.size}`;streams.set(streamId,[{type:'done',reason:message.stopReason,message},null]);return {streamId};
 }
 if(operation==='ai.next'){if(!args.streamId.startsWith(id+':'))throw Error('foreign_stream');return streams.get(args.streamId).shift();}
 throw Error('unknown_capability');
 }finally{run.controllers.delete(controller);}
 });
 const conversationId=`${actor.userId}:${artifactId}`;await runner.initialize();await db.query('INSERT INTO design_conversations(id) VALUES($1) ON CONFLICT DO NOTHING',[conversationId]);
 try{
 const bundle=await bundleProgram(fileURLToPath(new URL('./agent.ts',import.meta.url)));
 const request={requestId:work.id,userId:actor.userId,bundle,input:{artifactId,message:'Please review',history},timeoutMs:15000};
 const {runId}=await runner.start(request);
 await db.query('INSERT INTO design_branches(id,conversation_id,run_id) VALUES($1,$2,$3)',[work.id,conversationId,runId]);
 const duplicate=await runner.start(request);if(duplicate.runId!==runId)throw Error('retry_not_deduplicated');
 const result=await runner.wait(runId);if(result.status==='completed'){await runner.commit(runId,result.result);await runner.commit(runId,result.result);}
 const branch=(await db.query('SELECT * FROM design_branches WHERE run_id=$1',[runId])).rows[0];
 return {...result,completed:result.status==='completed',observed,modelRequests:model.requests,branch,revision:(await db.query('SELECT revision FROM design_conversations WHERE id=$1',[conversationId])).rows[0].revision};
 }finally{await runner.close();await close(server);await model.close();}
}
