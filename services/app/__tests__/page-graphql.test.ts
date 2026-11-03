import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {signActor,verifyActor} from '@artifactbin/utils';
import {pageBackendOperation, localPageBackendCapability} from '@/lib/page-operations';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {createRunner} from '@artifactbin/runner/local';
import {setServices} from '@/lib/platform';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as artifactGet,PUT as artifactPut} from '@/app/api/artifacts/[id]/route';
import {GET,POST} from '@/app/api/artifacts/[id]/graphql/route';
import {request,useAppHarness,mintAccountToken} from './harness';
const harness=useAppHarness();
it('publishes, discovers and executes immutable resolver GraphQL through HTTP handlers; the removed store is unreachable',async()=>{
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args)});
 setServices({runner});
 try{
  const owner=await mintAccountToken('pagegraphql');
  const source='export const typeDefs="type Query { count:Int! corrupt:Int! } type Mutation { add:Int! @auth(role: owner) }"; export default { corrupt:async(args,p,c)=>{await c.store.set({count:99},{expected:0});return 99;}, count:async()=>1, add:async()=>1 };';
  const result=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><head><link rel="af-resolver" data-af-name="tasks" href="./tasks.ts"></head><body>Count</body></html>',resolverSources:{tasks:source}}}));
  expect(result.status).toBe(201);const created=await result.json();const context={params:Promise.resolve({id:created.id})};const path=`/api/artifacts/${created.id}/graphql`;
  const discovery=await GET(request(path,{token:owner.token}),context);expect(discovery.status).toBe(200);expect((await discovery.json()).sdl).toContain('tasks__Query');
  const mutation=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',query:'mutation { tasks { add } }'}}),context);expect(mutation.status).toBe(200);expect(await mutation.json()).toMatchObject({data:{tasks:{add:1}},extensions:{outcomes:{'tasks.add':'committed'}}});
  const query=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',query:'{ tasks { count } }'}}),context);expect(await query.json()).toEqual({data:{tasks:{count:1}}});
  const denied=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',query:'{ tasks { corrupt } }'}}),context);expect((await denied.json()).errors).toHaveLength(1);
  const head=await (await artifactGet(request(`/api/artifacts/${created.id}`,{token:owner.token}),context)).json();
  const updated=await artifactPut(request(`/api/artifacts/${created.id}`,{method:'PUT',token:owner.token,json:{html:head.html,resolverSources:{tasks:source},expectedVersion:head.version,expectedState:head.state}}),context);expect(updated.status).toBe(200);
  const archive=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',operation:'query',query:'mutation { tasks { add } }'}}),context);expect(archive.status).toBe(400);
  const archivedQuery=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',query:'{ tasks { corrupt } }'}}),context);expect((await archivedQuery.json()).errors).toHaveLength(1);
  const archivedRead=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',query:'{ tasks { count } }'}}),context);expect(await archivedRead.json()).toEqual({data:{tasks:{count:1}}});
  const {readHtmlPage}=await import('@/lib/html-publication');
  const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},created.id,'1');
  const link=page.links.find(link=>link.kind==='backend')!;const backend=await getHtmlBackendVersion(link.backendId,link.version);
  const secret='signed-operation-test-secret-at-least-32-bytes';
  for(const operation of ['query',undefined] as const){
   const actor=verifyActor(signActor({userId:backend!.ownerId,credential:'session',runner:{runId:'r',callId:1,artifactId:link.backendId,version:link.version,editId:link.version,sourceHash:createHash('sha256').update(backend!.compiled).digest('hex'),pageBackendOperation:operation}},secret),secret)!;
   const response=await pageBackendOperation(request('/api/runner/operations',{method:'POST',actor,json:{pageBackendOperation:'mutation'}}),'pageBackend.store.set',{value:{count:99},expected:1,pageBackendOperation:'mutation'},backend!.compiled);
   expect(response.status).toBe(403);
  }
  const archiveMutation=await POST(request(path,{method:'POST',token:owner.token,json:{revision:'1',query:'mutation { tasks { add } }'}}),context);expect(archiveMutation.status).toBe(403);

 }finally{await runner.close();}
},20000);
it('does not accept a page bearer as runner authority for resolver capabilities',async()=>{
 const {POST:capability}=await import('@/app/api/runner/operations/route');
 const owner=await mintAccountToken('capability');
 const response=await capability(request('/api/runner/operations',{method:'POST',token:owner.token,json:{operation:'pageBackend.fetch',input:{url:'https://api.example.com/'},documentSource:'forged'}}));
 expect(response.status).toBe(403);
});
