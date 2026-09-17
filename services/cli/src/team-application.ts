import {isSea} from 'node:sea';
/** OSS team composition reuses the shared login and identity; the app owns authorization. */
import {join} from 'node:path';
import {createTokenReader} from '@artifactbin/utils';
import {createHumanAuth,ensureAuthSchema,loginProvidersOf,mailerForRuntime,createAuthHost,readEnv,sessionStoreOf} from '@artifactbin/auth';
import {createSql} from '@artifactbin/sql/local';
import {createBrowser,sessionProcessPaths} from '@artifactbin/browser/local';
import {createEvents,ensureEventsSchema} from '@artifactbin/events/local';
import {createAppHost,type AppHost} from '../../app/server/host';
import {EVENTS_SCHEMA,MAX_QUERY_ROWS,QUERY_TIMEOUT_MS} from '../../app/lib/config';
import {setServices} from '../../app/lib/services';
import {chromiumExecutable} from './standalone-browser';

export async function createTeamApplication(env:NodeJS.ProcessEnv,assets:string):Promise<AppHost>{
 const origin=readEnv(env,'APP__PUBLIC_BASE_URL'),secret=readEnv(env,'AUTH__SECRET');
 if(!origin||!secret)throw new Error('Team hosting requires APP__PUBLIC_BASE_URL and AUTH__SECRET.');
 let host:AppHost,identity:Parameters<typeof createAuthHost>[0];
 let reader:ReturnType<typeof createTokenReader>;
 const browser=createBrowser({executablePath:chromiumExecutable,sessions:{browserExecutable:chromiumExecutable,...(isSea()?{workerArgs:['--internal-browser-worker']}:{}),...sessionProcessPaths(env),baseURL:origin,request:async(request,actor)=>host.request(request,actor)}});
 try{
 host=await createAppHost({webDir:join(assets,'dist/web'),publicDir:join(assets,'public'),
  services:{sql:createSql({maxRows:MAX_QUERY_ROWS,timeoutMs:QUERY_TIMEOUT_MS}),browser},shutdown:()=>browser.close(),
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
   reader=createTokenReader({db:queryable,ttlMs:5000,...(appSchema?{schema:appSchema}:{})});
   // createAppHost supplies the real upstream after initialization; no HTTP hop or signed-header bypass.
   identity={upstream:async()=>{throw new Error('Team host is not initialized.');},env,tokens:reader,sessions:sessionStoreOf(human),cookieSecret:secret,
    secure:origin.startsWith('https:'),identityDb:queryable,appSchema,events};
  },identity:upstream=>{const composed=createAuthHost({...identity,upstream});return {fetch:request=>Promise.resolve(composed.fetch(request))};},
 });
 return host;
 }catch(error){await browser.close();throw error;}
}
