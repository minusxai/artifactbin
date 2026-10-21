import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { page, startServer } from "../support/server.ts";

/** The page tables a v1 server left behind: 12-character IDs, a server-held shared state, no node IDs. */
const V1 = `
CREATE TABLE accounts (actor text PRIMARY KEY, salt text, password text, name text, image text, space text NOT NULL DEFAULT gen_random_uuid()::text);
CREATE TABLE files (id text PRIMARY KEY, owner text NOT NULL REFERENCES accounts(actor), share_hash text NOT NULL, generation integer NOT NULL, head text NOT NULL, sequence bigint NOT NULL DEFAULT 0, share text, path text, access jsonb, shared jsonb);
CREATE TABLE sources (file_id text NOT NULL REFERENCES files(id), revision text NOT NULL, content text NOT NULL, PRIMARY KEY(file_id, revision));
CREATE UNIQUE INDEX files_owner_path ON files(owner, path);
CREATE TABLE document_ids (file_id text PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, public_id text NOT NULL UNIQUE);
INSERT INTO accounts (actor) VALUES ('old@example.test');
INSERT INTO files (id, owner, share_hash, generation, head, share, path, shared) VALUES ('abcdefghijkl', 'old@example.test', 'h', 1, 'deadbeef', 's', '/old', '{"snapshot":{"state":{"count":2}}}');
INSERT INTO sources (file_id, revision, content) VALUES ('abcdefghijkl', 'deadbeef', '<h1>old</h1>');
INSERT INTO document_ids (file_id, public_id) VALUES ('abcdefghijkl', 'AbCdEfGhIjKl');
`;

test("a server starting on a v1 database sets its pages aside and publishes new pages", async () => {
  const server = await startServer({}, async (query) => {
    await query(V1);
  });
  try {
    // The server prepares its schema on first use.
    const token = await server.token("old@example.test");
    const { rows } = await server.query("SELECT current_schema() AS schema");
    const aside = `${rows[0]!.schema}_v1`;
    const kept = await server.query(`SELECT id, shared FROM "${aside}".files`);
    assert.deepEqual(kept.rows, [{ id: "abcdefghijkl", shared: { snapshot: { state: { count: 2 } } } }], "the v1 rows are kept, set aside");
    assert.equal((await server.query(`SELECT count(*)::int AS n FROM "${aside}".document_ids`)).rows[0]!.n, 1);

    const published = await server.request("/api/publish", {
      token,
      body: { requestId: "after-v1", source: page("<h1>New page</h1>") },
    });
    const text = await published.text();
    assert.equal(published.status, 201, text);
    const body = JSON.parse(text) as PublishResponse;
    assert.equal(body.version, 1);
    const opened = await server.request(`/af/v1/ids/${body.id}`, { token });
    assert.equal(opened.status, 200);
    assert.equal((await server.query("SELECT count(*)::int AS n FROM files")).rows[0]!.n, 1, "the new files table holds only the new page");
  } finally {
    await server.query(`DROP SCHEMA IF EXISTS "${(await server.query("SELECT current_schema() AS schema")).rows[0]!.schema}_v1" CASCADE`);
    await server.close();
  }
});
