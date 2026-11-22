/** Sign-in and the app audit worker, mounted as in the single-process server. */
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {tenancyIssuer} from '@/test/helpers/trusted-tenancy';
import {AUTH_SECRET,getDb} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';

useAppHarness();
it('records the verified issuer and the person signed in for the change',async()=>{
 const issuer=tenancyIssuer();
 overrideConfig({},{APP__DEPLOYMENT_MODE:'public'});
 const app=await createAuthComposedHost({APP__PUBLIC_BASE_URL:'http://localhost:3000',AUTH__SECRET:AUTH_SECRET,...issuer.env});
 try {
  expect((await app.fetch(issuer.request('first','creator'))).status).toBe(303);
  expect((await app.fetch(issuer.request('second','reader'))).status).toBe(303);
  const db=await getDb();
  const person=(await db.query<{id:string}>("SELECT id FROM users WHERE username='reader'")).rows[0]!;
  await expect.poll(async()=>(await db.query(`SELECT a.actor_user_id,a.action,a.details,a.actor_token_id,a.client_harness
    FROM group_audit a JOIN groups g ON g.id=a.group_id WHERE g.handle='host_team'`)).rows)
   .toEqual([{actor_user_id:null,action:'host_tenancy_changed',actor_token_id:null,client_harness:null,
    details:{sign_in_user_id:person.id,trusted_issuer:'audit-host',previous:{tenancy_id:'first'},next:{tenancy_id:'second'}}}]);
 } finally {await app.close();}
});
