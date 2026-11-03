import {it,expect} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import {setServices} from '@/lib/platform';
import {localPageBackendCapability} from '@/lib/page-operations';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {forkArtifact} from '@/lib/publish';
import {getArtifactById} from '@/lib/artifacts';
import { identityForUser } from '@/lib/accounts';
import {request,useAppHarness,mintAccountToken} from './harness';
const harness=useAppHarness();
it('executes a fork\'s copied resolver under the fork\'s own page identity and owner',async()=>{
 const runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args)});setServices({runner});
 try{
 const owner=await mintAccountToken('original');const viewer=await mintAccountToken('copy');
 const source='export const typeDefs="type Query { page:String! } type Mutation { add:Int! @auth(role: owner) }"; export default {page:async(a,p)=>p.tenant,add:async()=>1};';
 const created=await (await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><head><link rel="af-resolver" data-af-name="db" href="./db.ts"></head><body>Counter</body></html>',resolverSources:{db:source}}}))).json();
 const call=async(id:string,token:string,query:string)=>await (await graphql(request(`/api/artifacts/${id}/graphql`,{method:'POST',token,json:{revision:'1',query}}),{params:Promise.resolve({id})})).json();
 expect(await call(created.id,owner.token,'mutation { db { add } }')).toMatchObject({data:{db:{add:1}}});
 const fork=await forkArtifact({...identityForUser(viewer.userId,viewer.id),tokenId:viewer.id},(await getArtifactById(created.id))!);if(fork instanceof Response)throw Error(await fork.text());
 expect(await call(fork.artifact.id,viewer.token,'{ db { page } }')).toEqual({data:{db:{page:fork.artifact.id}}});
 expect(await call(fork.artifact.id,viewer.token,'mutation { db { add } }')).toMatchObject({data:{db:{add:1}}});
 expect(await call(created.id,owner.token,'{ db { page } }')).toEqual({data:{db:{page:created.id}}});
 // The fork's owner is not an owner of the source page.
 expect((await call(created.id,viewer.token,'mutation { db { add } }')).errors).toBeDefined();
 }finally{await runner.close();}
},20000);
