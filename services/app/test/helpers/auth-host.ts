/**
 * The app host behind the real login service, composed the way server.ts composes it: email OTP
 * through a dev outbox, the auth boundary's token reader and the app's own authorization. Tests
 * that drive a login end to end call `fetch` on it and `close` when done.
 */
import {join} from 'node:path';
import {createTokenReader} from '@artifactbin/utils';
import {createAuthHost,createHumanAuth,ensureAuthSchema,loginProvidersOf,mailerForRuntime,mailSettingsOf,readEnv,sessionStoreOf} from '@artifactbin/auth';
import {createEvents,ensureEventsSchema} from '@artifactbin/events/local';
import {canAuthenticateUser} from '@/lib/accounts';
import {admitDeploymentIdentity,validateDeploymentConfiguration} from '@/lib/deployment';
import { EVENTS_SCHEMA, setServices } from '@/lib/platform';
import {createAppHost} from '@/server/host';

export async function createAuthComposedHost(env:NodeJS.ProcessEnv,assets=process.cwd()){
 const origin=readEnv(env,'APP__PUBLIC_BASE_URL'),secret=readEnv(env,'AUTH__SECRET');
 if(!origin||!secret)throw new Error('The composed host needs APP__PUBLIC_BASE_URL and AUTH__SECRET.');
 let identity:Parameters<typeof createAuthHost>[0];
 let reader:ReturnType<typeof createTokenReader>;
 return createAppHost({webDir:join(assets,'dist/web'),publicDir:join(assets,'public'),
  onTokenRevoked:id=>reader.invalidate(id),
  initialize:async db=>{
   const queryable={query:async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>db.query<T>(text,params)};
   await ensureEventsSchema(queryable,EVENTS_SCHEMA);
   const events=createEvents({db:queryable,schema:EVENTS_SCHEMA});setServices({events});
   const authSchema=readEnv(env,'AUTH__SCHEMA')??'auth',appSchema=readEnv(env,'APP__SCHEMA');
   await ensureAuthSchema(queryable,authSchema);
   validateDeploymentConfiguration();
   const raw=db.raw();
   const human=await createHumanAuth({secret,baseURL:origin,schema:authSchema,secure:origin.startsWith('https:'),events,...loginProvidersOf(env),
    ...(raw.kind==='pglite'?{pglite:raw.instance}:{pool:raw.pool as import('pg').Pool}),
    mail:mailerForRuntime({...mailSettingsOf(env),publicBaseUrl:origin,devOutboxPath:readEnv(env,'EMAIL__DEV_OUTBOX_PATH')})});
   reader=createTokenReader({db:queryable,ttlMs:5000,admitBearer:token=>canAuthenticateUser(token.userId),...(appSchema?{schema:appSchema}:{})});
   identity={upstream:async()=>{throw new Error('The composed host is not initialized.');},env,tokens:reader,sessions:sessionStoreOf(human),admitIdentity:admitDeploymentIdentity,cookieSecret:secret,
    secure:origin.startsWith('https:'),identityDb:queryable,appSchema,events};
  },
  identity:upstream=>{const composed=createAuthHost({...identity,upstream});return {fetch:request=>Promise.resolve(composed.fetch(request))};},
 });
}
