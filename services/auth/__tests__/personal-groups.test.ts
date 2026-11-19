/**
 * THE PERSONAL GROUP (src/identity-store/personal.ts): every person is the only Admin of one group of their own,
 * written with the person and, for people from before it, by the identity boot. No reader sees it: every identity
 * view answers exactly the rows it answered without it, and every group writer refuses it as missing.
 */
import {PGlite} from '@electric-sql/pglite';
import {afterEach,describe,expect,it} from 'vitest';
import {IDENTITY_VIEWS,IdentityError,type IdentityService,type Queryable,type TransactionalQueryable} from '@artifactbin/contracts';
import {createIdentityStore,ensureIdentitySchema} from '../src/identity-store';
import {mintGroupSignIn} from '../src/identity-store/accounts';
import {personalGroupId} from '../src/identity-store/personal';
import {identityTables} from '../src/identity-store/tables';

const schemas={auth:'auth',app:'public',read:'identity'};
const t=identityTables('auth');
let pg:PGlite|null=null;
afterEach(async()=>{await pg?.close();pg=null;});

async function boot():Promise<{pg:PGlite;db:TransactionalQueryable;store:IdentityService}>{
 pg=new PGlite();
 const db={query:pg.query.bind(pg),transaction:<T,>(fn:(tx:Queryable)=>Promise<T>)=>pg!.transaction(tx=>fn(tx as unknown as Queryable))} as unknown as TransactionalQueryable;
 await pg.exec(`CREATE TABLE deployment_members (user_id TEXT PRIMARY KEY);
  CREATE TABLE deployment_state (id TEXT PRIMARY KEY, setup_complete BOOLEAN NOT NULL DEFAULT false);
  CREATE TABLE identity_settings (id TEXT PRIMARY KEY, deployment_mode TEXT NOT NULL DEFAULT 'public', api_audiences TEXT[] NOT NULL DEFAULT '{}', service_audiences TEXT[] NOT NULL DEFAULT '{}');
  INSERT INTO identity_settings (id, api_audiences) VALUES ('installation', '{https://api.test}');`);
 await ensureIdentitySchema(db,schemas);
 return {pg,db,store:createIdentityStore({db,authSchema:'auth'})};
}
/** Every identity view's every row, as JSON text, in a stable order: what any reader can see (no `sessions` without Better Auth's table). */
const everyView=async(pg:PGlite)=>Object.fromEntries(await Promise.all(Object.keys(IDENTITY_VIEWS).filter(view=>view!=='sessions').map(async view=>
 [view,(await pg.query<{row:string}>(`SELECT row_to_json(v)::text AS row FROM identity.${view} v ORDER BY 1`)).rows.map(row=>row.row)] as const)));
const personal=async(pg:PGlite)=>({
 groups:(await pg.query<{id:string}>(`SELECT id,handle,name,created_by,parent_id,deleted_at FROM auth.groups WHERE starts_with(id,'pgr_') ORDER BY id`)).rows,
 members:(await pg.query(`SELECT group_id,user_id,role FROM auth.group_members WHERE starts_with(group_id,'pgr_') ORDER BY group_id,user_id`)).rows,
});
const refused=async(call:Promise<unknown>,code:string)=>{
 const error=await call.then(()=>null,(e:unknown)=>e);
 expect(error).toBeInstanceOf(IdentityError);
 expect((error as IdentityError).code).toBe(code);
};

