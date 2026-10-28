import {describe,it,expect} from 'vitest';
import {useAppHarness} from './harness';
import {overrideConfig} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {gettingStarted} from '@/lib/serving/getting-started';
import {getDeploymentState} from '@/lib/deployment';
useAppHarness();
const company=()=>overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'mxmx_test_owner@example.com'});
async function confirm(){const db=await getDb();await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('grp_company','company-team','Company','owner')");await db.query("INSERT INTO deployment_state(id,owner_user_id,default_group_id,setup_complete) VALUES ('company','owner','grp_company',true)");}
describe('deployment-aware recipient setup',()=>{
 it('completed company setup teaches recipient group preferences through HTTP',async()=>{
  company();await confirm();const text=JSON.stringify(gettingStarted('http://localhost:3000',await getDeploymentState(null)));
  expect(text).toContain('GET /api/groups/company-team');expect(text).toContain('PUT /api/me/preferences');expect(text).not.toContain('grp_company');expect(text).not.toMatch(/afbin |@afbin\/cli/);
 });
 it('incomplete setup does not advertise an unconfirmed group',async()=>{
  company();const text=JSON.stringify(gettingStarted('http://localhost:3000',await getDeploymentState(null)));
  expect(text).toContain('/skills/artifactbin.zip');expect(text).not.toContain('/api/groups/');
 });
});
