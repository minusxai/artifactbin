/**
 * THE ADMIN RULE (src/identity-store/rules.ts `groupAdminsSql`): an admin of a group is an effective admin of every live
 * group below it, through live groups only, with the nearest direct `admin` row as `via_group_id`; Editor and Member
 * never flow down. The identity module's own checks (./group-access `effectiveAdminVia`, `effectiveAdminGroupIds`) and the
 * `group_admins` read view (src/identity-store/views.ts) are the same SQL, asserted here to give the same answers.
 */
import {PGlite} from '@electric-sql/pglite';
import {afterEach,beforeEach,expect,it} from 'vitest';
import type {Queryable} from '@artifactbin/contracts';
import {effectiveAdminGroupIds,effectiveAdminVia} from '../src/identity-store/group-access';
import {identityTables} from '../src/identity-store/tables';
import {identityViewColumns,identityViewStatements} from '../src/identity-store/views';

let pg:PGlite;
let db:Queryable;
const t=identityTables('auth');
beforeEach(async()=>{
 pg=new PGlite();
 db={query:async(sql,params)=>pg.query(sql,params)};
 // Root ⊃ Mid ⊃ Leaf ⊃ Tip, and Other beside them. Ann administers Root, Bob Mid, Lee Leaf; Ed edits and Meg is a member
 // of Root; Bob is also a member of Leaf.
 await pg.exec(`CREATE SCHEMA auth;
 CREATE TABLE auth.groups(id text PRIMARY KEY,parent_id text,deleted_at timestamptz);
 CREATE TABLE auth.group_members(group_id text,user_id text,role text NOT NULL,PRIMARY KEY(group_id,user_id));
 INSERT INTO auth.groups VALUES('root',null,null),('mid','root',null),('leaf','mid',null),('tip','leaf',null),('other',null,null);
 INSERT INTO auth.group_members VALUES('root','ann','admin'),('root','ed','editor'),('root','meg','member'),('mid','bob','admin'),('leaf','lee','admin'),('leaf','bob','member');`);
});
afterEach(async()=>{await pg.close();});
const viewRows=async()=>(await pg.query<{group_id:string;user_id:string;via_group_id:string}>('SELECT group_id,user_id,via_group_id FROM identity.group_admins ORDER BY group_id,user_id')).rows;
const createView=async()=>{
 await pg.exec('CREATE SCHEMA identity');
 const statement=identityViewStatements({auth:'auth',app:'app',read:'identity'},{sessions:false}).find(sql=>sql.includes('VIEW identity.group_admins'))!;
 await pg.exec(statement);
};

it('names the view in the read contract with its three columns',()=>{
 expect(identityViewColumns().group_admins).toEqual(['group_id','user_id','via_group_id']);
});

it('an admin administers every group below theirs, through the nearest direct admin row; Editor and Member flow nowhere',async()=>{
 expect(await effectiveAdminVia(db,t,'ann','tip')).toBe('root');
 expect(await effectiveAdminVia(db,t,'ann','root')).toBe('root');
 expect(await effectiveAdminVia(db,t,'bob','leaf')).toBe('mid');
 expect(await effectiveAdminVia(db,t,'bob','root')).toBeNull();
 expect(await effectiveAdminVia(db,t,'lee','mid')).toBeNull();
 for(const user of ['ed','meg'])for(const group of ['root','mid','leaf','tip'])expect(await effectiveAdminVia(db,t,user,group),`${user} ${group}`).toBeNull();
 expect(await effectiveAdminVia(db,t,'ann','other')).toBeNull();
 expect(await effectiveAdminGroupIds(db,t,'ann')).toEqual(['leaf','mid','root','tip']);
 expect(await effectiveAdminGroupIds(db,t,'bob')).toEqual(['leaf','mid','tip']);
 expect(await effectiveAdminGroupIds(db,t,'meg')).toEqual([]);
 // A nearer direct admin row wins: Ann holds admin on Leaf too, so Tip is hers through Leaf.
 await pg.exec("INSERT INTO auth.group_members VALUES('leaf','ann','admin')");
 expect(await effectiveAdminVia(db,t,'ann','tip')).toBe('leaf');
 expect(await effectiveAdminVia(db,t,'ann','mid')).toBe('root');
});

it('the group_admins view answers exactly what the checks answer, one row per live group and effective admin',async()=>{
 await createView();
 expect(await viewRows()).toEqual([
  {group_id:'leaf',user_id:'ann',via_group_id:'root'},{group_id:'leaf',user_id:'bob',via_group_id:'mid'},{group_id:'leaf',user_id:'lee',via_group_id:'leaf'},
  {group_id:'mid',user_id:'ann',via_group_id:'root'},{group_id:'mid',user_id:'bob',via_group_id:'mid'},
  {group_id:'root',user_id:'ann',via_group_id:'root'},
  {group_id:'tip',user_id:'ann',via_group_id:'root'},{group_id:'tip',user_id:'bob',via_group_id:'mid'},{group_id:'tip',user_id:'lee',via_group_id:'leaf'},
 ]);
 for(const row of await viewRows())expect(await effectiveAdminVia(db,t,row.user_id,row.group_id)).toBe(row.via_group_id);
 // Taking the role away ends the authority below at once: nothing is stored or cached.
 await pg.exec("UPDATE auth.group_members SET role='member' WHERE group_id='root' AND user_id='ann'");
 expect((await viewRows()).filter(row=>row.user_id==='ann')).toEqual([]);
 expect(await effectiveAdminVia(db,t,'ann','tip')).toBeNull();
});

it('a deleted group grants nothing and ends the climb: nothing above it reaches below it',async()=>{
 await createView();
 // Only direct SQL can delete a group that still has a live subgroup (the store refuses group_has_children).
 await pg.exec("UPDATE auth.groups SET deleted_at=now() WHERE id='mid'");
 expect(await viewRows()).toEqual([
  {group_id:'leaf',user_id:'lee',via_group_id:'leaf'},
  {group_id:'root',user_id:'ann',via_group_id:'root'},
  {group_id:'tip',user_id:'lee',via_group_id:'leaf'},
 ]);
 expect(await effectiveAdminVia(db,t,'ann','leaf')).toBeNull();
 expect(await effectiveAdminVia(db,t,'bob','mid')).toBeNull();
 expect(await effectiveAdminGroupIds(db,t,'ann')).toEqual(['root']);
 await pg.exec("UPDATE auth.groups SET deleted_at=now() WHERE id='tip'");
 expect(await effectiveAdminVia(db,t,'lee','tip')).toBeNull();
});
