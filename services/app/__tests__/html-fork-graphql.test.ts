import {it,expect} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import {setServices} from '@/lib/platform';
import {localPageBackendCapability} from '@/lib/page-operations';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {forkArtifact} from '@/lib/publish/publish';
import {getArtifactById} from '@/lib/artifacts';
import {identityForUser} from '@/lib/accounts';
import {request,useAppHarness,mintAccountToken} from './harness';
const harness=useAppHarness();
it('executes a fork with fresh state and keeps mutations isolated from the source',async()=>{
 const runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args)});setServices({runner});
 try{
 const owner=await mintAccountToken('original');const viewer=await mintAccountToken('copy');
 const source='export const typeDefs="type Query { count:Int! } type Mutation { add:Int! @auth(role:OWNER) }"; export default {count:async(a,p,c)=>(await c.store.get()).value?.count??0,add:async(a,p,c)=>{const s=await c.store.get();await c.store.set({count:(s.value?.count??0)+1},{expected:s.version});return 1;}};';
 const created=await (await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><head><link rel="af-backend" data-af-name="db" href="./db.ts"></head><body>Counter</body></html>',backendSources:{db:source}}}))).json();
 const call=async(id:string,token:string,query:string)=>await (await graphql(request(`/api/artifacts/${id}/graphql`,{method:'POST',token,json:{revision:'1',query}}),{params:Promise.resolve({id})})).json();
 expect(await call(created.id,owner.token,'mutation { db { add } }')).toMatchObject({data:{db:{add:1}}});
 const fork=await forkArtifact({...identityForUser(viewer.userId,viewer.id),tokenId:viewer.id},(await getArtifactById(created.id))!);if(fork instanceof Response)throw Error(await fork.text());
 expect(await call(fork.artifact.id,viewer.token,'{ db { count } }')).toEqual({data:{db:{count:0}}});
 expect(await call(fork.artifact.id,viewer.token,'mutation { db { add } }')).toMatchObject({data:{db:{add:1}}});
 expect(await call(created.id,owner.token,'{ db { count } }')).toEqual({data:{db:{count:1}}});
 expect(await call(fork.artifact.id,viewer.token,'{ db { count } }')).toEqual({data:{db:{count:1}}});
 }finally{await runner.close();}
},20000);
