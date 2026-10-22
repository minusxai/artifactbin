import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { readFile } from "node:fs/promises";
import { createCommentRepository } from "../src/server/comment-repository.ts";
import { createCommentService } from "../src/server/af-comments.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { hash } from "../src/server/text.ts";
async function fixture() {
  const env = await testDatabase();
  await env.pool.query(
    await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
  );
  await env.pool.query("INSERT INTO accounts(actor) VALUES('owner')");
  await env.pool.query(
    "INSERT INTO sessions(token_hash,actor,file_id,generation,expires) VALUES($1,'owner',NULL,NULL,$2)",
    [hash("owner"), Date.now() + 60000],
  );
  await env.pool.query(
    "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Pg4mQ2','owner','page',true,0)",
  );
  await env.pool.query(
    "INSERT INTO files(id,owner,share_hash,generation,head,sequence) VALUES('Pg4mQ2','owner',$1,1,'2',0)",
    [hash("link")],
  );
  await env.pool.query(
    "INSERT INTO sources(file_id,revision,content) VALUES('Pg4mQ2','1','<p>Old</p>'),('Pg4mQ2','2','<p>New</p>')",
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
  return { env, service, close: () => env.cleanup() };
}
const comment = (body: string) => ({
  comment: { nodeId: null, quote: "", body, version: 1, state: { todos: [] } },
});
const count = async (env: { pool: { query: Function } }, sql: string) =>
  (await env.pool.query(sql)).rows[0].n as number;

test("PostgreSQL comments serialize their sequence; context resolves the version and state the author saw", async () => {
  const f = await fixture();
  try {
    const created = await Promise.all(
      ["a", "b", "c"].map((body) => f.service.add("Pg4mQ2", "owner", comment(body))),
    );
    assert.equal(new Set(created.map((c) => c.id)).size, 3);
    assert.equal(
      await count(f.env, "SELECT sequence::int AS n FROM files WHERE id='Pg4mQ2'"),
      3,
    );
    const context = await f.service.context("Pg4mQ2", "owner", created[0]!.id, "https://pagegi.test");
    assert.equal(context.source, "<p>Old</p>");
    assert.deepEqual(context.state, { todos: [] });
    assert.equal(context.comment.version, 1);
    const { head, comments } = await f.service.list("Pg4mQ2", "owner");
    assert.equal(head, 2);
    assert.equal(comments.length, 3);
    const edits = await Promise.allSettled(
      ["one", "two"].map((body) =>
        f.service.edit("Pg4mQ2", "owner", created[0]!.id, "1", { body }),
      ),
    );
    assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (edits.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("PostgreSQL failed staged comment write rolls back its snapshot and sequence", async () => {
  const f = await fixture();
  try {
    await f.env.pool.query(
      "ALTER TABLE comments ADD CONSTRAINT reject_test_comment CHECK (body <> 'reject')",
    );
    await assert.rejects(f.service.add("Pg4mQ2", "owner", comment("reject")));
    assert.equal(await count(f.env, "SELECT count(*)::int AS n FROM snapshots"), 0);
    assert.equal(
      await count(f.env, "SELECT sequence::int AS n FROM files WHERE id='Pg4mQ2'"),
      0,
    );
    const created = await f.service.add("Pg4mQ2", "owner", comment("accepted"));
    assert.equal(created.body, "accepted");
    assert.equal(created.author, "owner");
  } finally {
    await f.close();
  }
});

test("historical comments without retained source serialize explicit unavailable context and retain threads", async () => {
  const f = await fixture();
  const context = { status: "unavailable", originalRevision: "17", reason: "not-retained" };
  try {
    for (const [id, parent, sequence] of [["legacy", null, 1], ["reply", "legacy", 2]])
      await f.env.pool.query(
        "INSERT INTO comments(file_id,id,node_id,quote,body,source_revision,parent_id,app_state_id,published_by,created_at,revision,resolved,fingerprint,sequence,context_status) VALUES('Pg4mQ2',$1,NULL,'Original quote','Original body',NULL,$2,NULL,'owner','2025-01-01',1,false,'legacy',$3,$4)",
        [id, parent, sequence, context],
      );
    const list = await f.service.list("Pg4mQ2", "owner");
    assert.equal(list.comments.length, 2);
    assert.deepEqual(list.comments.map(c => [c.id, c.parentId, c.body, c.quote, c.author, c.version, c.nodeId, c.context]), [
      ["legacy", null, "Original body", "Original quote", "owner", null, null, context],
      ["reply", "legacy", "Original body", "Original quote", "owner", null, null, context],
    ]);
    const unavailable = await f.service.context("Pg4mQ2", "owner", "legacy", "https://example.test");
    assert.deepEqual({ context: unavailable.context, source: unavailable.source, state: unavailable.state, url: unavailable.url }, { context, source: null, state: null, url: null });
    await assert.rejects(f.env.pool.query("UPDATE comments SET node_id='current-anchor' WHERE id='legacy'"), /comments_context_status/);
    await assert.rejects(f.env.pool.query("UPDATE comments SET context_status=NULL WHERE id='legacy'"), /comments_context_status/);
    await assert.rejects(f.env.pool.query("UPDATE comments SET context_status='{}' WHERE id='legacy'"), /comments_context_status/);
    const edited = await f.service.edit("Pg4mQ2", "owner", "legacy", "1", { body: "Edited body" });
    assert.deepEqual(edited.context, context);
    assert.equal(edited.body, "Edited body");
  } finally { await f.close(); }
});
