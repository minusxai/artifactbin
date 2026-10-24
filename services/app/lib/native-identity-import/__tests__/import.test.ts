import { it, expect, beforeAll, beforeEach } from "vitest";
import {createHumanAuth,type HumanAuth} from "@artifactbin/auth";
import {syncProfile} from "@/lib/accounts/profiles";
import { createHash } from "node:crypto";
import { useAppHarness } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import { resolveTokenById, resolveToken } from "@/lib/accounts/tokens";
import type {
  NativeIdentityImport,
  NativeIdentityImportDb,
  NativeIdentityAuthCompanion,
  NativeIdentityUser,
  NativeIdentityToken,
  NativeIdentityPlan,
} from "../contracts";
import { importNativeIdentities as importWithSchemas, writeNativeIdentities as writeWithAuthority,provisionNativeIdentityAuthCompanion as provisionWithAuthority,authorizeNativeIdentityTransaction } from "../index";
import type {Queryable} from '@artifactbin/contracts';
const fixtureSchemas={appSchema:'public',authSchema:'auth'};
const importNativeIdentities=(db:NativeIdentityImportDb,input:NativeIdentityImport)=>importWithSchemas(db,input,fixtureSchemas);
const writeNativeIdentities=async(tx:Queryable,input:NativeIdentityImport)=>writeWithAuthority(tx,input,await authorizeNativeIdentityTransaction(tx,fixtureSchemas));
const provisionNativeIdentityAuthCompanion=async(tx:Queryable,input:NativeIdentityAuthCompanion)=>provisionWithAuthority(tx,input,await authorizeNativeIdentityTransaction(tx,fixtureSchemas));
useAppHarness();
let human:HumanAuth,otp='';
beforeAll(async()=>{const db=await getDb(),raw=db.raw();if(raw.kind!=='pglite')throw Error('pglite required');human=await createHumanAuth({pglite:raw.instance,secret:'synthetic-native-identity-auth'.padEnd(32,'0'),baseURL:'http://localhost:3000',mail:{send:async message=>{otp=message.otp??'';}}});});
beforeEach(async()=>{const db=await getDb();for(const table of ['session','account','verification','user'])await db.query('DELETE FROM auth."'+table+'"');otp='';});
function digest(v: unknown): string {
  const canonical = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canonical)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, y]) => [k, canonical(y)]),
          )
        : x;
  return createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
