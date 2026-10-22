import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { planRetainedCommentPersons } from "../src/comments/retained-persons.ts";
import {
  projectCommentPersons,
  verifyRetainedCommentPersons,
  applyRetainedCommentPersons,
} from "../src/comments/retained-person-repository.ts";
import { createCommentService } from "../src/server/af-comments.ts";
import { createCommentRepository } from "../src/server/comment-repository.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { hash } from "../src/server/text.ts";

test("retained mentions verify read-only, apply idempotently and project fresh public handles only under page ACL", async () => {
  const env = await testDatabase();
  try {
    await env.pool.query(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    await env.pool.query(
      await readFile(
        new URL("../src/datasets/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await env.pool.query(
      "INSERT INTO accounts(actor,handle) VALUES('owner','page_owner'),('mentioned','current_public')",
    );
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,expires) VALUES($1,'owner',$2)",
      [hash("owner"), Date.now() + 60000],
    );
    await env.pool.query(
      "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Pg4mQ2','owner','page',true,0)",
    );
    await env.pool.query(
      "INSERT INTO files(id,owner,share_hash,generation,head,sequence) VALUES('Pg4mQ2','owner','private',1,'1',1)",
    );
    await env.pool.query(
      "INSERT INTO sources(file_id,revision,content) VALUES('Pg4mQ2','1','<p>Page</p>')",
    );
    const body = "[@saved](/people/old-user)";
    await env.pool.query(
      "INSERT INTO comments(file_id,id,quote,body,source_revision,published_by,created_at,revision,resolved,fingerprint,sequence) VALUES('Pg4mQ2','note','',$1,'1','owner','2026-01-01',1,false,'',1)",
      [body],
    );
    const client = await env.pool.connect();
    try {
      assert.deepEqual(
        await projectCommentPersons(client, "Pg4mQ2", [{ id: "note", body }]),
        [{ id: "note", body }],
      );
      await client.query(
        await readFile(
          new URL(
            "../src/comments/retained-person-schema.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await client.query(
        "INSERT INTO dataset_principals(source_namespace,actor,kind,legacy_id,identity) VALUES('source','mentioned','user','old-user','user')",
      );
      const plan = planRetainedCommentPersons([
        {
          sourceNamespace: "source",
          legacyPageId: "original",
          pageId: "Pg4mQ2",
          commentId: "note",
          body,
          archiveSha256: "a".repeat(64),
          receiptSha256: "b".repeat(64),
        },
      ]);
      await client.query("BEGIN READ ONLY");
      assert.deepEqual(await verifyRetainedCommentPersons(client, plan), {
        entries: 1,
        mentions: 1,
        present: 0,
      });
      await client.query("COMMIT");
      const database = createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
      });
      await assert.rejects(
        applyRetainedCommentPersons(database, {
          ...plan,
          entries: [
            ...plan.entries,
            { ...plan.entries[0]!, commentId: "missing" },
          ],
        }),
        /no longer matches/,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM retained_comment_persons",
          )
        ).rows[0]!.n,
        0,
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          (await applyRetainedCommentPersons(database, plan)).present,
          1,
        );
      await client.query("BEGIN READ ONLY");
      assert.equal(
        (await verifyRetainedCommentPersons(client, plan)).present,
        1,
      );
      await client.query("COMMIT");
      assert.deepEqual(
        (
          await projectCommentPersons(client, "Pg4mQ2", [{ id: "note", body }])
        )[0]?.personLinks,
        [{ legacyUserId: "old-user", href: "/@current_public" }],
      );
      assert.equal(
        (
          await projectCommentPersons(client, "Pg4mQ2", [
            { id: "note", body: body + " edited" },
          ])
        )[0]?.personLinks,
        undefined,
      );
      await client.query(
        "UPDATE accounts SET handle='renamed_public' WHERE actor='mentioned'",
      );
      const service = createCommentService({
        comments: createCommentRepository(
          createSqlDatabase({
            pool: env.pool,
            initialize: async () => {},
            statementTimeoutMs: 15000,
          }),
        ),
      });
      assert.deepEqual(
        (await service.list("Pg4mQ2", "owner")).comments[0]?.personLinks,
        [{ legacyUserId: "old-user", href: "/@renamed_public" }],
      );
      await assert.rejects(service.list("Pg4mQ2", ""), { status: 403 });
      await client.query(
        "UPDATE sessions SET expires=0 WHERE actor='owner'",
      );
      await assert.rejects(service.list("Pg4mQ2", "owner"), { status: 403 });
      await assert.rejects(
        verifyRetainedCommentPersons(client, {
          ...plan,
          entries: plan.entries.map((e) => ({
            ...e,
            receiptSha256: "c".repeat(64),
          })),
        }),
        /conflicts/,
      );
    } finally {
      client.release();
    }
  } finally {
    await env.cleanup();
  }
});
