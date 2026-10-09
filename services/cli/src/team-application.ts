/**
 * OSS team composition reuses the shared login and identity; the app owns authorization. The app host
 * is a parameter (services/app/server/team-host passes createAppHost), so the CLI never imports the server.
 */
import {canAuthenticateUser,EVENTS_SCHEMA,MAX_QUERY_ROWS,QUERY_TIMEOUT_MS,setServices,type Db} from '../../app/lib/cli-toolkit/host.server';
import {join} from 'node:path';
import {createTokenReader} from '@artifactbin/utils';
import {createHumanAuth,ensureAuthSchema,loginProvidersOf,mailerForRuntime,createAuthHost,readEnv,sessionStoreOf} from '@artifactbin/auth';
import {createSql} from '@artifactbin/sql/local';
import {createBrowser,sessionProcessPaths} from '@artifactbin/browser/local';
import {createEvents,ensureEventsSchema} from '@artifactbin/events/local';
import type {Actor,Upstream} from '@artifactbin/contracts';
import {chromiumExecutable} from './chromium';

/** What team hosting needs of the app host (services/app/server/host `createAppHost`). */
interface TeamAppHost {fetch:(request:Request)=>Promise<Response>;close:()=>Promise<void>;request:(request:Request,actor:Actor)=>Promise<Response>}
type CreateTeamAppHost=(options:{webDir:string;publicDir:string;actorSecret:string|undefined;
 services:{sql:ReturnType<typeof createSql>;browser:ReturnType<typeof createBrowser>};shutdown:()=>Promise<void>;onTokenRevoked:(id?:string)=>void;
 initialize:(db:Db)=>Promise<void>;identity:(upstream:Upstream)=>{fetch:(request:Request)=>Promise<Response>}})=>Promise<TeamAppHost>;

export async function createTeamApplication(env:NodeJS.ProcessEnv,assets:string,createAppHost:CreateTeamAppHost):Promise<TeamAppHost>{
 const origin=readEnv(env,'APP__PUBLIC_BASE_URL'),secret=readEnv(env,'AUTH__SECRET');
 if(!origin||!secret)throw new Error('Team hosting requires APP__PUBLIC_BASE_URL and AUTH__SECRET.');
 let host:TeamAppHost,identity:Parameters<typeof createAuthHost>[0];
 let reader:ReturnType<typeof createTokenReader>;
 const browser=createBrowser({executablePath:chromiumExecutable,sessions:{browserExecutable:chromiumExecutable,...sessionProcessPaths(env),baseURL:origin,request:async(request,actor)=>host.request(request,actor)}});
 const sql=createSql({maxRows:MAX_QUERY_ROWS,timeoutMs:QUERY_TIMEOUT_MS});
 try{
 // Trusted runner callbacks carry signed identity; ordinary login still composes through auth.
 host=await createAppHost({webDir:join(assets,'dist/web'),publicDir:join(assets,'public'),actorSecret:readEnv(env,'CONTRACT__ACTOR_SECRET'),
  services:{sql,browser},shutdown:async()=>{await browser.close();await sql.close();},
  onTokenRevoked:id=>reader.invalidate(id),
  initialize:async db=>{
   const queryable={query:async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>db.query<T>(text,params)};
   await ensureEventsSchema(queryable,EVENTS_SCHEMA);
   const events=createEvents({db:queryable,schema:EVENTS_SCHEMA});setServices({events});
   const authSchema=readEnv(env,'AUTH__SCHEMA')??'auth',appSchema=readEnv(env,'APP__SCHEMA');
   await ensureAuthSchema(queryable,authSchema);
   const raw=db.raw();
   const human=await createHumanAuth({secret,baseURL:origin,schema:authSchema,secure:origin.startsWith('https:'),events,...loginProvidersOf(env),
    ...(raw.kind==='pglite'?{pglite:raw.instance}:{pool:raw.pool as import('pg').Pool}),
    mail:mailerForRuntime({apiKey:readEnv(env,'EMAIL__RESEND_API_KEY'),from:readEnv(env,'EMAIL__FROM')??'artifactbin <login@example.com>',publicBaseUrl:origin,devOutboxPath:readEnv(env,'EMAIL__DEV_OUTBOX_PATH')})});
   reader=createTokenReader({db:queryable,ttlMs:5000,admitBearer:token=>canAuthenticateUser(token.userId),...(appSchema?{schema:appSchema}:{})});
   // createAppHost supplies the real upstream after initialization; no HTTP hop or signed-header bypass.
   identity={upstream:async()=>{throw new Error('Team host is not initialized.');},env,tokens:reader,sessions:sessionStoreOf(human),cookieSecret:secret,
    secure:origin.startsWith('https:'),identityDb:queryable,appSchema,events};
  },identity:upstream=>{const composed=createAuthHost({...identity,upstream});return {fetch:request=>Promise.resolve(composed.fetch(request))};},
 });
 return host;
 }catch(error){await browser.close();throw error;}
}
