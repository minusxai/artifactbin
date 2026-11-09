/**
 * A PAGE FUNCTION through its plain-HTTP door (`/api/artifacts/:id/fn/:name`, lib/page-graphql `pageFunction`): a
 * backend file's default-export function, run by today's resolver runner as the reader the request proves, its
 * answer the function's JSON. Who may call it is the file's `roles` export (or a legacy file's `@auth`), "at least"
 * as today; a variable never names the caller.
 */
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import {setServices} from '@/lib/platform';
import {getDb} from '@/lib/platform';
import {getArtifactById,artifactState} from '@/lib/artifacts';
import {localPageBackendCapability} from '@/lib/page-operations';
import {POST as publish} from '@/app/api/artifacts/route';
import {PUT as update} from '@/app/api/artifacts/[id]/route';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {GET as fnGet,POST as fnPost} from '@/app/api/artifacts/[id]/fn/[name]/route';
import {request,useAppHarness,mintAccountToken} from './harness';
import {renderedSchema} from './rendered-schema';

const harness=useAppHarness();
let runner:Awaited<ReturnType<typeof createRunner>>;
beforeAll(async()=>{runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args)});setServices({runner});});
afterAll(async()=>{await runner?.close();});

/** A typeDefs-free file: the functions and who may call each. */
const FUNCTIONS=`export const roles={mine:'signed_in',viewing:'viewer',editing:'editor',owning:'owner'};
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
const LEGACY='export const typeDefs="type Query { hello(name: String): String! secret: String! @auth(role: owner) } type Mutation { bump(by: Int): Int! }"; export default {hello:async(a)=>"hi "+(a.name??"you"),secret:async()=>"s",bump:async(a)=>(a.by??1)+1};';
const HTML='<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"><link rel="af-resolver" data-af-name="old" href="./old.ts"></head><body>Fn</body></html>';

type Who={token:string;userId:string|null;email:string|null}|null;
const call=async(id:string,name:string,who:Who,init:{method?:'GET'|'POST';json?:unknown;body?:string;search?:string;headers?:Record<string,string>;origin?:string;cookie?:string}={})=>{
 const method=init.method??'POST';
 const req=request(`/api/artifacts/${id}/fn/${name}${init.search??''}`,{method,...(init.json!==undefined?{json:init.json}:{}),...(init.body!==undefined?{body:init.body}:{}),...(who?{token:who.token}:{}),...(init.headers?{headers:init.headers}:{}),...(init.origin?{origin:init.origin}:{}),...(init.cookie?{cookie:init.cookie}:{})});
 const response=await (method==='GET'?fnGet:fnPost)(req,{params:Promise.resolve({id,name})});
 const text=await response.text();let body:unknown=text;try{body=JSON.parse(text);}catch{/* raw */}
 return {status:response.status,type:response.headers.get('content-type'),body:body as any};
};

const world=harness.shared(async()=>{
 const owner=await mintAccountToken('fn_owner'),viewer=await mintAccountToken('fn_viewer'),editor=await mintAccountToken('fn_editor'),stranger=await mintAccountToken('fn_stranger');
 const create=async(visibility:string)=>{const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility,html:HTML,resolverSources:{api:FUNCTIONS,old:LEGACY}}}));const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(201);return body.id as string;};
 const page=await create('public'),privatePage=await create('private');
 const db=await getDb();
 for(const [who,role] of [[viewer,'viewer'],[editor,'editor']] as const)await db.query('INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,$4)',[page,who.userId,who.email,role]);
 return {owner,viewer,editor,stranger,page,privatePage};
});

describe('a typeDefs-free function answers plain JSON as the reader the request proves',()=>{
 it('POST JSON body is the input; the principal is derived, never read from the input',async()=>{
  const w=world();
  const forged={limit:50,principal:{tenant:'other',subject:'admin',role:'owner'},role:'owner',subject:w.owner.userId};
  const reply=await call(w.page,'whoami',w.viewer,{json:forged});
  expect(reply.status).toBe(200);expect(reply.type).toMatch(/^application\/json/);
  expect(reply.body).toEqual({args:forged,principal:{tenant:w.page,subject:w.viewer.userId,role:'viewer'}});
 });
 it('a plain fetch body (text/plain, as fetch sends a string) is still JSON input',async()=>{
  const w=world();
  const reply=await call(w.page,'whoami',null,{body:JSON.stringify({limit:5}),headers:{'content-type':'text/plain;charset=UTF-8'}});
  expect(reply.status).toBe(200);expect(reply.body).toEqual({args:{limit:5},principal:{tenant:w.page,subject:null,role:'anonymous'}});
 });
 it('GET query parameters are the input, as strings (a repeated name is a list)',async()=>{
  const w=world();
  const reply=await call(w.page,'whoami',w.owner,{method:'GET',search:'?limit=50&tag=a&tag=b'});
  expect(reply.status).toBe(200);expect(reply.body.args).toEqual({limit:'50',tag:['a','b']});expect(reply.body.principal.role).toBe('owner');
 });
 it('an empty body is an empty input; undefined answers null',async()=>{
  const w=world();
  expect((await call(w.page,'whoami',null)).body.args).toEqual({});
  expect(await call(w.page,'nothing',null)).toMatchObject({status:200,body:null});
 });
 it('roles: anonymous < signed_in < viewer < editor < owner, "at least", 403 below',async()=>{
  const w=world();
  const table:Array<[Who,string,number]>=[
   [null,'mine',403],[w.stranger,'mine',200],[w.stranger,'viewing',403],[w.viewer,'viewing',200],[w.viewer,'editing',403],
   [w.editor,'editing',200],[w.editor,'owning',403],[w.owner,'owning',200],[w.owner,'mine',200],[null,'whoami',200],
  ];
  for(const [who,name,status] of table)expect((await call(w.page,name,who)).status,`${who?.email??'anonymous'} → ${name}`).toBe(status);
  expect(await call(w.page,'mine',null)).toMatchObject({status:403,body:{error:'sign_in_required'}});
  expect(await call(w.page,'owning',w.viewer)).toMatchObject({status:403,body:{error:'forbidden'}});
  expect((await call(w.page,'mine',w.stranger)).body).toBe(w.stranger.userId);
 });
 it('a reader who cannot read the page gets the uniform 404, as GraphQL does',async()=>{
  const w=world();
  expect(await call(w.privatePage,'whoami',w.stranger)).toMatchObject({status:404,body:{error:'not_found'}});
  expect(await call(w.privatePage,'whoami',null)).toMatchObject({status:404,body:{error:'not_found'}});
  expect((await call(w.privatePage,'whoami',w.owner)).status).toBe(200);
 });
});

describe('refusals are HTTP statuses with a JSON reason',()=>{
 it('unknown and malformed names are 404 unknown_function',async()=>{
  const w=world();
  for(const name of ['missing','..','../graphql','a.b','toString','__proto__','constructor','x'.repeat(200)])
   expect(await call(w.page,name,w.owner),name).toMatchObject({status:404,body:{error:'unknown_function'}});
 });
 it('non-JSON, non-object and oversized inputs are refused before anything runs',async()=>{
  const w=world();
  expect(await call(w.page,'whoami',null,{body:'{not json'})).toMatchObject({status:400,body:{error:'invalid_json'}});
  expect(await call(w.page,'whoami',null,{body:'[1,2]'})).toMatchObject({status:400,body:{error:'input_not_object'}});
  expect(await call(w.page,'whoami',null,{body:'"x"'})).toMatchObject({status:400,body:{error:'input_not_object'}});
  expect(await call(w.page,'whoami',null,{json:{blob:'x'.repeat(70_000)}})).toMatchObject({status:413,body:{error:'payload_too_large'}});
 });
 it('a function that throws is 500 with its own message; only the owner sees the detail code',async()=>{
  const w=world();
  const viewer=await call(w.page,'boom',w.viewer);
  expect(viewer).toMatchObject({status:500,body:{error:'backend_failed',message:'the upstream said no'}});
  expect(viewer.body.detail).toBeUndefined();
  const owner=await call(w.page,'boom',w.owner);
  expect(owner).toMatchObject({status:500,body:{error:'backend_failed',message:'the upstream said no'}});
 });
 it('a write (POST to a typeDefs-free function) on an archived revision is refused; a GET read is not',async()=>{
  const w=world();
  // A second revision makes revision 1 archived.
  const head=(await getArtifactById(w.page))!;
  const put=await update(request(`/api/artifacts/${w.page}`,{method:'PUT',token:w.owner.token,json:{expectedVersion:head.version,expectedState:artifactState(head),html:HTML.replace('Fn','Fn 2'),resolverSources:{api:FUNCTIONS,old:LEGACY}}}),{params:Promise.resolve({id:w.page})});
  expect(put.status,await put.clone().text()).toBeLessThan(300);
  expect(await call(w.page,'whoami',w.owner,{headers:{'x-page-revision':'1'}})).toMatchObject({status:403,body:{error:'archived_page_readonly'}});
  expect((await call(w.page,'whoami',w.owner,{method:'GET',headers:{'x-page-revision':'1'}})).status).toBe(200);
  expect((await call(w.page,'whoami',w.owner,{headers:{'x-page-revision':'2'}})).status).toBe(200);
 });
});

describe('legacy files: unchanged, through /fn and GraphQL alike',()=>{
 it('Query and Mutation fields run by name; @auth still decides',async()=>{
  const w=world();
  expect(await call(w.page,'hello',null,{json:{name:'ada'}})).toMatchObject({status:200,body:'hi ada'});
  expect(await call(w.page,'hello',null,{method:'GET',search:'?name=bo'})).toMatchObject({status:200,body:'hi bo'});
  expect(await call(w.page,'bump',w.viewer,{json:{by:2}})).toMatchObject({status:200,body:3});
  expect(await call(w.page,'secret',w.viewer)).toMatchObject({status:403,body:{error:'forbidden'}});
  expect(await call(w.page,'secret',w.owner)).toMatchObject({status:200,body:'s'});
 });
 it('a GET never runs a Mutation field',async()=>{
  const w=world();
  expect(await call(w.page,'bump',w.owner,{method:'GET'})).toMatchObject({status:405,body:{error:'method_not_allowed'}});
 });
 it('GraphQL still serves the legacy file; the typeDefs-free file adds nothing to it',async()=>{
  const w=world();
  const gql=async(query:string)=>(await graphql(request(`/api/artifacts/${w.page}/graphql`,{method:'POST',token:w.owner.token,json:{revision:'1',query}}),{params:Promise.resolve({id:w.page})})).json();
  expect(await gql('{ old { hello(name: "g") } }')).toEqual({data:{old:{hello:'hi g'}}});
  expect((await gql('{ api { whoami } }')).errors).toBeDefined();
 });
});

describe('the opaque-origin door (an unframed sandboxed copy) reads as nobody',()=>{
 it('drops every credential and answers reads only, with open CORS',async()=>{
  const w=world();
  const read=await call(w.page,'whoami',w.owner,{method:'GET',origin:'null'});
  expect(read.status).toBe(200);expect(read.body.principal).toEqual({tenant:w.page,subject:null,role:'anonymous'});
  expect(await call(w.page,'whoami',w.owner,{origin:'null',body:'{}'})).toMatchObject({status:403,body:{error:'read_only'}});
  expect((await call(w.page,'hello',w.owner,{origin:'null',body:'{"name":"q"}'})).body).toBe('hi q');
 });
});

describe('publishing a typeDefs-free file checks its roles',()=>{
 const tryPublish=async(source:string)=>{const w=world();const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{visibility:'public',html:'<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>x</body></html>',resolverSources:{api:source}}}));return {status:response.status,body:await response.text()};};
 it('refuses a role name outside the five, a role for no function, and roles beside typeDefs',async()=>{
  expect(await tryPublish(`export const roles={a:'admin'};export default {a(){}}`)).toMatchObject({status:400});
  expect(await tryPublish(`export const roles={b:'owner'};export default {a(){}}`)).toMatchObject({status:400});
  expect(await tryPublish(`export const roles={a:'owner'};export const typeDefs="type Query { a: Int }";export default {a(){return 1}}`)).toMatchObject({status:400});
  expect(await tryPublish(`export default {}`)).toMatchObject({status:400});
  expect((await tryPublish(`export default {a(){return 1}}`)).status).toBe(201);
 });
});

it('does not publish a prototype role declaration as anonymous',async()=>{
 const w=world();
 const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{
  visibility:'public',html:'<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>x</body></html>',
  resolverSources:{api:`export const roles={__proto__:{sensitive:'owner'}};export default {sensitive(){return 'private result'}}`},
 }}));
 // Reject malformed role objects, or enforce the declared owner role.
 if(response.status===400)return;
 expect(response.status).toBe(201);
 const {id}=await response.json();
 expect((await call(id,'sensitive',null,{method:'GET'})).status).toBe(403);
});

it('adds nullable function_roles idempotently without changing legacy rows',async()=>{
 const db=await getDb();
 const statement=renderedSchema().schema.match(/ALTER TABLE app\.html_backend_versions ADD COLUMN IF NOT EXISTS function_roles JSONB;/)?.[0];
 expect(statement).toBeDefined();
 await db.query('CREATE TEMP TABLE review_backend_versions (version TEXT PRIMARY KEY, type_defs TEXT NOT NULL)');
 try{
  await db.query("INSERT INTO review_backend_versions VALUES ('legacy', 'type Query { hello: String }')");
  const migrate=statement!.replace('app.html_backend_versions','review_backend_versions');
  await db.query(migrate);await db.query(migrate);
  expect((await db.query('SELECT * FROM review_backend_versions')).rows).toEqual([{version:'legacy',type_defs:'type Query { hello: String }',function_roles:null}]);
 }finally{await db.query('DROP TABLE review_backend_versions');}
});

it('honors exported roles aliases despite a shadowed local roles name and own prototype keys',async()=>{
 const w=world();
 const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{
  visibility:'public',html:'<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>x</body></html>',
  resolverSources:{api:`const guards={['__proto__']:'owner',sensitive:'owner'};export {guards as roles};function local(){const roles={sensitive:'anonymous'};return roles}export default {['__proto__'](){return 1},sensitive(){return local()}}`},
 }}));
 expect(response.status).toBe(201);
 const {id}=await response.json();
 for(const name of ['sensitive','__proto__'])expect((await call(id,name,null,{method:'GET'})).status).toBe(403);
});

it('refuses oversized backend output instead of returning it through the bridge',async()=>{
 const w=world();
 const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{
  visibility:'public',html:'<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>x</body></html>',
  resolverSources:{api:`export default {huge(){return 'x'.repeat(4*1024*1024+1)}}`},
 }}));
 expect(response.status).toBe(201);
 const {id}=await response.json();
 expect((await call(id,'huge',null,{method:'GET'})).status).toBe(500);
});

it('an unframed call runs the served revision\'s backend, named by ?revision= (never part of the input)',async()=>{
 const w=world();
 const html='<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>v</body></html>';
 const source=(n:number)=>`export default {v(args){return {n:${n},args}}}`;
 const created=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{visibility:'public',html,resolverSources:{api:source(1)}}}));
 const {id}=await created.json();
 const head=(await getArtifactById(id))!;
 const put=await update(request(`/api/artifacts/${id}`,{method:'PUT',token:w.owner.token,json:{expectedVersion:head.version,expectedState:artifactState(head),html:html.replace('>v<','>v2<'),resolverSources:{api:source(2)}}}),{params:Promise.resolve({id})});
 expect(put.status,await put.clone().text()).toBeLessThan(300);
 expect((await call(id,'v',null,{method:'GET',origin:'null',search:'?revision=1&q=a'})).body).toEqual({n:1,args:{q:'a'}});
 expect((await call(id,'v',null,{method:'GET',origin:'null'})).body.n).toBe(2);
 expect((await call(id,'v',null,{method:'GET',search:'?revision=2',headers:{'x-page-revision':'2'}})).body.n).toBe(2);
 expect(await call(id,'v',null,{method:'GET',search:'?revision=2',headers:{'x-page-revision':'1'}})).toMatchObject({status:400,body:{error:'revision_conflict'}});
});

it('refuses roles that are not a plain object literal',async()=>{
 const w=world();
 const tryRoles=async(roles:string)=>(await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{visibility:'public',html:'<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>x</body></html>',resolverSources:{api:`export const roles=${roles};export default {a(){return 1}}`}}})));
 for(const roles of ['[]',"Object.create({a:'owner'})",'new (class R{})()']){const response=await tryRoles(roles);expect(response.status,roles).toBe(400);expect(await response.text(),roles).toContain('invalid_roles');}
 expect((await tryRoles("Object.assign(Object.create(null),{a:'owner'})")).status).toBe(201);
});