const sourceUser: NativeIdentityUser = {
  id: "source_account",
  email: "person@example.test",
  kind: "account",
  parent_user_id: null,
  merged_into_user_id: null,
  expires_at: null,
  created_at: "2020-01-01T00:00:00.000Z",
  name: "Synthetic",
  username: null,
  image_key: null,
};
function fixture(): NativeIdentityImport {
  const sourceToken: NativeIdentityToken = {
      id: "source_token",
      user_id: sourceUser.id,
      created_at: "2020-02-01T00:00:00.000Z",
      deleted_at: null,
      expires_at: null,
    },
    sourceInventory = { users: [sourceUser], tokens: [sourceToken] },
    targetInventory = { users: [] };
  const plan: NativeIdentityPlan = {
    sourceNamespace: "synthetic",
    sourceInventorySha256: digest(sourceInventory),
    targetInventorySha256: digest(targetInventory),
    targets: {
      users: {
        source_account: { userId: "source_account", email: sourceUser.email },
      },
      actors: { "person@example.test": { userId: "source_account" } },
      tokens: { source_token: { tokenId: "source_token" } },
    },
    users: [
      {
        sourceId: sourceUser.id,
        targetId: sourceUser.id,
        action: "create-preserved" as const,
        sourceRowSha256: digest(sourceUser),
      },
    ],
    createUsers: [
      {
        ...sourceUser,
        sourceId: sourceUser.id,
        sourceRowSha256: digest(sourceUser),
      },
    ],
    tokens: [
      {
        sourceId: "source_token",
        targetId: "source_token",
        userId: sourceUser.id,
        action: "create-disabled-provenance" as const,
        sourceRowSha256: digest(sourceToken),
        sourceCreatedAt: sourceToken.created_at!,
        sourceDeletedAt: null,
        sourceExpiresAt: null,
      },
    ],
    blockers: [],
    sha256: "",
  };
  const { sha256: _, ...body } = plan;
  plan.sha256 = digest(body);
  return {
    plan,
    approvedPlanSha256: plan.sha256,
    sourceInventory,
    targetInventory,
    revokedAt: "2026-01-01T00:00:00.000Z",
  };
}
function resign(input: NativeIdentityImport) {
  const { sha256: _, ...body } = input.plan;
  input.plan.sha256 = digest(body);
  input.approvedPlanSha256 = input.plan.sha256;
  return input;
}
it("creates exact source account and permanently noncredential provenance token, preserves original dates separately, and replays", async () => {
  const db = await getDb(),
    input = fixture();
  expect(await importNativeIdentities(db, input)).toMatchObject({
    createdUsers: 1,
    createdTokens: 1,
  });
  const row = (
    await db.query<any>("SELECT * FROM tokens WHERE id=$1", ["source_token"])
  ).rows[0];
  expect(new Date(row.deleted_at).toISOString()).toBe(input.revokedAt);
  expect(new Date(row.expires_at).toISOString()).toBe(input.revokedAt);
  expect(new Date(row.created_at).toISOString()).toBe(
    input.plan.tokens[0]!.sourceCreatedAt,
  );
  expect(row.token_hash).toMatch(/^!native-provenance:/);
  expect(row.request_authority).toBe(false);
  expect(await resolveTokenById("source_token")).toBeNull();
  expect(await resolveToken(row.token_hash)).toBeNull();
  expect(
    (
      await db.query<any>(
        "SELECT original_state FROM native_identity_imports WHERE kind='token'",
      )
    ).rows[0].original_state,
  ).toMatchObject({ sourceDeletedAt: null, sourceExpiresAt: null });
  expect(
    await importNativeIdentities(db, {
      ...input,
      revokedAt: "2026-02-01T00:00:00.000Z",
    }),
  ).toMatchObject({ createdUsers: 0, createdTokens: 0, replayed: 2 });
});
it("rejects forged approved/source proofs and unrelated source-ID collisions without partial writes", async () => {
  const db = await getDb(),
    bad = fixture();
  bad.plan.users[0]!.targetId = "unrelated";
  await expect(importNativeIdentities(db, bad)).rejects.toThrow();
  const forged = fixture();
  forged.sourceInventory = {
    ...forged.sourceInventory,
    users: [{ ...sourceUser, name: "Forged" }],
  };
  await expect(importNativeIdentities(db, forged)).rejects.toThrow();
  await db.query(
    "INSERT INTO users(id,email,kind)VALUES('source_account','other@example.test','account')",
  );
  await expect(importNativeIdentities(db, fixture())).rejects.toThrow();
  expect((await db.query('SELECT * FROM auth."user"')).rows).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM native_identity_imports")).rows,
  ).toHaveLength(0);
});
it("allows multiple source aliases to reuse one exact verified account and never broadens its credentials", async () => {
  const db = await getDb();
  await db.query(
    "INSERT INTO users(id,email,kind,created_at)VALUES('existing_account','person@example.test','account','2020-01-01T00:00:00Z')",
  );
  const target = (
    await db.query<NativeIdentityUser>(
      "SELECT id,email,kind,parent_user_id,merged_into_user_id,expires_at,created_at,name,username,image_key FROM users WHERE id=$1",
      ["existing_account"],
    )
  ).rows[0]!;
  const targetRow = JSON.parse(JSON.stringify(target));
  for (const alias of ["source_account", "source_alias"]) {
    const input = fixture();
    const source = { ...sourceUser, id: alias };
    input.sourceInventory = { users: [source], tokens: [] };
    input.targetInventory = { users: [targetRow] };
    input.plan.sourceInventorySha256 = digest(input.sourceInventory);
    input.plan.targetInventorySha256 = digest(input.targetInventory);
    input.plan.users = [
      {
        sourceId: alias,
        targetId: "existing_account",
        action: "reuse-verified-email",
        sourceRowSha256: digest(source),
        targetRowSha256: digest(targetRow),
      },
    ];
    input.plan.targets = {
      users: { [alias]: { userId: "existing_account", email: source.email } },
      actors: { "person@example.test": { userId: "existing_account" } },
      tokens: {},
    };
    input.plan.createUsers = [];
    input.plan.tokens = [];
    if(alias==='source_account'){
      await expect(importNativeIdentities(db,resign(input))).rejects.toThrow('native_identity_auth_missing');
      expect((await db.query('SELECT * FROM auth."user"')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM native_identity_imports')).rows).toHaveLength(0);
      const companion={id:'other_auth_id',email:source.email!,name:'Existing authentication profile',provisionedAt:input.revokedAt};
      await db.transaction(tx=>provisionNativeIdentityAuthCompanion(tx,companion));
      await expect(importNativeIdentities(db,resign(input))).rejects.toThrow('native_identity_auth_collision');
      await db.query('DELETE FROM auth."user"');
      await db.transaction(tx=>provisionNativeIdentityAuthCompanion(tx,{...companion,id:'existing_account'}));
      await db.query('UPDATE auth."user" SET "emailVerified"=true');
    }
    expect(await importNativeIdentities(db, resign(input))).toMatchObject({
      reusedUsers: 1,
    });
  }
  expect((await db.query("SELECT * FROM users")).rows).toHaveLength(1);
  expect((await db.query('SELECT id,name,"emailVerified" FROM auth."user"')).rows).toEqual([{id:'existing_account',name:'Existing authentication profile',emailVerified:true}]);
  expect((await db.query("SELECT * FROM tokens")).rows).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM native_identity_imports")).rows,
  ).toHaveLength(2);
});
it("rolls back newly created accounts if token collision appears and rejects activated or altered replay rows", async () => {
  const db = await getDb();
  await db.query(
    "INSERT INTO tokens(id,token_hash)VALUES('source_token','unrelated')",
  );
  await expect(importNativeIdentities(db, fixture())).rejects.toThrow();
  expect((await db.query("SELECT * FROM users")).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM auth."user"')).rows).toHaveLength(0);
  await db.query("DELETE FROM tokens WHERE id='source_token'");
  await db.transaction((tx) => writeNativeIdentities(tx, fixture()));
  await db.query("UPDATE tokens SET deleted_at=NULL WHERE id='source_token'");
  await expect(importNativeIdentities(db, fixture())).rejects.toThrow();
});

it("never copies unexpected credential fields into the imported account, token, or ledger", async () => {
  const db = await getDb(),
    input = fixture();
  const original = { ...sourceUser, password_hash: "synthetic-unused-marker" };
  input.sourceInventory = { ...input.sourceInventory, users: [original] };
  input.plan.sourceInventorySha256 = digest(input.sourceInventory);
  input.plan.users = [
    { ...input.plan.users[0]!, sourceRowSha256: digest(original) },
  ];
  input.plan.createUsers = [
    { ...input.plan.createUsers[0]!, sourceRowSha256: digest(original) },
  ];
  await importNativeIdentities(db, resign(input));
  const rows = (
    await db.query("SELECT original_state FROM native_identity_imports")
  ).rows;
  expect(JSON.stringify(rows)).not.toContain("synthetic-unused-marker");
  expect(JSON.stringify(rows)).not.toContain("password_hash");
});

it("preserves six-digit timestamp precision and accepts equivalent PostgreSQL text offsets on replay", async () => {
  const db = await getDb(),
    input = fixture();
  const user = {
    ...sourceUser,
    created_at: "2020-01-01T00:00:00.123456+00:00",
  };
  const token = {
    ...input.sourceInventory.tokens[0]!,
    created_at: "2020-02-01T01:00:00.654321+01:00",
  };
  input.sourceInventory = { users: [user], tokens: [token] };
  input.plan.sourceInventorySha256 = digest(input.sourceInventory);
  input.plan.users = [
    { ...input.plan.users[0]!, sourceRowSha256: digest(user) },
  ];
  input.plan.createUsers = [
    { ...user, sourceId: user.id, sourceRowSha256: digest(user) },
  ];
  input.plan.tokens = [
    {
      ...input.plan.tokens[0]!,
      sourceRowSha256: digest(token),
      sourceCreatedAt: token.created_at,
    },
  ];
  input.revokedAt = "2026-01-01T00:00:00.123456Z";
  await importNativeIdentities(db, resign(input));
  const times = (
    await db.query<any>(
      "SELECT to_char((SELECT created_at FROM users WHERE id='source_account') AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS user_time,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS token_time FROM tokens WHERE id='source_token'",
    )
  ).rows[0];
  expect(times.user_time).toBe("2020-01-01 00:00:00.123456");
  expect(times.token_time).toBe("2020-02-01 00:00:00.654321");
  expect(await importNativeIdentities(db, input)).toMatchObject({
    replayed: 2,
  });
});
it("retains parent and merged references when the referenced account sorts later", async () => {
  const db = await getDb(),
    input = fixture();
  const child = {
      ...sourceUser,
      id: "a_child",
      email: null,
      kind: "testuser",
      parent_user_id: "z_parent",
      merged_into_user_id: "z_parent",
    },
    parent = { ...sourceUser, id: "z_parent" };
  input.sourceInventory = { users: [child, parent], tokens: [] };
  input.plan.sourceInventorySha256 = digest(input.sourceInventory);
  input.plan.users = [child, parent].map((u) => ({
    sourceId: u.id,
    targetId: u.id,
    action: "create-preserved" as const,
    sourceRowSha256: digest(u),
  }));
  input.plan.createUsers = [child, parent].map((u) => ({
    ...u,
    sourceId: u.id,
    sourceRowSha256: digest(u),
  }));
  input.plan.targets = {
    users: Object.fromEntries(
      [child, parent].map((u) => [u.id, { userId: u.id, email: u.email }]),
    ),
    actors: {},
    tokens: {},
  };
  input.plan.tokens = [];
  await importNativeIdentities(db, resign(input));
  const row = (
    await db.query<any>(
      "SELECT parent_user_id,merged_into_user_id FROM users WHERE id='a_child'",
    )
  ).rows[0];
  expect(row).toEqual({
    parent_user_id: "z_parent",
    merged_into_user_id: "z_parent",
  });
});

it('keeps the imported account ID through real first OTP login without a second profile or imported credential',async()=>{
 const db=await getDb(),input=fixture();await importNativeIdentities(db,input);
 const before=(await db.query('SELECT "emailVerified" FROM auth."user" WHERE id=$1',[sourceUser.id])).rows;
 expect((await db.query('SELECT * FROM auth.session')).rows).toHaveLength(0);
 const post=(route:string,body:unknown)=>human.handler(new Request('http://localhost:3000/api/auth'+route,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)}));
 expect((await post('/email-otp/send-verification-otp',{email:sourceUser.email,type:'sign-in'})).status).toBe(200);expect(otp).toBeTruthy();
 const login=await post('/sign-in/email-otp',{email:sourceUser.email,otp});expect(login.status).toBe(200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),session=await human.sessions.resolve(new Request('http://localhost:3000',{headers:{cookie}}));
 expect(session?.userId).toBe(sourceUser.id);expect(before).toEqual([{emailVerified:false}]);
 await syncProfile({userId:session!.userId,email:sourceUser.email!});
 expect((await db.query('SELECT id FROM users WHERE email=$1',[sourceUser.email])).rows).toEqual([{id:sourceUser.id}]);
 expect((await db.query('SELECT id,"emailVerified" FROM auth."user"')).rows).toEqual([{id:sourceUser.id,emailVerified:true}]);
 expect((await db.query('SELECT * FROM auth.account')).rows).toHaveLength(0);
});

