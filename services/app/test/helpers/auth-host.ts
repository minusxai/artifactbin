/**
 * The app host behind the real login service, composed as server.ts composes it (server/local-authentication):
 * email OTP through a dev outbox (or the test-domain code, TEST_DOMAIN / TEST_DOMAIN_OTP), the auth boundary's
 * bearer reader and the app's own authorization. Tests that drive a login end to end call `fetch` on it and `close`
 * when done.
 */
import {join} from 'node:path';
import {readEnv} from '@artifactbin/auth';
import {assemble} from '@artifactbin/utils';
import {createEvents,ensureEventsSchema} from '@artifactbin/events/local';
import type {Part,Upstream} from '@artifactbin/contracts/part';
import { EVENTS_SCHEMA, setServices } from '@/lib/platform';
import {createAppHost} from '@/server/host';
import {localAuthentication} from '@/server/local-authentication';

export async function createAuthComposedHost(env:NodeJS.ProcessEnv,assets=process.cwd()){
 const origin=readEnv(env,'APP__PUBLIC_BASE_URL');
 if(!origin||!readEnv(env,'AUTH__SECRET'))throw new Error('The composed host needs APP__PUBLIC_BASE_URL and AUTH__SECRET.');
 let admission:(upstream:Upstream)=>Part[]=()=>{throw new Error('The composed host is not initialized.');};
 return createAppHost({webDir:join(assets,'dist/web'),publicDir:join(assets,'public'),
  initialize:async db=>{
   const queryable={query:async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>db.query<T>(text,params)};
   await ensureEventsSchema(queryable,EVENTS_SCHEMA);
   const events=createEvents({db:queryable,schema:EVENTS_SCHEMA});setServices({events});
   admission=await localAuthentication({env,db,baseURL:origin,events,login:true});
  },
  identity:upstream=>{const composed=assemble(admission(upstream));return {fetch:request=>Promise.resolve(composed.fetch(request))};},
 });
}
