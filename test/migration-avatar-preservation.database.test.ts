import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { avatarFixture } from "./migration-avatar-fixture.ts";
import { planAvatarPreservation } from "../src/migration/avatar-preservation.ts";
import { createAvatarPreservation } from "../src/migration/avatar-preservation-apply.ts";
async function setup() {
  const env = await testDatabase(); const db = await env.pool.connect(); const f = avatarFixture(); const plan = planAvatarPreservation(f.base, f.source, f.inputs);
  await db.query("CREATE TABLE accounts(actor text PRIMARY KEY,name text,image text,handle text,principal_kind text NOT NULL DEFAULT 'user')");
  await db.query("CREATE TABLE archives(namespace text PRIMARY KEY,digest text NOT NULL,manifest jsonb NOT NULL,maps jsonb NOT NULL)");
  await db.query("INSERT INTO archives VALUES($1,$2,$3,$4)", [f.base.sourceNamespace, f.base.archiveManifestSha256, f.source.manifest, f.source.maps]);
  for (const candidate of plan.candidates) await db.query("INSERT INTO accounts(actor,name,handle) VALUES($1,'Preserve name','keep-handle')", [candidate.actor]);
  let proofs = 0;
  const service = createAvatarPreservation(db, { runtimeSchema: env.schema, archiveSchema: env.schema, verifyPrerequisites: async proof => { assert.deepEqual(proof, f.base); proofs++; } });
  return { env, db, f, plan, service, proofs: () => proofs, cleanup: async () => { await db.query("ROLLBACK"); db.release(); await env.cleanup(); } };
}
test("avatar amendment atomically preserves two images and receipt; replay never overwrites a cleared photo", async () => {
  const t = await setup();
  try {
    assert.equal((await t.service.apply(t.plan, "initial")).status, "applied");
    assert.equal((await t.service.apply(t.plan, "retry")).status, "already-applied");
    assert.deepEqual((await t.service.verify(t.plan)).plan, t.plan);
    const rows = (await t.db.query("SELECT image,name,handle FROM accounts ORDER BY actor")).rows;
    assert.deepEqual(rows.map((row: Record<string, unknown>) => row.image), t.plan.candidates.map(row => row.image));
    assert.ok(rows.every((row: Record<string, unknown>) => row.name === "Preserve name" && row.handle === "keep-handle"));
    await t.db.query("UPDATE accounts SET image=NULL WHERE actor=$1", [t.plan.candidates[0]!.actor]);
    await assert.rejects(t.service.apply(t.plan, "retry"), /changed/);
    await assert.rejects(t.service.verify(t.plan), /changed/);
    assert.equal((await t.db.query("SELECT image FROM accounts WHERE actor=$1", [t.plan.candidates[0]!.actor])).rows[0].image, null);
    assert.ok(t.proofs() >= 3);
  } finally { await t.cleanup(); }
});
test("avatar amendment refuses a different existing photo without changing either account", async () => {
  const t = await setup();
  try {
    await t.db.query("UPDATE accounts SET image='user-selected' WHERE actor=$1", [t.plan.candidates[1]!.actor]);
    await assert.rejects(t.service.apply(t.plan, "initial"), /changed/);
    assert.deepEqual((await t.db.query("SELECT image FROM accounts ORDER BY actor")).rows.map((row: Record<string, unknown>) => row.image), [null, "user-selected"]);
    assert.equal((await t.db.query("SELECT to_regclass($1) AS name", [t.env.schema + ".avatar_preservation_receipts"])).rows[0].name, null);
  } finally { await t.cleanup(); }
});
test("avatar amendment checks immutable source/mapping and prerequisites before updates", async () => {
  const t = await setup();
  try {
    await t.db.query("UPDATE archives SET maps=$1", [{ users: { one: "other@example.test", two: "two@example.test" } }]);
    await assert.rejects(t.service.apply(t.plan, "initial"), /avatar/i);
    assert.ok((await t.db.query("SELECT image FROM accounts")).rows.every((row: Record<string, unknown>) => row.image === null));
    const blocked = createAvatarPreservation(t.db, { runtimeSchema: t.env.schema, archiveSchema: t.env.schema, verifyPrerequisites: async () => { throw Error("Addon verification pending"); } });
    await assert.rejects(blocked.apply(t.plan, "initial"), /Addon verification pending/);
  } finally { await t.cleanup(); }
});
test("avatar receipt insertion failure rolls both updates back; removed audit cannot be recreated by retry", async () => {
  const t = await setup();
  try {
    await t.db.query("CREATE TABLE avatar_preservation_receipts(namespace text PRIMARY KEY,plan_sha256 text NOT NULL,receipt jsonb NOT NULL,CHECK(namespace <> 'fixture'))");
    await assert.rejects(t.service.apply(t.plan, "initial"));
    assert.ok((await t.db.query("SELECT image FROM accounts")).rows.every((row: Record<string, unknown>) => row.image === null));
    await t.db.query("DROP TABLE avatar_preservation_receipts");
    await t.service.apply(t.plan, "initial");
    await t.db.query("DELETE FROM avatar_preservation_receipts");
    await assert.rejects(t.service.apply(t.plan, "retry"), /removed/);
    await assert.rejects(t.service.verify(t.plan), /receipt/i);
    assert.equal((await t.db.query("SELECT count(*)::int AS count FROM avatar_preservation_receipts")).rows[0].count, 0);
  } finally { await t.cleanup(); }
});
test("identical existing image is adopted without rewriting; altered receipt is refused", async () => {
  const t = await setup();
  try {
    const first = t.plan.candidates[0]!;
    await t.db.query("UPDATE accounts SET image=$2 WHERE actor=$1", [first.actor, first.image]);
    const before = (await t.db.query("SELECT xmin::text AS revision FROM accounts WHERE actor=$1", [first.actor])).rows[0].revision;
    await t.service.apply(t.plan, "initial");
    assert.equal((await t.db.query("SELECT xmin::text AS revision FROM accounts WHERE actor=$1", [first.actor])).rows[0].revision, before);
    await t.db.query("UPDATE avatar_preservation_receipts SET receipt='{}'");
    await assert.rejects(t.service.apply(t.plan, "retry"), /receipt differs/);
  } finally { await t.cleanup(); }
});
test("changed archive digest or full original user row refuses the amendment", async () => {
  const t = await setup();
  try {
    await t.db.query("UPDATE archives SET digest=$1", ["0".repeat(64)]);
    await assert.rejects(t.service.apply(t.plan, "initial"), /archive differs/);
    const changed = structuredClone(t.f.source.manifest); changed.tables.users![0]!.name = "Changed original";
    await t.db.query("UPDATE archives SET digest=$1,manifest=$2", [t.f.base.archiveManifestSha256, changed]);
    await assert.rejects(t.service.apply(t.plan, "initial"), /avatar/i);
    assert.ok((await t.db.query("SELECT image FROM accounts")).rows.every((row: Record<string, unknown>) => row.image === null));
  } finally { await t.cleanup(); }
});
test("caller mutation during prerequisite verification cannot redirect the avatar amendment", async () => {
  const t = await setup();
  try {
    const mutable = structuredClone(t.plan);
    const service = createAvatarPreservation(t.db, { runtimeSchema: t.env.schema, archiveSchema: t.env.schema, verifyPrerequisites: async proof => {
      assert.ok(Object.isFrozen(proof));
      Object.assign(mutable.candidates[0]!, { actor: "other@example.test", image: "changed" });
    } });
    await service.apply(mutable, "initial");
    assert.deepEqual((await t.db.query("SELECT image FROM accounts ORDER BY actor")).rows.map((row: Record<string, unknown>) => row.image), t.plan.candidates.map(row => row.image));
  } finally { await t.cleanup(); }
});

test("standalone avatar verification uses a repeatable read read-only transaction", async () => {
  const t = await setup();
  try {
    await t.service.apply(t.plan, "initial");
    const statements: string[] = [];
    const service = createAvatarPreservation({ query: async (sql, args) => { statements.push(sql); return t.db.query(sql, args); } }, { runtimeSchema: t.env.schema, archiveSchema: t.env.schema, verifyPrerequisites: async () => {} });
    await service.verify(t.plan);
    assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.ok(statements.every(sql => !/FOR (SHARE|UPDATE)|pg_advisory|CREATE |UPDATE |INSERT /i.test(sql)));
  } finally { await t.cleanup(); }
});
