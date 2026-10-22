import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createGroupHandlePreservation } from "../src/migration/group-handles-apply.ts";
import { planGroupHandles } from "../src/migration/group-handles.ts";

async function fixture(t: TestContext) {
  const env = await testDatabase();
  const archive = env.schema + "_migration";
  t.after(async () => {
    await env.pool.query(`DROP SCHEMA IF EXISTS "${archive}" CASCADE`);
    await env.cleanup();
  });
  await env.pool.query(
    await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
  );
  const candidates = ["c", "d"].map((letter, index) => ({
    legacyGroupId: "old-" + index,
    actor: "group:" + letter.repeat(64),
    sourceHandle: "team-" + index,
    sourceDeleted: index === 1,
    expectedHandle: null,
  }));
  const manifest = {
    tables: {
      groups: candidates.map((row) => ({
        id: row.legacyGroupId,
        handle: row.sourceHandle,
        deleted_at: row.sourceDeleted ? "2026-01-01" : null,
      })),
    },
  };
  const maps = {
    groups: Object.fromEntries(
      candidates.map((row) => [row.legacyGroupId, row.actor]),
    ),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  await env.pool.query(
    `CREATE SCHEMA "${archive}"; CREATE TABLE "${archive}".archives(namespace text PRIMARY KEY,digest text,manifest jsonb,maps jsonb)`,
  );
  await env.pool.query(
    `INSERT INTO "${archive}".archives VALUES('fixture',$1,$2::jsonb,$3::jsonb)`,
    [digest, JSON.stringify(manifest), JSON.stringify(maps)],
  );
  for (const row of candidates) {
    await env.pool.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES($1,'group')",
      [row.actor],
    );
    await env.pool.query("INSERT INTO groups(owner,active) VALUES($1,$2)", [
      row.actor,
      !row.sourceDeleted,
    ]);
  }
  const sql = createSqlDatabase({
    pool: env.pool,
    initialize: async () => {},
    statementTimeoutMs: 5000,
  });
  const service = createGroupHandlePreservation(sql, env.schema);
  const plan = planGroupHandles(
    {
      kind: "verified-base-import",
      sourceNamespace: "fixture",
      archiveManifestSha256: digest,
      reportSha256: "b".repeat(64),
      datasetReportSha256: "e".repeat(64),
      visualizationReportSha256: "f".repeat(64),
    },
    candidates,
  );
  return { env, archive, service, plan, candidates };
}

test("explicit post-base handle amendment preserves active and inactive groups with an independently verifiable receipt", async (t) => {
  const { env, service, plan } = await fixture(t);
  const applied = await service.apply(plan);
  assert.equal(applied.status, "applied");
  assert.deepEqual(await service.verify(plan), applied.receipt);
  assert.equal((await service.apply(plan)).status, "already-applied");
  const rows = (
    await env.pool.query(
      "SELECT handle,salt,password FROM accounts ORDER BY handle",
    )
  ).rows;
  assert.deepEqual(
    rows,
    ["team-0", "team-1"].map((handle) => ({
      handle,
      salt: null,
      password: null,
    })),
  );
});
test("cross-account collisions and changed NULL expectations cannot partially amend groups", async (t) => {
  const { env, service, plan, archive } = await fixture(t);
  await env.pool.query(
    "INSERT INTO accounts(actor,handle) VALUES('person','team-1')",
  );
  await assert.rejects(service.apply(plan), /collision/);
  assert.equal(
    (
      await env.pool.query(
        "SELECT count(*) FROM accounts WHERE principal_kind='group' AND handle IS NOT NULL",
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await env.pool.query("SELECT to_regclass($1) AS name", [
        archive + ".group_handle_receipts",
      ])
    ).rows[0].name,
    null,
  );
  await env.pool.query("DELETE FROM accounts WHERE actor='person'");
  await env.pool.query(
    "UPDATE accounts SET handle='user-edited' WHERE actor=$1",
    [plan.candidates[1]!.actor],
  );
  await assert.rejects(service.apply(plan), /expected NULL/);
  assert.equal(
    (
      await env.pool.query("SELECT handle FROM accounts WHERE actor=$1", [
        plan.candidates[0]!.actor,
      ])
    ).rows[0].handle,
    null,
  );
});
test("receipt replay never restores revoked handles and detects altered source mappings", async (t) => {
  const { env, archive, service, plan } = await fixture(t);
  await service.apply(plan);
  await env.pool.query("UPDATE accounts SET handle=NULL WHERE actor=$1", [
    plan.candidates[0]!.actor,
  ]);
  await assert.rejects(service.apply(plan), /changed/);
  await assert.rejects(service.verify(plan), /changed/);
  await env.pool.query("UPDATE accounts SET handle='team-0' WHERE actor=$1", [
    plan.candidates[0]!.actor,
  ]);
  await env.pool.query(`UPDATE "${archive}".archives SET maps='{"groups":{}}'`);
  await assert.rejects(service.verify(plan), /source/);
});
test("late receipt failure rolls back every handle update", async (t) => {
  const { env, archive, service, plan } = await fixture(t);
  await env.pool.query(
    `CREATE TABLE "${archive}".group_handle_receipts(namespace text PRIMARY KEY,plan_sha256 text NOT NULL,receipt jsonb NOT NULL CHECK(false))`,
  );
  await assert.rejects(service.apply(plan), { code: "23514" });
  assert.equal(
    (
      await env.pool.query(
        "SELECT count(*) FROM accounts WHERE handle IS NOT NULL",
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await env.pool.query(
        `SELECT count(*) FROM "${archive}".group_handle_receipts`,
      )
    ).rows[0].count,
    "0",
  );
});
test("source digests, exact group mappings and original active state are checked before mutation", async (t) => {
  const { env, archive, service, plan } = await fixture(t);
  const wrongBase = planGroupHandles(
    { ...plan.base, archiveManifestSha256: "f".repeat(64) },
    plan.candidates,
  );
  await assert.rejects(service.apply(wrongBase), /source archive changed/);
  await env.pool.query("UPDATE groups SET active=false WHERE owner=$1", [
    plan.candidates[0]!.actor,
  ]);
  await assert.rejects(service.apply(plan), /active state changed/);
  await env.pool.query("UPDATE groups SET active=true WHERE owner=$1", [
    plan.candidates[0]!.actor,
  ]);
  await env.pool.query(
    `UPDATE "${archive}".archives SET manifest=jsonb_set(manifest,'{tables,groups,0,handle}','"forged-handle"')`,
  );
  await assert.rejects(service.apply(plan), /source or mapping changed/);
  assert.equal(
    (
      await env.pool.query(
        "SELECT count(*) FROM accounts WHERE handle IS NOT NULL",
      )
    ).rows[0].count,
    "0",
  );
});
test("an unrelated group claims the same handle namespace as an account", async (t) => {
  const { env, service, plan } = await fixture(t);
  await env.pool.query(
    "INSERT INTO accounts(actor,principal_kind,handle) VALUES('group:unrelated','group','team-1')",
  );
  await env.pool.query("INSERT INTO groups(owner) VALUES('group:unrelated')");
  await assert.rejects(service.apply(plan), /collision/);
  assert.deepEqual(
    (
      await env.pool.query(
        "SELECT handle FROM accounts WHERE actor=ANY($1::text[]) ORDER BY actor",
        [plan.candidates.map((row) => row.actor)],
      )
    ).rows,
    [{ handle: null }, { handle: null }],
  );
});