describe('the personal group',()=>{
 it('comes with every person, however written, and no reader sees it',async()=>{
  const {pg,store}=await boot();
  const before=await everyView(pg);
  expect(before.groups).toEqual([]);
  await store.syncProfile({userId:'usr_ann',email:'ann@example.test',testAccount:false});
  const bob=await store.createUser({email:'bob@example.test'});
  const test=(await store.createTestUser({parentId:'usr_ann',label:'t',ttlMs:3_600_000,limit:5,tokenName:'t'}))!;
  // Sign-in again: nothing more.
  await store.syncProfile({userId:'usr_ann',email:'ann@example.test',testAccount:false});
  const people=['usr_ann',bob.id,test.id].sort();
  expect(await personal(pg)).toEqual({
   groups:people.map(id=>({id:personalGroupId(id),handle:`~${id}`,name:'',created_by:id,parent_id:null,deleted_at:null})),
   members:people.map(id=>({group_id:personalGroupId(id),user_id:id,role:'admin'})),
  });
  const after=await everyView(pg);
  expect(after.groups).toEqual([]);
  expect(after.group_members).toEqual([]);
  expect(after.group_admins).toEqual([]);
  expect(after.group_mail_outbox).toEqual([]);
  expect(after.group_hierarchy).toEqual(before.group_hierarchy);
  expect(after.handle_reservations.every(row=>JSON.parse(row).kind==='user')).toBe(true);
  // Erasing a test user takes their personal group with them.
  expect(await store.eraseTestUser({userId:test.id})).toBe(true);
  expect((await personal(pg)).groups.map(row=>row.id)).toEqual(['usr_ann',bob.id].sort().map(personalGroupId));
 });

 it('is given to everyone from before it by the boot, once, and leaves every view exactly as it was',async()=>{
  const {pg,db,store}=await boot();
  // People and a group as a process from before personal groups wrote them: no personal group anywhere.
  await pg.exec(`INSERT INTO auth.users (id,email) VALUES ('usr_old1','old1@example.test'),('usr_old2','old2@example.test');
   INSERT INTO auth.users (id,email,kind) VALUES ('usr_guest',NULL,'guest');`);
  await store.createGroup({actorId:'usr_old1',handle:'old_team',name:'Old'});
  await pg.exec(`DELETE FROM auth.group_members WHERE starts_with(group_id,'pgr_'); DELETE FROM auth.groups WHERE starts_with(id,'pgr_')`);
  const team=(await pg.query<{id:string}>(`SELECT id FROM auth.groups WHERE handle='old_team'`)).rows[0]!.id;
  await pg.query(`INSERT INTO auth.group_members (group_id,user_id,role) VALUES ($1,'usr_old2','member')`,[team]);
  expect(await personal(pg)).toEqual({groups:[],members:[]});
  const before=await everyView(pg);
  expect(before.groups).toHaveLength(1);
  expect(before.group_members).toHaveLength(2);
  expect(before.group_admins).toHaveLength(1);
  await ensureIdentitySchema(db,schemas);
  const migrated=await personal(pg);
  expect(migrated.groups.map(row=>row.id)).toEqual(['usr_guest','usr_old1','usr_old2'].map(personalGroupId));
  expect(migrated.members).toEqual(['usr_guest','usr_old1','usr_old2'].map(id=>({group_id:personalGroupId(id),user_id:id,role:'admin'})));
  expect(await everyView(pg)).toEqual(before);
  // A repeat changes nothing; a missing Admin row alone is put back.
  await ensureIdentitySchema(db,schemas);
  expect(await personal(pg)).toEqual(migrated);
  await pg.query('DELETE FROM auth.group_members WHERE group_id=$1',[personalGroupId('usr_old2')]);
  await ensureIdentitySchema(db,schemas);
  expect(await personal(pg)).toEqual(migrated);
  expect(await everyView(pg)).toEqual(before);
 });

 it('is refused as a group that does not exist by every group change and every sign-in, even to its own Admin',async()=>{
  const {pg,store}=await boot();
  await store.syncProfile({userId:'usr_ann',email:'ann@example.test',testAccount:false});
  await store.syncProfile({userId:'usr_bob',email:'bob@example.test',testAccount:false});
  const own=personalGroupId('usr_ann');
  const team=(await store.createGroup({actorId:'usr_ann',handle:'ann_team',name:'Team'})).group.id;
  await refused(store.inviteGroupMember({actorId:'usr_ann',groupId:own,email:'bob@example.test',role:'member'}),'not_found');
  await refused(store.setGroupMember({actorId:'usr_ann',groupId:own,userId:'usr_ann',role:'member'}),'not_found');
  await refused(store.removeGroupMember({actorId:'usr_ann',groupId:own,userId:'usr_ann'}),'not_found');
  await refused(store.updateGroup({actorId:'usr_ann',groupId:own,name:'Mine'}),'not_found');
  await refused(store.deleteGroup({actorId:'usr_ann',groupId:own,handle:'~usr_ann'}),'not_found');
  await refused(store.createGroup({actorId:'usr_ann',handle:'ann_sub',name:'Sub',parentId:own}),'parent_not_found');
  await refused(store.setGroupParent({actorId:'usr_ann',groupId:team,parentId:own}),'parent_not_found');
  await refused(store.setGroupParent({actorId:'usr_ann',groupId:own,parentId:team}),'not_found');
  await refused(store.approveServiceGroupSignIn({actorId:'usr_ann',groupId:own,serviceId:'svc',serviceOrigin:'https://svc.test',role:'member'}),'not_found');
  await refused(store.revokeGroupSignIn({actorId:'usr_ann',groupId:own,id:'tok_x'}),'not_found');
  expect(await store.admitToGroup({userId:'usr_bob',email:'bob@example.test',groupId:own,inviteOnly:false})).toEqual({admitted:false,changes:[]});
  for(const role of ['member','editor'] as const)
   await refused(mintGroupSignIn(t,pg as unknown as Queryable,'identity',{issuedBy:'usr_ann',groupId:own,role,expiresInMs:3_600_000,audience:'https://api.test',scope:''}),'group_level_not_held');
  // The ordinary group beside it works as it always did.
  await mintGroupSignIn(t,pg as unknown as Queryable,'identity',{issuedBy:'usr_ann',groupId:team,role:'editor',expiresInMs:3_600_000,audience:'https://api.test',scope:''});
  expect(await personal(pg)).toEqual({
   groups:['usr_ann','usr_bob'].map(id=>({id:personalGroupId(id),handle:`~${id}`,name:'',created_by:id,parent_id:null,deleted_at:null})),
   members:['usr_ann','usr_bob'].map(id=>({group_id:personalGroupId(id),user_id:id,role:'admin'})),
  });
  expect((await pg.query(`SELECT 1 FROM auth.tokens WHERE starts_with(group_id,'pgr_')`)).rows).toEqual([]);
 });
});
