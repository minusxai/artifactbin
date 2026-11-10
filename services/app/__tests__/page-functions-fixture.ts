/**
 * The page-functions suites' shared start (page-functions*.test.ts): the backend files they publish, the `/fn` caller,
 * and `usePageFunctions`, which takes the app harness, runs the resolver runner on the file's database and builds the
 * shared world of readers and pages once per file.
 */
import {afterAll,beforeAll,expect} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import {getDb,setServices} from '@/lib/platform';
import {localPageBackendCapability} from '@/lib/page-operations';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as fnGet,POST as fnPost} from '@/app/api/artifacts/[id]/fn/[name]/route';
import {request,useAppHarness,mintAccountToken} from './harness';

/** A typeDefs-free file: the functions and who may call each. */
export const FUNCTIONS=`export const roles={mine:'signed_in',viewing:'viewer',editing:'editor',owning:'owner'};
export default {
 async whoami(args,principal){return {args,principal};},
 async mine(_a,p){return p.subject;},
 async viewing(){return 'viewer+';},
 async editing(){return 'editor+';},
 async owning(){return 'owner';},
 async boom(){throw new Error('the upstream said no');},
 async nothing(){},
};`;
/** A legacy file: SDL with @auth, Query and Mutation fields. */
export const LEGACY='export const typeDefs="type Query { hello(name: String): String! secret: String! @auth(role: owner) } type Mutation { bump(by: Int): Int! }"; export default {hello:async(a)=>"hi "+(a.name??"you"),secret:async()=>"s",bump:async(a)=>(a.by??1)+1};';
export const HTML='<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"><link rel="af-resolver" data-af-name="old" href="./old.ts"></head><body>Fn</body></html>';

export type Who={token:string;userId:string|null;email:string|null}|null;
export const call=async(id:string,name:string,who:Who,init:{method?:'GET'|'POST';json?:unknown;body?:string;search?:string;headers?:Record<string,string>;origin?:string;cookie?:string}={})=>{
 const method=init.method??'POST';
 const req=request(`/api/artifacts/${id}/fn/${name}${init.search??''}`,{method,...(init.json!==undefined?{json:init.json}:{}),...(init.body!==undefined?{body:init.body}:{}),...(who?{token:who.token}:{}),...(init.headers?{headers:init.headers}:{}),...(init.origin?{origin:init.origin}:{}),...(init.cookie?{cookie:init.cookie}:{})});
 const response=await (method==='GET'?fnGet:fnPost)(req,{params:Promise.resolve({id,name})});
 const text=await response.text();let body:unknown=text;try{body=JSON.parse(text);}catch{/* raw */}
 return {status:response.status,type:response.headers.get('content-type'),body:body as any};
};

export function usePageFunctions(){
 const harness=useAppHarness();
 let runner:Awaited<ReturnType<typeof createRunner>>;
 beforeAll(async()=>{runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args)});setServices({runner});});
 afterAll(async()=>{await runner?.close();});
  const world=harness.shared(async()=>{
   const owner=await mintAccountToken('fn_owner'),viewer=await mintAccountToken('fn_viewer'),editor=await mintAccountToken('fn_editor'),stranger=await mintAccountToken('fn_stranger');
   const create=async(visibility:string)=>{const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility,html:HTML,resolverSources:{api:FUNCTIONS,old:LEGACY}}}));const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(201);return body.id as string;};
   const page=await create('public'),privatePage=await create('private');
   const db=await getDb();
   for(const [who,role] of [[viewer,'viewer'],[editor,'editor']] as const)await db.query('INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,$4)',[page,who.userId,who.email,role]);
   return {owner,viewer,editor,stranger,page,privatePage};
  });
 return {world};
}
