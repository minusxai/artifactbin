import { expect, it } from 'vitest';
import type { Upstream } from '@artifactbin/contracts';
import { hostedAgentClient, hostedAgentSessionId } from '../src/hosted-agent-client';
import { serve, overHttp, verifyActor } from '../src';
import { ACTOR_HEADER } from '@artifactbin/contracts';

it('sends owner identity through the authenticated transport and never the body', async () => {
  const calls: Array<{ path: string; body: unknown; userId: string | undefined }> = [];
  const forward: Upstream = async (request, actor) => {
    calls.push({ path: new URL(request.url).pathname, body: await request.json(), userId: actor.userId });
    return Response.json({ id: hostedAgentSessionId(actor.userId!) });
  };
  const client = hostedAgentClient('https://service.test', forward);
  await client.ensure('alice');
  await client.input('alice', hostedAgentSessionId('alice'), 'hello');
  expect(calls).toEqual([
    { path: '/v1/agents/ensure', body: {}, userId: 'alice' },
    { path: '/v1/agents/input', body: { id: hostedAgentSessionId('alice'), text: 'hello' }, userId: 'alice' },
  ]);
  expect(client.owns('bob', hostedAgentSessionId('alice'))).toBe(false);
  await expect(client.stop('bob', hostedAgentSessionId('alice'))).rejects.toThrow('not_found');
  expect(calls).toHaveLength(2);
});

it('signs the owner over real HTTP and rejects a service response belonging to another owner', async()=>{
 const secret='fixture-only-hosted-actor-secret-00000000';
 const server=serve({fetch:async(request:Request)=>{
   const actor=verifyActor(request.headers.get(ACTOR_HEADER),secret);
   if(!actor?.userId)return Response.json({error:'unauthorized'},{status:401});
   expect(await request.json()).toEqual({});
   return Response.json({id:hostedAgentSessionId(actor.userId)});
 }},0);
 try {
   const client=hostedAgentClient(server.url,overHttp(server.url,secret));
   expect((await client.ensure('alice')).id).toBe(hostedAgentSessionId('alice'));
   const unsigned=hostedAgentClient(server.url,overHttp(server.url,'wrong-secret'));
   await expect(unsigned.ensure('alice')).rejects.toThrow('unauthorized');
 }finally{await server.close();}
});

it('fails closed on a service identity mismatch, errors, or credentials in the URL', async () => {
  const wrong = hostedAgentClient('https://service.test', async () => Response.json({ id: hostedAgentSessionId('bob') }));
  await expect(wrong.ensure('alice')).rejects.toThrow('not_found');
  const down = hostedAgentClient('https://service.test', async () => Response.json({ error: 'unavailable' }, { status: 503 }));
  await expect(down.ensure('alice')).rejects.toThrow('unavailable');
  expect(() => hostedAgentClient('https://user:secret@service.test', async () => Response.json({}))).toThrow('hosted_agent_service_url_invalid');
});

it('delivers committed comments with stable receipt identity and no callback credentials', async()=>{
 const calls:Request[]=[];
 const client=hostedAgentClient('https://service.test',async()=>{throw Error('ordinary transport must not deliver');},async request=>{calls.push(request);return Response.json({accepted:true});});
 const comment={requestId:'work-1',sessionId:hostedAgentSessionId('alice'),artifactId:'doc',threadId:'thread',commentId:'comment',body:'help',author:'Alice',callbackUrl:'https://app.test/api/remote/hosted/operations'};
 await client.deliverComment!('alice',comment);
 expect(calls[0].url).toBe('https://service.test/v1/agents/comment');
 expect(await calls[0].json()).toEqual(comment);
 await expect(client.deliverComment!('bob',comment)).rejects.toThrow('not_found');
 const ordinaryOnly=hostedAgentClient('https://service.test',async()=>{throw Error('must not send');});
 await expect(ordinaryOnly.deliverComment!('alice',comment)).rejects.toThrow('hosted_comment_transport_unavailable');
});

it('transports app-attested authority metadata and readonly status through the signed owner boundary',async()=>{
 const calls:Array<{path:string;body:unknown;owner:string|undefined}>=[];
 const client=hostedAgentClient('https://service.test',async(request,actor)=>{const path=new URL(request.url).pathname;calls.push({path,body:await request.json(),owner:actor.userId});return Response.json(path.endsWith('/status')?null:path.endsWith('/authorize-operation')?{kind:'allowed'}:{ok:true});});
 const credential={name:'server-grant',expiresAt:null,scoped:true};
 expect(await client.status!('alice')).toBeNull();expect(await client.authorizeOperation!('alice','token','annotate',{id:'doc'},credential)).toEqual({kind:'allowed'});
 await client.operationCompleted!('alice','token','create_artifact',{}, {id:'created'},credential);
 expect(calls).toEqual([{path:'/v1/agents/status',body:{},owner:'alice'},{path:'/v1/agents/authorize-operation',body:{tokenId:'token',name:'annotate',input:{id:'doc'},credential},owner:'alice'},{path:'/v1/agents/operation-completed',body:{tokenId:'token',name:'create_artifact',input:{},result:{id:'created'},credential},owner:'alice'}]);
 const wrong=hostedAgentClient('https://service.test',async()=>Response.json({id:hostedAgentSessionId('bob')}));await expect(wrong.status!('alice')).rejects.toThrow('not_found');
});
