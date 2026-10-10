import {describe,it,expect} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as start} from '@/app/api/start/route';
import {POST as browserCreate} from '@/app/api/my/artifacts/route';
import {POST as apiCreate} from '@/app/api/artifacts/route';
import {POST as browserSession} from '@/app/api/browser-sessions/route';
import {POST as internalMint} from '@/app/api/internal/tokens/route';
import {POST as confirmSetup} from '@/app/api/deployment/setup/route';
import {createUser,mintToken} from '@/lib/accounts';
import {overrideSession} from '@/lib/accounts/session';
import {overrideConfig} from '@/lib/platform/config';
import {admitDeploymentIdentity,setupDeployment} from '@/lib/deployment';
import {createGroup} from '@/lib/groups';
import {getDb} from '@/lib/platform/db';
useAppHarness();
const company=()=>overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'mxmx_test_company_owner@example.com'});
describe('company creation admission',()=>{
 it('lets the designated browser owner confirm setup without a CLI token and preserves CSRF protection',async()=>{
  company();const owner=await createUser({email:'mxmx_test_company_owner@example.com'});
  await admitDeploymentIdentity({userId:owner.id,email:owner.email!,emailVerified:true});
  const group=await createGroup(owner.id,{handle:'company-test',name:'Company'});
  const actor={credential:'session' as const,userId:owner.id,email:owner.email!,emailVerified:true};
  const body={group_id:group.id};
  expect((await confirmSetup(request('/api/deployment/setup',{method:'POST',actor,origin:'https://stranger.example',json:body}))).status).toBe(403);
  const response=await confirmSetup(request('/api/deployment/setup',{method:'POST',actor,origin:'same',json:body}));
  expect(response.status).toBe(200);expect((await response.json()).setup_complete).toBe(true);
 });
 it('refuses anonymous, legacy unclaimed bearer, and unadmitted verified browser creation before and after confirmation without issuing credentials',async()=>{
  company();
  const owner=await createUser({email:'mxmx_test_company_owner@example.com'});
  const visitor=await createUser({email:'mxmx_test_company_visitor@example.com'});
  const legacy=await mintToken('legacy-anonymous',null);
  const visitorToken=await mintToken('existing-visitor',visitor.id);
  const db=await getDb();
  const actor={credential:'session' as const,userId:visitor.id,email:visitor.email!,emailVerified:true};
  const check=async()=>{
   const before=(await db.query<{artifacts:number;tokens:number;owners:number}>("SELECT (SELECT count(*)::int FROM artifacts) artifacts,(SELECT count(*)::int FROM tokens) tokens,(SELECT count(*)::int FROM deployment_state WHERE owner_user_id IS NOT NULL) owners")).rows[0];
   for(const handler of [start,browserCreate,apiCreate,browserSession,internalMint]){
    for(const opts of [{},{token:legacy.token},{token:visitorToken.token},{actor}]){
     const response=await handler(request('/api/creation',{method:'POST',json:{markup:'<h1>Unauthorized</h1>',op:'create'},...opts}));
     expect(response.status).toBeGreaterThanOrEqual(400);
     expect(response.headers.get('set-cookie')).toBeNull();
     const result=await response.json();expect(result).not.toHaveProperty('token');expect(result).not.toHaveProperty('access_token');
    }
   }
   const after=(await db.query("SELECT (SELECT count(*)::int FROM artifacts) artifacts,(SELECT count(*)::int FROM tokens) tokens,(SELECT count(*)::int FROM deployment_state WHERE owner_user_id IS NOT NULL) owners")).rows[0];
   expect(after).toEqual(before);
  };
  await check();
  await admitDeploymentIdentity({userId:owner.id,email:owner.email!,emailVerified:true});
  const group=await createGroup(owner.id,{handle:'company-test',name:'Company'});await setupDeployment(owner.id,group.id);
  await check();
 });
 it('refuses start auth fallback for an account that has never been admitted',async()=>{
  company();const visitor=await createUser({email:'mxmx_test_company_fallback@example.com'});
  overrideSession(()=>({user:{id:visitor.id,email:visitor.email!}}));
  try{expect((await start(request('/api/start',{method:'POST'}))).status).toBe(401);}finally{overrideSession(undefined);}
  expect((await (await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([]);
 });
});
