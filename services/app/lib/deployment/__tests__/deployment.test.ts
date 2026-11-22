import {describe,it,expect} from 'vitest';
import {trustedSignIn} from '@artifactbin/auth/identity-store/trusted-sign-in';
import {backfillTrustedRoot} from '@artifactbin/auth/identity-store/trusted-root-backfill';
import {getGroupDetail} from '@/lib/groups';
import {identityForUser} from '@/lib/accounts';
import {syncIdentitySettings} from '@/lib/platform';
import {effectiveRole} from '@/lib/artifact-access';
import {setArtifactGroupShare} from '@/lib/artifacts';
import {account,head,mine} from '@/__tests__/artifact-fixtures';
import {bearerIdentity,useAppHarness} from '@/__tests__/harness';
import {getDb,type Queryable} from '@/lib/platform/db';
import {overrideConfig,serviceAudiences} from '@/lib/platform/config';
import {canUseDeploymentIdentity} from '@/lib/accounts';
import {DeploymentError,admitDeploymentIdentity,getDeploymentDefaultDestination,getDeploymentState,setupDeployment,validateDeploymentConfiguration} from '..';
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
 it('requires explicit live Admin group and preserves admitted members after default deletion',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'false'});
  await admitDeploymentIdentity(identity('owner','owner@example.com'));
  await expect(getDeploymentDefaultDestination()).rejects.toThrow('Default group unavailable');
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('group','team','Team','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('group','owner','admin')");
  await expect(setupDeployment('visitor','group')).rejects.toThrow();
  await db.query("UPDATE group_members SET role='member' WHERE group_id='group' AND user_id='owner'");
  await expect(setupDeployment('owner','group')).rejects.toThrow('Admin membership');
  await db.query("UPDATE group_members SET role='admin' WHERE group_id='group' AND user_id='owner'");
  await db.query("INSERT INTO groups(id,handle,name,created_by,parent_id) VALUES ('child','subteam','Subteam','owner','group')");
  await expect(setupDeployment('owner','child')).rejects.toMatchObject({code:'default_group_unavailable'});
  await setupDeployment('owner','group');
  expect(await getDeploymentDefaultDestination()).toEqual({type:'group',id:'group'});
  expect(await admitDeploymentIdentity(identity('member','member@example.com'))).toBe(true);
  expect((await db.query("SELECT role FROM group_members WHERE user_id='member'")).rows[0]).toEqual({role:'member'});
  await db.query("UPDATE groups SET deleted_at=now() WHERE id='group'");
  expect(await admitDeploymentIdentity({userId:'member'})).toBe(true);
  expect(await canUseDeploymentIdentity('member')).toBe(true);
  await expect(getDeploymentDefaultDestination()).rejects.toThrow('Default group unavailable');
  expect(await canUseDeploymentIdentity('next')).toBe(false);
  expect(await admitDeploymentIdentity(identity('next','next@example.com'))).toBe(false);
 });
 it('admits the verified issuer independently of email patterns after setup',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'true',AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
  const tenant={userId:'tenant',email:'user_t1@parent.trusted-issuer.invalid',emailVerified:true};
  expect(await admitDeploymentIdentity({...tenant,trustedIssuer:'parent'})).toBe(false);
  await admitDeploymentIdentity(identity('owner','owner@example.com'));
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('group','team','Team','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('group','owner','admin')");
  await setupDeployment('owner','group');
  expect(await admitDeploymentIdentity(tenant)).toBe(false);
  expect(await admitDeploymentIdentity({...tenant,trustedIssuer:'parent'})).toBe(true);
  expect(await admitDeploymentIdentity({userId:'tenant'})).toBe(true);
 });
 it('joins verified host identities to the root and backfills only provable prior admissions',async()=>{
  const owner=await account('mxmx_test_owner@example.com');
  const page=await mine(owner,'Root page',{visibility:'private',destination:{type:'personal'}});
  const siblingPage=await mine(owner,'Sibling page',{visibility:'private',destination:{type:'personal'}});
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:owner.email!,AUTH__INVITE_ONLY:'true'});
  const db=await getDb();
  await bearerIdentity();
  await syncIdentitySettings(db);
  await admitDeploymentIdentity(identity(owner.userId,owner.email!));
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('root','org_root','Organization',$1),('other','other_root','Other',$1)",[owner.userId]);
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('root',$1,'admin'),('other',$1,'admin')",[owner.userId]);
  await setupDeployment(owner.userId,'root');
  await setArtifactGroupShare(owner,page.id,'root','viewer');
  await db.query("INSERT INTO groups(id,handle,name,created_by,parent_id) VALUES ('sibling','sibling_team','Sibling',$1,'other')",[owner.userId]);
  await setArtifactGroupShare(owner,siblingPage.id,'sibling','viewer');
  const sign=async(subject:string)=>{
   const result=await trustedSignIn(db,{issuer:'host',joinCompanyRoot:true,subject,email:subject+'@host.invalid',group:'host_team',parentGroup:'other_root',tenancyId:'tenant'},
    'auth',undefined,(person,tx)=>admitDeploymentIdentity({...person,emailVerified:true,trustedIssuer:'host'},tx));
   if(!result.ok)throw new Error(result.refusal);
   return result;
  };
  const creator=await sign('creator@example.com'),handle=await sign('reader_handle'),email=await sign('reader@example.com');
  const members=async()=> (await db.query<{user_id:string}>("SELECT user_id FROM group_members WHERE group_id='root' AND role='member'")).rows.map(m=>m.user_id).sort();
  expect(await members()).toEqual([creator.userId,handle.userId,email.userId].sort());
  const directory=await getGroupDetail(email.userId,'root');
  expect(directory?.members.map(m=>m.user_id)).toEqual([owner.userId]);
  expect(directory?.subgroups).toEqual([]);
  const actor=identityForUser(email.userId);
  expect(await effectiveRole(await head(page.id),actor)).toBe('viewer');
  expect(await effectiveRole(await head(siblingPage.id),actor)).toBe('none');
  // Pre-upgrade rows: verified people have their host-selected membership but no root grant.
  await db.query("DELETE FROM group_members WHERE group_id='root' AND role='member'");
  const manual=await account('mxmx_test_invited@example.com');
  await db.query("INSERT INTO deployment_members(user_id) VALUES ($1)",[manual.userId]);
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ($1,$2,'member')",[creator.groupId,manual.userId]);
  const backfill=()=>backfillTrustedRoot(db,'auth','public');
  expect(await backfill()).toBe(2);
  expect(await backfill()).toBe(0);
  expect(await members()).toEqual([creator.userId,handle.userId].sort());
  // An older handler could commit an issuer group before refusing admission. Later manual admission
  // cannot retroactively prove that sign-in succeeded.
  await db.query("UPDATE deployment_members SET admitted_at=admitted_at+interval '1 day' WHERE user_id=$1",[creator.userId]);
  await db.query("DELETE FROM group_members WHERE group_id='root' AND user_id=$1",[creator.userId]);
  expect(await backfill()).toBe(0);
  await sign('creator@example.com');
  await sign('reader@example.com');
  expect(await members()).toEqual([creator.userId,handle.userId,email.userId].sort());
 });
 it('invitation and pattern checks compose, preserve roles and refuse unrelated invitations',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'true',AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
  await admitDeploymentIdentity(identity('owner','owner@example.com'));
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('default','default','Default','owner'),('other','other','Other','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('default','owner','admin')");
  await setupDeployment('owner','default');
  await db.query("INSERT INTO group_invitations(id,group_id,email,role,invited_by) VALUES ('invite','default','editor@example.com','admin','owner'),('outside','default','outside@other.com','admin','owner'),('elsewhere','other','elsewhere@example.com','admin','owner')");
  expect(await admitDeploymentIdentity(identity('editor','editor@example.com'))).toBe(true);
  expect((await db.query("SELECT role FROM group_members WHERE user_id='editor'")).rows).toEqual([{role:'admin'}]);
  expect((await db.query("SELECT id FROM group_invitations WHERE id='invite'")).rows).toEqual([]);
  expect(await admitDeploymentIdentity(identity('outsider','outside@other.com'))).toBe(false);
  expect(await admitDeploymentIdentity(identity('elsewhere','elsewhere@example.com'))).toBe(false);
 });
 it('reads the live default group in setup and admission without locking it (identity rows are never locked by the app)',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'false'});
  await admitDeploymentIdentity(identity('owner','owner@example.com'));
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('locked','locked','Locked','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('locked','owner','admin')");
  const transaction=db.transaction.bind(db),reads:string[]=[];
  db.transaction=async<T>(fn:(tx:Queryable)=>Promise<T>):Promise<T>=>transaction(tx=>fn({query:async<R>(sql:string,params?:unknown[])=>{
   if(sql.includes('FROM groups g'))reads.push(sql);
   return tx.query<R>(sql,params);
  }}));
  try{await setupDeployment('owner','locked');expect(await admitDeploymentIdentity(identity('member','member@example.com'))).toBe(true);}
  finally{db.transaction=transaction;}
  expect(reads).toHaveLength(2);for(const sql of reads)expect(sql).not.toMatch(/FOR (UPDATE|SHARE)/);
  expect(await getDb().then(db=>db.query("SELECT role FROM group_members WHERE group_id='locked' AND user_id='member'"))).toMatchObject({rows:[{role:'member'}]});
 });
 it('serializes competing owner binds and never gives a changed email the owner ID',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com'});
  const admitted=await Promise.all(['first','second'].map(id=>admitDeploymentIdentity(identity(id,'owner@example.com'))));
  expect(admitted.filter(Boolean)).toHaveLength(1);
  const owner=admitted[0]?'first':'second';
  expect((await getDeploymentState(owner)).is_owner).toBe(true);
  expect((await getDeploymentState(owner==='first'?'second':'first')).is_owner).toBe(false);
 });
 it('decides from plain reads, with no transaction and no lock, whenever the answer is already determined',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__INVITE_ONLY:'false',AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
  expect(await admitDeploymentIdentity(identity('owner','owner@example.com'))).toBe(true);
  const db=await getDb();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('team','team','Team','owner')");
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES ('team','owner','admin')");
  await setupDeployment('owner','team');
  expect(await admitDeploymentIdentity(identity('member','member@example.com'))).toBe(true);
  const transaction=db.transaction.bind(db),query=db.query.bind(db),sql:string[]=[];let transactions=0;
  db.transaction=async<T>(fn:(tx:Queryable)=>Promise<T>):Promise<T>=>{transactions++;return transaction(tx=>fn({query:async<R>(text:string,params?:unknown[])=>{sql.push(text);return tx.query<R>(text,params);}}));};
  db.query=async<R>(text:string,params?:unknown[])=>{sql.push(text);return query<R>(text,params);};
  try{
   expect(await admitDeploymentIdentity(identity('member','member@example.com'))).toBe(true);
   expect(await admitDeploymentIdentity(identity('owner','owner@example.com'))).toBe(true);
   expect(await admitDeploymentIdentity({userId:'member'})).toBe(true);
   expect(await admitDeploymentIdentity({userId:'stranger',email:'stranger@example.com',emailVerified:false})).toBe(false);
   expect(await admitDeploymentIdentity(identity('outside','outside@elsewhere.com'))).toBe(false);
  }finally{db.transaction=transaction;db.query=query;}
  expect(transactions).toBe(0);
  expect(sql.filter(text=>/FOR UPDATE/i.test(text))).toEqual([]);
  expect(sql.filter(text=>/^\s*(INSERT|UPDATE|DELETE)/i.test(text))).toEqual([]);
  // The write path is unchanged: a new, eligible, verified person is still admitted under the lock.
  expect(await admitDeploymentIdentity(identity('newcomer','newcomer@example.com'))).toBe(true);
  expect((await db.query("SELECT role FROM group_members WHERE group_id='team' AND user_id='newcomer'")).rows).toEqual([{role:'member'}]);
 });
 it('public mode remains open',async()=>{overrideConfig({}, {APP__DEPLOYMENT_MODE:'public'});expect(await admitDeploymentIdentity(identity('any','any@example.com'))).toBe(true);});
});

