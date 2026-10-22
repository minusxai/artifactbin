import { sourceDigest } from "../src/server/page-ports.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import {
  registerSavedQueries,
  createSavedQueryRepository,
} from "../src/persistence/dataset-queries.ts";
import type { SavedQueryRegistration } from "../src/persistence/dataset-queries-contracts.ts";
import { createSavedQueryHost } from "../src/server/registered-query-host.ts";
import { sealDeployment } from "../src/backend/deployment.ts";
const deployment = sealDeployment("source", "bundle", {
  typeDefs: "type Query { x: String }",
  fields: ["x"],
});
const digest = sourceDigest("saved source");
const registration: SavedQueryRegistration = {
  sourceNamespace: "legacy",
  moduleSourceSha256: "a".repeat(64),
  plan: {
    registration: {
      pageId: "Page12",
      pageVersion: 1,
      backendId: "Back12",
      backendVersion: deployment.version,
      sourceSha256: digest,
    },
    queries: [
      { name: "rows", sql: "select $_me__id as who", dependencies: [] },
    ],
    scalars: {},
    tables: [],
    imports: [],
  },
};
const invocation = {
  pageId: "Page12",
  backendId: "Back12",
  backendVersion: deployment.version,
  principal: { tenant: "Page12", subject: "owner" },
  tokenHash: "session",
};
test("saved query authority pins source, session, namespace and immutable SQL across fresh checks", async () => {
  const env = await testDatabase();
  try {
    for (const path of [
      "schema.sql",
      "backend/af-schema.sql",
      "datasets/schema.sql",
    ])
      await env.pool.query(
        await readFile(new URL("../src/" + path, import.meta.url), "utf8"),
      );
    await env.pool.query(
      "INSERT INTO accounts(actor,name) VALUES('owner','Owner'); INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Page12','owner','page',true,0); ",
    );
    await env.pool.query(
      "INSERT INTO files(id,owner,share_hash,generation,head,source_digest) VALUES('Page12','owner','hash',1,'1',$1)",
      [digest],
    );
    await env.pool.query(
      "INSERT INTO sources(file_id,revision,content,digest) VALUES('Page12','1','saved source',$1)",
      [digest],
    );
    await env.pool.query(
      "INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Back12','owner','version'); INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Back12','version','Page12',1,'type Query { x: String }','{\"version\":\"version\"}'); INSERT INTO af_page_backends VALUES('Page12',1,0,'legacyData','Back12','version'); INSERT INTO dataset_pages VALUES('Page12',1,'legacy','{}'); INSERT INTO dataset_principals VALUES('legacy','owner','user','original-user','user',NULL); INSERT INTO sessions(token_hash,actor,file_id,generation,expires) VALUES('session','owner',NULL,NULL,9999999999999)".replaceAll(
        "'version'",
        "'" + deployment.version + "'",
      ),
    );
    await env.pool.query("UPDATE af_backend_versions SET deployment=$1", [
      deployment,
    ]);
    const db = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    await db.transaction((c) => registerSavedQueries(c, registration));
    await assert.rejects(db.transaction(c => registerSavedQueries(c, {
      ...registration, plan: { ...registration.plan, registration: {
        ...registration.plan.registration,
        sourceSha256: createHash("sha256").update("saved source").digest("hex"),
      } },
    })), /source_mismatch/);

    await db.transaction((c) =>
      registerSavedQueries(c, structuredClone(registration)),
    );
    await assert.rejects(
      db.transaction((c) =>
        registerSavedQueries(c, {
          ...registration,
          plan: {
            ...registration.plan,
            queries: [{ name: "rows", sql: "select 999", dependencies: [] }],
          },
        }),
      ),
    );
    const repo = createSavedQueryRepository(db, () => 1000);
    const signal = new AbortController().signal;
    const authority = await repo.resolve(invocation, signal);
    assert.equal(authority?.userId, "original-user");
    assert.equal(authority?.context.sourceSha256, digest);
    await env.pool.query("DELETE FROM dataset_principals WHERE kind='user'");
    assert.equal(
      await repo.resolve(invocation, signal),
      null,
      "signed-in unmapped is unavailable",
    );
    await env.pool.query(
      "INSERT INTO dataset_principals VALUES('legacy','owner','user','original-user','guest',NULL)",
    );
    assert.equal(
      await repo.resolve(invocation, signal),
      null,
      "guest-kind mapping cannot project authenticated identity",
    );
    await env.pool.query("DELETE FROM dataset_principals WHERE kind='user'");
    await env.pool.query(
      "INSERT INTO dataset_principals VALUES('legacy','owner','user','original-user','user',NULL)",
    );
    assert.equal(
      (await repo.resolve(invocation, signal))?.userId,
      "original-user",
    );
    assert.equal(
      await repo.resolve(
        { ...invocation, principal: { tenant: "Page12", subject: "forged" } },
        signal,
      ),
      null,
    );
    assert.equal(
      await repo.resolve({ ...invocation, pageId: "Other1" }, signal),
      null,
    );
    await assert.rejects(
      env.pool.query("UPDATE dataset_query_registrations SET registration=$1", [
        registration,
      ]),
    );
    await env.pool.query(
      "UPDATE dataset_principals SET expires_at='1970-01-01'",
    );
    assert.equal(await repo.resolve(invocation, signal), null);
    await env.pool.query("UPDATE dataset_principals SET expires_at=NULL");
    await env.pool.query("DELETE FROM sessions WHERE token_hash='session'");
    assert.equal(await repo.resolve(invocation, signal), null);
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,file_id,generation,expires) VALUES('session','owner',NULL,NULL,9999999999999)",
    );
    let duringSql: () => Promise<void> = async () => {};
    let executions = 0;
    const adapter = createSavedQueryHost({
      database: db,
      now: () => 1000,
      reads: {
        read: async () => {
          throw Error("unexpected import");
        },
      },
      executor: {
        execute: async () => {
          throw Error("mutation refused");
        },
        close: async () => {},
        query: async () => {
          executions++;
          await duringSql();
          return {
            tables: {
              rows: {
                rows: [{ who: "original-user" }],
                columns: [{ name: "who", type: "string" }],
              },
            },
            errors: {},
          };
        },
      },
    });
    const bound = await adapter.bind(invocation, signal);
    assert.equal(
      (await bound.execute({ values: {}, only: ["rows"] })).tables.rows?.rows
        .length,
      1,
    );
    duringSql = async () => {
      await env.pool.query("DELETE FROM dataset_principals WHERE kind='user'");
    };
    await assert.rejects(bound.execute({ values: {}, only: ["rows"] }));
    await env.pool.query(
      "INSERT INTO dataset_principals VALUES('legacy','owner','user','original-user','user',NULL)",
    );
    duringSql = async () => {
      await env.pool.query("UPDATE files SET head='2'");
    };
    await assert.rejects(bound.execute({ values: {}, only: ["rows"] }));
    await env.pool.query("UPDATE files SET head='1'");
    // A real PostgreSQL lock wait is cancelled through the repository signal, not merely ignored.
    const lock = await env.pool.connect();
    await lock.query("BEGIN");
    await lock.query(
      "LOCK TABLE dataset_query_registrations IN ACCESS EXCLUSIVE MODE",
    );
    const abort = new AbortController();
    const waiting = bound.execute({ values: {}, only: ["rows"] }, abort.signal);
    const before = executions;
    const timer = setTimeout(() => abort.abort(Error("test cancellation")), 50);
    try {
      await assert.rejects(waiting);
      const until = Date.now() + 1500;
      let waiters = 0;
      do {
        waiters = (
          await env.pool.query(
            `SELECT l.pid FROM pg_locks l
          JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname='dataset_query_registrations' AND NOT l.granted`,
            [env.schema],
          )
        ).rows.length;
        if (!waiters) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < until);
      assert.equal(
        waiters,
        0,
        "PostgreSQL waiter drained before held registry lock is released",
      );
    } finally {
      clearTimeout(timer);
      await lock.query("ROLLBACK");
      lock.release();
    }
    assert.equal(executions, before);
    await env.pool.query(
      'UPDATE af_backend_versions SET deployment=\'{"version":"forged"}\'',
    );
    assert.equal(await repo.resolve(invocation, signal), null);
    await env.pool.query("UPDATE af_backend_versions SET deployment=$1", [
      deployment,
    ]);
    await env.pool.query(
      "UPDATE sources SET content='forged source retaining digest'",
    );
    assert.equal(await repo.resolve(invocation, signal), null);
    await env.pool.query("UPDATE sources SET content='saved source'");
    await env.pool.query("UPDATE sources SET digest=$1", ["b".repeat(64)]);
    assert.equal(await repo.resolve(invocation, signal), null);
  } finally {
    await env.cleanup();
  }
});
