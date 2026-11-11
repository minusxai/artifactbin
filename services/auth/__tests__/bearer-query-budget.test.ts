/**
 * WHAT ONE BEARER REQUEST COSTS THE DATABASE, in the production proxy's shape: the auth host in front of the
 * app, with Better Auth's identity and the OAuth family store on one pool. Every request reads the database
 * (no token cache), so revocation by any writer on any connection refuses the very next request.
 */
import {afterAll,beforeEach,expect,it} from 'vitest';
import {Hono} from 'hono';
import {REVALIDATE_ACTOR_HEADER,type Actor,type Queryable} from '@artifactbin/contracts';
import {actorOf} from '@artifactbin/utils';
import {bearerAdmission,createAuthHost,type AuthOptions} from '../src/parts';
import {createOAuthStore} from '../src/identity/oauth';
import {createBearerReader} from '../src/identity/bearer';
import {mintTestToken,resetTestDb,testDb} from './helpers';

const ORIGIN='http://app.test';
let statements:string[]=[];
const recorded:Queryable={query:async<T=Record<string,unknown>>(sql:string,params?:unknown[])=>{statements.push(sql.replace(/\s+/g,' ').trim());return testDb().query<T>(sql,params);}};
const options=():AuthOptions=>({
 env:{APP__PUBLIC_BASE_URL:ORIGIN},cookieSecret:'test-cookie-secret-00000000000000000000',identityDb:recorded,
 tokens:createBearerReader({db:recorded}),
 // Better Auth's identity read, as human.ts issues it, through the same pool.
 sessions:{resolve:async()=>null,identity:async userId=>{const row=(await recorded.query<{id:string;email:string;emailVerified:boolean}>('SELECT id,email,"emailVerified" FROM auth."user" WHERE id=$1',[userId])).rows[0];return row?{userId:row.id,email:row.email,emailVerified:row.emailVerified}:null;}},
 upstream:async(request,actor)=>actor.credential==='none'?Response.json({error:'unauthorized'},{status:401})
  :Response.json(actor,{headers:new URL(request.url).searchParams.has('revalidate')?{[REVALIDATE_ACTOR_HEADER]:'1'}:{}}),
});
/** Statements one request issues, and what it answered. */
const measure=async(fetch:(request:Request)=>Response|Promise<Response>,token:string,path='/api/artifacts')=>{
 statements=[];
 const response=await fetch(new Request(ORIGIN+path,{headers:{authorization:`Bearer ${token}`}}));
 return {status:response.status,actor:response.status===200?await response.json() as Actor:null,statements:[...statements]};
};
const cliToken=async()=>mintTestToken({id:'tok_cli',userId:'usr_owner',query:testDb().query});
const oauthToken=async()=>{
 const token=await mintTestToken({id:'tok_oauth',userId:'usr_owner',query:testDb().query});
 await testDb().query("UPDATE auth.tokens SET audience=$1,scope='artifacts' WHERE id='tok_oauth'",[`${ORIGIN}/api`]);
 await createOAuthStore({query:testDb().query},'auth').issueRefresh({clientId:'client',userId:'usr_owner',resource:`${ORIGIN}/api`,scope:'artifacts',accessTokenId:'tok_oauth'});
 return token;
};

beforeEach(async()=>{
 await resetTestDb();
 await testDb().query('DELETE FROM auth."user"');
 await testDb().query(`INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES('usr_owner','Owner','owner@example.com',true)`);
});
afterAll(async()=>{await testDb().pg().close();});

const owner={credential:'bearer',userId:'usr_owner',email:'owner@example.com',emailVerified:true};

it('a CLI bearer costs one statement, and a raw-SQL revocation refuses the next request',async()=>{
 const host=createAuthHost(options()),token=await cliToken();
 await measure(host.fetch,token);
 const warm=await measure(host.fetch,token);
 expect(warm.actor).toEqual({...owner,tokenId:'tok_cli'});
 expect(warm.statements).toHaveLength(1);
 await testDb().query("UPDATE auth.tokens SET deleted_at=now() WHERE id='tok_cli'");
 expect(await measure(host.fetch,token)).toMatchObject({status:401,statements:{length:1}});
});

it('an OAuth bearer costs one statement including its family fence, and a raw-SQL family revocation refuses the next request',async()=>{
 const host=createAuthHost(options()),token=await oauthToken();
 await measure(host.fetch,token);
 const warm=await measure(host.fetch,token);
 expect(warm.actor).toEqual({...owner,tokenId:'tok_oauth'});
 expect(warm.statements).toHaveLength(1);
 await testDb().query("UPDATE auth.credentials SET deleted_at=now() WHERE kind='refresh_family'");
 expect(await measure(host.fetch,token)).toMatchObject({status:401,statements:{length:1}});
});

it('a response the app marks for revalidation re-resolves the bearer once after it',async()=>{
 const host=createAuthHost(options());
 for(const token of [await cliToken(),await oauthToken()]){
  const revalidated=await measure(host.fetch,token,'/api/artifacts?revalidate=1');
  expect(revalidated.status).toBe(200);
  expect(revalidated.statements).toHaveLength(2);
 }
});

it('app-only bearer admission costs the same one statement',async()=>{
 const app=new Hono();bearerAdmission(options()).mount(app);
 app.all('*',c=>Response.json(actorOf(c.req.raw)??{credential:'none'}));
 for(const [token,tokenId] of [[await cliToken(),'tok_cli'],[await oauthToken(),'tok_oauth']] as const){
  const warm=await measure(app.fetch,token);
  expect(warm.actor).toMatchObject({credential:'bearer',userId:'usr_owner',tokenId});
  expect(warm.statements).toHaveLength(1);
 }
});