describe('deployment configuration and public mode',()=>{
 it('refuses a company owner email the admission patterns would never admit',()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__ALLOWED_EMAIL_PATTERNS:'*@other.com'});
  expect(()=>validateDeploymentConfiguration()).toThrow('APP__DEPLOYMENT_OWNER_EMAIL must match AUTH__ALLOWED_EMAIL_PATTERNS.');
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com',AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
  expect(()=>validateDeploymentConfiguration()).not.toThrow();
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'public',AUTH__ALLOWED_EMAIL_PATTERNS:'*@other.com'});
  expect(()=>validateDeploymentConfiguration()).not.toThrow();
 });
 it('a public deployment is set up, has no default group, admits every identity and refuses company setup',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'public'});
  expect(await getDeploymentState('anyone')).toEqual({mode:'public',setup_complete:true,is_owner:false,default_group:null});
  expect(await getDeploymentDefaultDestination()).toBeUndefined();
  expect(await canUseDeploymentIdentity(null)).toBe(true);
  const refusal=await setupDeployment('owner','group').catch(error=>error);
  expect(refusal).toBeInstanceOf(DeploymentError);expect(refusal).toMatchObject({code:'company_required',status:400,message:'Company deployment required'});
 });
 it('a company deployment never admits a missing or unknown credential',async()=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com'});
  for(const id of [null,undefined,'','nobody'])expect(await canUseDeploymentIdentity(id)).toBe(false);
  expect(await getDeploymentState(null)).toMatchObject({mode:'company',setup_complete:false,is_owner:false,default_group:null});
 });
});