it('rejects auth ID/email collisions atomically and never restores a deleted companion on replay',async()=>{
 const db=await getDb(),input=fixture(),account={id:sourceUser.id,email:sourceUser.email!,name:sourceUser.name!,provisionedAt:input.revokedAt};
 await db.transaction(tx=>provisionNativeIdentityAuthCompanion(tx,{...account,id:'other_identity'}));
 await expect(importNativeIdentities(db,input)).rejects.toThrow('native_identity_auth_collision');
 expect((await db.query('SELECT * FROM users')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM native_identity_imports')).rows).toHaveLength(0);
 await db.query('DELETE FROM auth."user"');
 await db.transaction(tx=>provisionNativeIdentityAuthCompanion(tx,{...account,email:'different@example.test'}));
 await expect(importNativeIdentities(db,input)).rejects.toThrow('native_identity_auth_collision');
 await db.query('DELETE FROM auth."user"');await importNativeIdentities(db,input);
 await db.query('UPDATE auth."user" SET "emailVerified"=true,name=$1 WHERE id=$2',['Actual updated auth profile',sourceUser.id]);
 await importNativeIdentities(db,input);
 expect((await db.query('SELECT "emailVerified",name FROM auth."user"')).rows).toEqual([{emailVerified:true,name:'Actual updated auth profile'}]);
 await db.query('DELETE FROM auth."user"');
 await expect(importNativeIdentities(db,input)).rejects.toThrow('native_identity_auth_missing');
 expect((await db.query('SELECT * FROM auth."user"')).rows).toHaveLength(0);
});

it('provisions only the explicitly selected auth schema and leaves a decoy auth schema unchanged',async()=>{
 const db=await getDb(),raw=db.raw();if(raw.kind!=='pglite')throw Error('pglite required');
 await db.query('DROP SCHEMA IF EXISTS migration_target_auth CASCADE');
 let scopedOtp='';const scopedHuman=await createHumanAuth({pglite:raw.instance,schema:'migration_target_auth',secret:'synthetic-scoped-auth'.padEnd(32,'0'),baseURL:'http://localhost:3000',mail:{send:async message=>{scopedOtp=message.otp??'';}}});
 const before=(await db.query('SELECT * FROM auth."user"')).rows;
 await db.query('DROP SCHEMA IF EXISTS migration_target_app CASCADE');await db.query('CREATE SCHEMA migration_target_app');
 for(const table of ['users','tokens','native_identity_imports'])await db.query(`CREATE TABLE migration_target_app.${table} (LIKE public.${table} INCLUDING ALL)`);
 await db.transaction(async tx=>{
  await tx.query('SET LOCAL search_path = migration_target_app');
  const authority=await authorizeNativeIdentityTransaction(tx,{appSchema:'migration_target_app',authSchema:'migration_target_auth'});
  await writeWithAuthority(tx,fixture(),authority);
 });
 expect((await db.query('SELECT id FROM migration_target_app.users')).rows).toEqual([{id:sourceUser.id}]);
 expect((await db.query('SELECT * FROM public.users')).rows).toEqual([]);
 expect((await db.query('SELECT id,email FROM migration_target_auth."user"')).rows).toEqual([{id:sourceUser.id,email:sourceUser.email}]);
 const post=(route:string,body:unknown)=>scopedHuman.handler(new Request('http://localhost:3000/api/auth'+route,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)}));
 expect((await post('/email-otp/send-verification-otp',{email:sourceUser.email,type:'sign-in'})).status).toBe(200);expect(scopedOtp).toBeTruthy();
 const login=await post('/sign-in/email-otp',{email:sourceUser.email,otp:scopedOtp});expect(login.status).toBe(200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 expect((await scopedHuman.sessions.resolve(new Request('http://localhost:3000',{headers:{cookie}})))?.userId).toBe(sourceUser.id);
 expect((await db.query('SELECT * FROM auth."user"')).rows).toEqual(before);
 expect((await db.query('SELECT * FROM auth.session')).rows).toEqual([]);
});

it('fails missing or cross-transaction authority and rolls back earlier operator writes',async()=>{
 const db=await getDb(),input=fixture();
 await expect(db.transaction(async tx=>{
  await tx.query("INSERT INTO users(id,kind) VALUES('unapproved_operator_write','account')");
  await (writeWithAuthority as (...args:any[])=>Promise<unknown>)(tx,input,{appSchema:'public',authSchema:'auth'});
 })).rejects.toThrow('native_identity_migration_authority_required');
 expect((await db.query("SELECT id FROM users WHERE id='unapproved_operator_write'")).rows).toEqual([]);
 expect((await db.query('SELECT * FROM native_identity_imports')).rows).toEqual([]);
 const authority=await db.transaction(tx=>authorizeNativeIdentityTransaction(tx,fixtureSchemas));
 await expect(db.transaction(tx=>writeWithAuthority(tx,input,authority))).rejects.toThrow('native_identity_migration_authority_required');
 await expect((importWithSchemas as (...args:any[])=>Promise<unknown>)(db,input)).rejects.toThrow('native_identity_migration_scope_required');
 await expect(importWithSchemas(db,input,{appSchema:'public',authSchema:'public'})).rejects.toThrow('native_identity_migration_scope_required');
});
it('an app-only database role cannot obtain auth authority or leave partial app identities',async()=>{
 const db=await getDb();
 await db.query('CREATE ROLE migration_app_only NOLOGIN');
 await db.query('GRANT USAGE ON SCHEMA public TO migration_app_only');
 await db.query('GRANT SELECT,INSERT,UPDATE ON public.users,public.tokens,public.native_identity_imports TO migration_app_only');
 await expect(db.transaction(async tx=>{
  await tx.query('SET LOCAL ROLE migration_app_only');
  const authority=await authorizeNativeIdentityTransaction(tx,fixtureSchemas);
  await writeWithAuthority(tx,fixture(),authority);
 })).rejects.toThrow('native_identity_migration_authority_denied');
 expect((await db.query('SELECT * FROM users')).rows).toEqual([]);
 expect((await db.query('SELECT * FROM auth."user"')).rows).toEqual([]);
 await expect(importWithSchemas(db,fixture(),{appSchema:'auth',authSchema:'public'})).rejects.toThrow();
 expect((await db.query('SELECT * FROM native_identity_imports')).rows).toEqual([]);
});
it('refuses a changed app search path even with authority minted earlier in the same transaction',async()=>{
 const db=await getDb();await db.query('CREATE SCHEMA migration_decoy_app');
 for(const table of ['users','tokens','native_identity_imports'])await db.query(`CREATE TABLE migration_decoy_app.${table} (LIKE public.${table} INCLUDING ALL)`);
 await expect(db.transaction(async tx=>{
  const authority=await authorizeNativeIdentityTransaction(tx,fixtureSchemas);
  await tx.query('SET LOCAL search_path = migration_decoy_app');
  await writeWithAuthority(tx,fixture(),authority);
 })).rejects.toThrow('native_identity_migration_scope_changed');
 expect((await db.query('SELECT * FROM migration_decoy_app.users')).rows).toEqual([]);
 expect((await db.query('SELECT * FROM auth."user"')).rows).toEqual([]);
});
it('captures caller input before waiting for transaction scope admission',async()=>{
 const db=await getDb(),input=fixture(),original=input.plan.createUsers[0]!.name;
 await db.transaction(async tx=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const held:Queryable={query:async(sql,params)=>{if(sql==='SELECT current_schema() AS schema')await gate;return tx.query(sql,params);}};
  const authority=await authorizeNativeIdentityTransaction(held,fixtureSchemas);
  const pending=writeWithAuthority(held,input,authority);
  input.plan.createUsers[0]!.name='Caller changed after invocation';release();
  expect(await pending).toMatchObject({createdUsers:1});
 });
 expect((await db.query<{name:string}>('SELECT name FROM users WHERE id=$1',[sourceUser.id])).rows[0]?.name).toBe(original);
});

it('captures public import input and schema configuration before transaction scheduling',async()=>{
 const db=await getDb(),input=fixture(),original=input.plan.createUsers[0]!.name;
 const schemas={...fixtureSchemas};let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const delayed:NativeIdentityImportDb={transaction:async work=>{await gate;return db.transaction(work);}};
 const pending=importWithSchemas(delayed,input,schemas);
 input.plan.createUsers[0]!.name='Changed before transaction callback';schemas.authSchema='wrong_schema';release();
 expect(await pending).toMatchObject({createdUsers:1});
 expect((await db.query<{name:string}>('SELECT name FROM users WHERE id=$1',[sourceUser.id])).rows[0]?.name).toBe(original);
 expect((await db.query('SELECT id FROM auth."user" WHERE id=$1',[sourceUser.id])).rows).toHaveLength(1);
});
