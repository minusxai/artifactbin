import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createIdentityRepository } from "../src/persistence/identity-repository.ts";
test("database rejects archival credentials and sessions while old saved grants cannot authenticate", async () => {
  const env = await testDatabase();
  try {
    await env.pool.query(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    const repository = createIdentityRepository(
      createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
      }),
    );
    for (const kind of ["user", "token", "orphan"]) {
      const actor = `legacy-${kind}:${"b".repeat(64)}`;
      await env.pool.query("INSERT INTO accounts(actor) VALUES($1)", [actor]);
      await assert.rejects(
        env.pool.query(
          "UPDATE accounts SET salt='salt',password='hash' WHERE actor=$1",
          [actor],
        ),
        /Archival/,
      );
      await assert.rejects(
        env.pool.query(
          "UPDATE accounts SET handle='claimable' WHERE actor=$1",
          [actor],
        ),
        /Archival/,
      );
      await assert.rejects(
        env.pool.query(
          "INSERT INTO sessions(token_hash,actor,expires) VALUES($1,$2,1000)",
          [kind, actor],
        ),
        /Archival/,
      );
      // Simulate credentials and grants persisted before this guard existed, then restore enforcement.
      await env.pool.query(
        "ALTER TABLE sessions DISABLE TRIGGER person_session_guard",
      );
      try {
        await env.pool.query(
          "INSERT INTO sessions(token_hash,actor,expires) VALUES($1,$2,1000)",
          ["old-" + kind, actor],
        );
      } finally {
        await env.pool.query(
          "ALTER TABLE sessions ENABLE TRIGGER person_session_guard",
        );
      }
      assert.equal(await repository.readSession("old-" + kind), null);
      await repository.withPasswordAccount(actor, ({ account }) => {
        assert.equal(account, null);
        return { value: undefined };
      });
    }
    await env.pool.query(
      "INSERT INTO accounts(actor) VALUES('guest:synthetic'),('reader@example.test')",
    );
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,file_id,generation,expires,purpose) VALUES('guest-token','guest:synthetic','Page12',1,1000,'document'),('real-token','reader@example.test',NULL,NULL,1000,NULL)",
    );
    assert.equal(
      (await repository.readSession("guest-token"))?.actor,
      "guest:synthetic",
    );
    assert.equal(
      (await repository.readSession("guest-token"))?.fileId,
      "Page12",
    );
    assert.equal(
      (await repository.readSession("real-token"))?.actor,
      "reader@example.test",
    );
  } finally {
    await env.cleanup();
  }
});
