import {describe,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '../platform/db';
import {overrideConfig} from '../platform/config';
import {admitDeploymentIdentity,canUseDeploymentIdentity,getDeploymentState,setupDeployment} from '../deployment';
useAppHarness();
const identity=(userId:string,email:string)=>({userId,email,emailVerified:true});
describe('company admission',()=>{
 it('binds only designated verified owner, survives config changes and refuses visitors before confirmation',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com'});
  expect(await admitDeploymentIdentity(identity('visitor','other@example.com'))).toBe(false);
  expect(await admitDeploymentIdentity({...identity('owner','owner@example.com'),emailVerified:false})).toBe(false);
  expect(await admitDeploymentIdentity(identity('owner','owner@example.com'))).toBe(true);
  overrideConfig({}, {APP__DEPLOYMENT_OWNER_EMAIL:'other@example.com'});
  expect(await admitDeploymentIdentity(identity('visitor','other@example.com'))).toBe(false);
  expect((await getDeploymentState('owner')).is_owner).toBe(true);
 });
 it('requires explicit live editor group and preserves admitted members after default deletion',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'false'});
  await admitDeploymentIdentity(identity('owner','owner@example.com'));
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('group','team','Team','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('group','owner','editor')");
  await expect(setupDeployment('visitor','group')).rejects.toThrow();
  await setupDeployment('owner','group');
  expect(await admitDeploymentIdentity(identity('member','member@example.com'))).toBe(true);
  expect((await db.query("SELECT role FROM group_members WHERE user_id='member'")).rows[0]).toEqual({role:'viewer'});
  await db.query("UPDATE groups SET deleted_at=now() WHERE id='group'");
  expect(await admitDeploymentIdentity({userId:'member'})).toBe(true);
  expect(await canUseDeploymentIdentity('member')).toBe(true);
  expect(await canUseDeploymentIdentity('next')).toBe(false);
  expect(await admitDeploymentIdentity(identity('next','next@example.com'))).toBe(false);
 });
 it('invitation and pattern checks compose, preserve roles and refuse unrelated invitations',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'true',AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
  await admitDeploymentIdentity(identity('owner','owner@example.com'));
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('default','default','Default','owner'),('other','other','Other','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('default','owner','editor')");
  await setupDeployment('owner','default');
  await db.query("INSERT INTO group_invitations(id,group_id,email,role,invited_by) VALUES ('invite','default','editor@example.com','editor','owner'),('outside','default','outside@other.com','editor','owner'),('elsewhere','other','elsewhere@example.com','editor','owner')");
  expect(await admitDeploymentIdentity(identity('editor','editor@example.com'))).toBe(true);
  expect((await db.query("SELECT role FROM group_members WHERE user_id='editor'")).rows).toEqual([{role:'editor'}]);
  expect((await db.query("SELECT id FROM group_invitations WHERE id='invite'")).rows).toEqual([]);
  expect(await admitDeploymentIdentity(identity('outsider','outside@other.com'))).toBe(false);
  expect(await admitDeploymentIdentity(identity('elsewhere','elsewhere@example.com'))).toBe(false);
 });
 it('serializes competing owner binds and never gives a changed email the owner ID',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com'});
  const admitted=await Promise.all(['first','second'].map(id=>admitDeploymentIdentity(identity(id,'owner@example.com'))));
  expect(admitted.filter(Boolean)).toHaveLength(1);
  const owner=admitted[0]?'first':'second';
  expect((await getDeploymentState(owner)).is_owner).toBe(true);
  expect((await getDeploymentState(owner==='first'?'second':'first')).is_owner).toBe(false);
 });
 it('public mode remains open',async()=>{overrideConfig({}, {APP__DEPLOYMENT_MODE:'public'});expect(await admitDeploymentIdentity(identity('any','any@example.com'))).toBe(true);});
});