describe('service audiences at boot',()=>{
 const unset={APP__DEPLOYMENT_MODE:'public',AUTH__ALLOWED_EMAIL_PATTERNS:undefined,IDENTITY__SERVICE_AUDIENCES:undefined};
 const hash='a'.repeat(64);
 it('none set: no service',()=>{
  overrideConfig({},unset);
  expect(()=>validateDeploymentConfiguration()).not.toThrow();
  expect(serviceAudiences()).toEqual([]);
 });
 it('a complete set boots and normalizes origins',()=>{
  overrideConfig({},{...unset,IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'warehouse',origin:'https://Data.Example.com/',introspection_secret_sha256:hash}])});
  expect(()=>validateDeploymentConfiguration()).not.toThrow();
  expect(serviceAudiences()).toEqual([{id:'warehouse',origin:'https://data.example.com',introspectionSecretSha256:hash}]);
 });
 it('a malformed value refuses the boot by name',()=>{
  for(const [bad,message] of [
   [{IDENTITY__SERVICE_AUDIENCES:'{}'},/IDENTITY__SERVICE_AUDIENCES must be a JSON array/],
   [{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'Warehouse',origin:'https://a.example'}])},/IDENTITY__SERVICE_AUDIENCES/],
   [{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'w',origin:'http://a.example'}])},/IDENTITY__SERVICE_AUDIENCES/],
   [{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'w',origin:'https://a.example/path'}])},/IDENTITY__SERVICE_AUDIENCES/],
   [{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'w',origin:'https://a.example',introspection_secret_sha256:'secret'}])},/IDENTITY__SERVICE_AUDIENCES/],
   [{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'w',origin:'https://a.example'},{id:'w',origin:'https://b.example'}])},/repeats/],
  ] as const){
   overrideConfig({},{...unset,...bad});
   expect(()=>validateDeploymentConfiguration(),JSON.stringify(bad).slice(0,80)).toThrow(message);
  }
 });
});
