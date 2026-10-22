/**
 * Server support for the page lifecycle scripts: idempotent saves and
 * comments, the merge-ready 409, page deletion and comment polling.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CommentRecord,
  CommentsResponse,
  DeleteResponse,
  PublishResponse,
  SaveConflict,
  SaveResponse,
  SourceResponse,
} from "../../../src/server/af-api-contracts.ts";
import { IDEMPOTENCY_TTL_MS } from "../../../src/server/af-api-contracts.ts";
import { page, startServer, type TestServer } from "../support/server.ts";
import { compileOnlyHost } from "../support/todo.ts";

async function publish(server: TestServer, token: string, source: string, requestId: string) {
  const response = await server.request("/api/publish", { token, body: { source, requestId } });
  const body = (await response.json()) as PublishResponse & { error?: string };
  assert.equal(response.status, 201, body.error);
  return body;
}
function save(
  server: TestServer,
  token: string,
  id: string,
  source: string,
  ifMatch: number,
  key?: string,
  files?: Record<string, string>,
) {
  return server.request(`/api/files/${id}/source`, {
    method: "PUT",
    token,
    body: files ? { source, files } : { source },
    headers: { "If-Match": String(ifMatch), ...(key ? { "Idempotency-Key": key } : {}) },
  });
}
async function head(server: TestServer, token: string, id: string) {
  return (await (await server.request(`/api/files/${id}/source`, { token })).json()) as SourceResponse;
}
const edit = (source: string, text: string) => source.replace("</body>", `<p>${text}</p>\n</body>`);
function comment(server: TestServer, token: string, id: string, body: Record<string, unknown>, key?: string) {
  return server.request(`/api/files/${id}/comments`, {
    token,
    body: { comment: body },
    headers: key ? { "Idempotency-Key": key } : {},
  });
}
async function comments(server: TestServer, token: string, id: string, since?: string) {
  const response = await server.request(
    `/api/files/${id}/comments${since === undefined ? "" : `?since=${encodeURIComponent(since)}`}`,
    { token },
  );
  assert.equal(response.status, 200);
  return (await response.json()) as CommentsResponse;
}

test("a save replayed with its Idempotency-Key returns the original response, even after the page moved on", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>One</h1>"), "idem-save");
    const mine = edit(published.source, "Mine");

    const first = await save(server, token, published.id, mine, 1, "save-1");
    assert.equal(first.status, 200);
    const original = (await first.json()) as SaveResponse;
    assert.equal(original.version, 2);

    // The response was lost; the client replays the same request.
    const replay = await save(server, token, published.id, mine, 1, "save-1");
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), original);
    assert.equal((await head(server, token, published.id)).version, 2, "the replay applied nothing");

    // Someone else saves; the replay still answers with the first result.
    const theirs = await save(server, token, published.id, edit(original.source, "Theirs"), 2, "save-2");
    assert.equal(theirs.status, 200);
    const late = await save(server, token, published.id, mine, 1, "save-1");
    assert.equal(late.status, 200);
    assert.deepEqual(await late.json(), original);
    assert.equal((await head(server, token, published.id)).version, 3);

    // The same key with another body is refused and changes nothing.
    const reused = await save(server, token, published.id, edit(published.source, "Other"), 3, "save-1");
    assert.equal(reused.status, 422);
    assert.match(((await reused.json()) as { error: string }).error, /Idempotency-Key/);
    assert.equal((await head(server, token, published.id)).version, 3);

    // Keys are per page: the same key on another page is a new request.
    const other = await publish(server, token, page("<h1>Other</h1>"), "idem-other");
    const elsewhere = await save(server, token, other.id, edit(other.source, "There"), 1, "save-1");
    assert.equal(elsewhere.status, 200);
    assert.equal(((await elsewhere.json()) as SaveResponse).version, 2);

    // A malformed key is a 400, not a silent non-idempotent save.
    assert.equal((await save(server, token, published.id, mine, 3, " ")).status, 400);
  } finally {
    await server.close();
  }
});

test("concurrent saves with one Idempotency-Key apply once", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Race</h1>"), "idem-race");
    const mine = edit(published.source, "Once");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => save(server, token, published.id, mine, 1, "race-key")),
    );
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    const bodies = (await Promise.all(results.map((r) => r.json()))) as SaveResponse[];
    for (const body of bodies) assert.deepEqual(body, bodies[0]);
    assert.equal((await head(server, token, published.id)).version, 2);
  } finally {
    await server.close();
  }
});

test("a failed save stores no key, and without a key saves behave as before", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Fail</h1>"), "idem-fail");
    const mine = edit(published.source, "Retry");
    await save(server, token, published.id, edit(published.source, "Other"), 1);
    // Stale: 409, and the key is not recorded, so the same key can apply after a merge.
    assert.equal((await save(server, token, published.id, mine, 1, "after-merge")).status, 409);
    const applied = await save(server, token, published.id, mine, 2, "after-merge");
    assert.equal(applied.status, 200);
    assert.equal(((await applied.json()) as SaveResponse).version, 3);
    // No key: a repeat is an ordinary stale save.
    assert.equal((await save(server, token, published.id, mine, 2)).status, 409);
  } finally {
    await server.close();
  }
});

test("a write and its Idempotency-Key commit together or not at all", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Atomic</h1>"), "idem-atomic");
    // Recording this one key fails after the write itself succeeded.
    await server.query("ALTER TABLE idempotency_keys ADD CONSTRAINT refuse_boom CHECK (key <> 'boom')");
    const mine = edit(published.source, "Mine");
    assert.equal((await save(server, token, published.id, mine, 1, "boom")).status, 500);
    assert.equal((await head(server, token, published.id)).version, 1, "the save rolled back with its key");
    assert.equal((await comment(server, token, published.id, { nodeId: null, quote: "", body: "Hi" }, "boom")).status, 500);
    assert.deepEqual((await comments(server, token, published.id)).comments, [], "the comment rolled back with its key");

    // The other way round: a write that fails records no key, so a retry applies.
    await server.query("ALTER TABLE comments ADD CONSTRAINT refuse_body CHECK (body <> 'refused')");
    const refused = { nodeId: null, quote: "", body: "refused" };
    assert.equal((await comment(server, token, published.id, refused, "retry")).status, 500);
    await server.query("ALTER TABLE comments DROP CONSTRAINT refuse_body");
    assert.equal((await comment(server, token, published.id, refused, "retry")).status, 201);
    assert.equal((await comments(server, token, published.id)).comments.length, 1);
  } finally {
    await server.close();
  }
});

test("an Idempotency-Key is honoured for 24 hours and then treated as new", async () => {
  let clock = Date.parse("2026-10-01T00:00:00Z");
  const server = await startServer({ now: () => clock });
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Clock</h1>"), "idem-clock");
    const mine = edit(published.source, "Timed");
    assert.equal((await save(server, token, published.id, mine, 1, "timed")).status, 200);
    clock += IDEMPOTENCY_TTL_MS;
    assert.equal((await save(server, token, published.id, mine, 1, "timed")).status, 200, "kept for 24 hours");
    clock += 1;
    assert.equal(
      (await save(server, token, published.id, mine, 1, "timed")).status,
      409,
      "after expiry the key is new, so the stale If-Match is a conflict",
    );
    // Later writes sweep expired keys.
    const keys = async () =>
      (await server.query("SELECT key FROM idempotency_keys ORDER BY key")).rows.map((row) => row.key);
    assert.deepEqual(await keys(), ["timed"]);
    assert.equal((await save(server, token, published.id, mine, 2, "later")).status, 200);
    assert.deepEqual(await keys(), ["later"]);
  } finally {
    await server.close();
  }
});

test("a save conflict returns the current head's version and source", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Head</h1>"), "conflict-head");
    assert.equal((await save(server, token, published.id, edit(published.source, "First"), 1)).status, 200);
    const stale = await save(server, token, published.id, edit(published.source, "Second"), 1);
    assert.equal(stale.status, 409);
    const body = (await stale.json()) as SaveConflict;
    const current = await head(server, token, published.id);
    assert.equal(typeof body.error, "string");
    assert.equal(body.version, current.version);
    assert.equal(body.source, current.source);
  } finally {
    await server.close();
  }
});

test("comments and replies with an Idempotency-Key are created once", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Notes</h1>"), "idem-comments");
    const nodeId = /<h1 data-af-id="([^"]+)">/.exec(published.source)![1]!;
    const draft = { nodeId, quote: "Notes", body: "Rename" };
    const first = await comment(server, token, published.id, draft, "c-1");
    assert.equal(first.status, 201);
    const created = (await first.json()) as CommentRecord;
    const again = await comment(server, token, published.id, draft, "c-1");
    assert.equal(again.status, 201);
    assert.deepEqual(await again.json(), created);

    // The comment changes; the replay still returns the original response.
    const resolved = await server.request(`/api/files/${published.id}/comments/${created.id}`, {
      method: "PUT",
      token,
      body: { resolved: true },
      headers: { "If-Match": String(created.revision) },
    });
    assert.equal(resolved.status, 200);
    assert.deepEqual(await (await comment(server, token, published.id, draft, "c-1")).json(), created);

    assert.equal((await comment(server, token, published.id, { ...draft, body: "Other" }, "c-1")).status, 422);

    const reply = { nodeId, quote: "", body: "Done", parentId: created.id };
    const replies = await Promise.all([1, 2, 3].map(() => comment(server, token, published.id, reply, "r-1")));
    assert.deepEqual(replies.map((r) => r.status), [201, 201, 201]);
    const replyBodies = (await Promise.all(replies.map((r) => r.json()))) as CommentRecord[];
    for (const body of replyBodies) assert.deepEqual(body, replyBodies[0]);
    assert.equal(replyBodies[0]!.parentId, created.id);

    const list = await comments(server, token, published.id);
    assert.deepEqual(list.comments.map((c) => c.id), [created.id, replyBodies[0]!.id]);

    // Without a key, the same comment twice is two comments, as before.
    await comment(server, token, published.id, draft);
    await comment(server, token, published.id, draft);
    assert.equal((await comments(server, token, published.id)).comments.length, 4);
  } finally {
    await server.close();
  }
});

test("comment edits and resolves need the current revision", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Edits</h1>"), "comment-edits");
    const created = (await (await comment(server, token, published.id, { nodeId: null, quote: "", body: "One" })).json()) as CommentRecord;
    const change = (body: Record<string, unknown>, ifMatch?: string) =>
      server.request(`/api/files/${published.id}/comments/${created.id}`, {
        method: "PUT",
        token,
        body,
        headers: ifMatch === undefined ? {} : { "If-Match": ifMatch },
      });
    assert.equal((await change({ body: "Two" })).status, 428);
    const edited = await change({ body: "Two" }, `"${created.revision}"`);
    assert.equal(edited.status, 200);
    const next = (await edited.json()) as CommentRecord;
    assert.equal(next.body, "Two");
    assert.equal(next.revision, created.revision + 1);
    assert.equal((await change({ body: "Stale" }, String(created.revision))).status, 409);
    assert.equal((await change({ resolved: true }, String(created.revision))).status, 409);
    const resolved = await change({ resolved: true }, String(next.revision));
    assert.equal(resolved.status, 200);
    const list = await comments(server, token, published.id);
    assert.equal(list.comments[0]!.body, "Two");
    assert.equal(list.comments[0]!.resolved, true);
  } finally {
    await server.close();
  }
});

test("polling with since returns each new or changed comment once", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, page("<h1>Watch</h1>"), "comment-watch");
    const start = await comments(server, token, published.id);
    assert.deepEqual(start.comments, []);
    assert.equal(typeof start.cursor, "string");

    const a = (await (await comment(server, token, published.id, { nodeId: null, quote: "", body: "A" })).json()) as CommentRecord;
    const b = (await (await comment(server, token, published.id, { nodeId: null, quote: "", body: "B", parentId: a.id })).json()) as CommentRecord;
    const first = await comments(server, token, published.id, start.cursor);
    assert.deepEqual(first.comments.map((c) => c.id), [a.id, b.id]);
    assert.equal(first.head, 1);

    const quiet = await comments(server, token, published.id, first.cursor);
    assert.deepEqual(quiet.comments, []);
    assert.equal(quiet.cursor, first.cursor, "nothing new keeps the cursor");

    await server.request(`/api/files/${published.id}/comments/${a.id}`, {
      method: "PUT",
      token,
      body: { resolved: true },
      headers: { "If-Match": String(a.revision) },
    });
    const c = (await (await comment(server, token, published.id, { nodeId: null, quote: "", body: "C" })).json()) as CommentRecord;
    const second = await comments(server, token, published.id, first.cursor);
    assert.deepEqual(second.comments.map((x) => [x.id, x.resolved]), [[a.id, true], [c.id, false]]);
    assert.deepEqual((await comments(server, token, published.id, second.cursor)).comments, []);

    // The full list keeps creation order and carries the latest cursor.
    const all = await comments(server, token, published.id);
    assert.deepEqual(all.comments.map((x) => x.id), [a.id, b.id, c.id]);
    assert.equal(all.cursor, second.cursor);

    for (const bad of ["", "nope", "12"])
      assert.equal(
        (await server.request(`/api/files/${published.id}/comments?since=${encodeURIComponent(bad)}`, { token })).status,
        400,
      );
  } finally {
    await server.close();
  }
});

const BACKEND = "export const typeDefs = 'type Query { hello: String }';\nexport default { Query: {} };\n";

test("the owner deletes a page: every route for its ID is 404 and linked backend files stay", async () => {
  const server = await startServer({ backendHost: compileOnlyHost() });
  try {
    const owner = await server.token("owner@example.test");
    const editor = await server.token("editor@example.test");
    const stranger = await server.token("stranger@example.test");
    const reserve = await server.request("/api/ids", {
      token: owner,
      body: { count: 2 },
      headers: { "Idempotency-Key": "delete-ids" },
    });
    const [pageId, backendId] = ((await reserve.json()) as { ids: string[] }).ids as [string, string];
    const source = page(
      `<h1>Doomed</h1>`,
      `  <script type="application/json" data-af="meta">{"id":"${pageId}"}</script>\n` +
        `  <script type="application/json" data-af="state">{"todos":[]}</script>\n` +
        `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${backendId}" data-af-name="api">\n`,
    );
    const created = await server.request("/api/publish", {
      token: owner,
      body: { source, files: { [backendId]: BACKEND }, requestId: "doomed" },
    });
    const published = (await created.json()) as PublishResponse & { error?: string };
    assert.equal(created.status, 201, published.error);
    assert.equal(published.id, pageId);

    // Versions, comments with page state, and an editor.
    const saved = (await (await save(server, owner, pageId, edit(published.source, "v2"), 1, "k")).json()) as SaveResponse;
    assert.equal(saved.version, 2);
    const note = await comment(server, owner, pageId, { nodeId: null, quote: "", body: "Bye", version: 1, state: { todos: [1] } }, "ck");
    assert.equal(note.status, 201);
    const sharing = (await (await server.request(`/api/files/${pageId}/sharing`, { token: owner })).json()) as {
      policy: { version: number };
    };
    const shared = await server.request(`/api/files/${pageId}/sharing`, {
      method: "PUT",
      token: owner,
      body: { email: "editor@example.test", role: "editor" },
      headers: { "If-Match": String(sharing.policy.version) },
    });
    assert.equal(shared.status, 200);
    assert.equal((await server.request(`/api/files/${pageId}/source`, { token: editor })).status, 200);

    const remove = (token?: string) =>
      server.request(`/api/files/${pageId}`, { method: "DELETE", ...(token ? { token } : {}) });
    assert.equal((await remove()).status, 401, "no token is a sign-in problem, not a page answer");
    assert.equal((await remove(editor)).status, 404, "an editor is not the owner");
    assert.equal((await remove(stranger)).status, 404);
    assert.equal((await server.request(`/api/files/${pageId}/source`, { token: owner })).status, 200, "still there");

    const deleted = await remove(owner);
    assert.equal(deleted.status, 200);
    assert.deepEqual((await deleted.json()) as DeleteResponse, { id: pageId, deleted: true });

    for (const path of [
      `/api/files/${pageId}/source`,
      `/api/files/${pageId}/comments`,
      `/api/files/${pageId}/sharing`,
      `/af/v1/ids/${pageId}`,
      `/af/v1/ids/${pageId}?download=1`,
    ])
      assert.equal((await server.request(path, { token: owner })).status, 404, path);
    assert.equal((await save(server, owner, pageId, saved.source, 2)).status, 404);
    assert.equal((await remove(owner)).status, 404, "a second delete finds nothing");
    const { entries } = (await (await server.request("/api/paths", { token: owner })).json()) as {
      entries: { fileId: string | null }[];
    };
    assert.ok(!entries.some((e) => e.fileId === pageId), "the page left its path");

    // The backend file is its own file: still published, still its owner's.
    const backend = await server.request(`/af/v1/ids/${backendId}`, { token: owner });
    assert.equal(backend.status, 200);
    assert.equal(((await backend.json()) as { kind: string }).kind, "backend");
    // Backend links remain with retained page history for restoration.
    for (const table of ["af_page_backends", "af_backend_pages"]) {
      const { rows } = await server.query(`SELECT 1 FROM ${table} WHERE page_id = $1`, [pageId]);
      assert.ok(rows.length > 0, `${table} retains the deleted page`);
    }

    // The deleted ID in a meta block is refused like any ID that is not an unpublished reservation.
    const stale = await server.request("/api/publish", { token: owner, body: { source, requestId: "doomed-stale" } });
    assert.equal(stale.status, 422);
    assert.match(((await stale.json()) as { error: string }).error, new RegExp(pageId));
    // A retained publish key cannot return the trashed source or silently create a new ID.
    const again = await server.request('/api/publish', {token:owner,body:{source,files:{[backendId]:BACKEND},requestId:'doomed'}});
    assert.equal(again.status,404);

  } finally {
    await server.close();
  }
});

test("a deleted page's ID is never given to another file", async () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const script = ["Gone01", "Gone01", "Next02"];
  let spare = 0;
  const randomBytes = (count: number) => {
    const id = script.shift() ?? `Spar${String(spare++).padStart(2, "0")}`;
    assert.equal(count, 6);
    return Uint8Array.from([...id].map((ch) => alphabet.indexOf(ch)));
  };
  const server = await startServer({ randomBytes });
  try {
    const token = await server.token();
    const first = await publish(server, token, page("<p>First</p>"), "first");
    assert.equal(first.id, "Gone01");
    assert.equal((await server.request(`/api/files/${first.id}`, { method: "DELETE", token })).status, 200);
    const second = await publish(server, token, page("<p>Second</p>"), "second");
    assert.equal(second.id, "Next02", "the generator's repeat of the deleted ID was skipped");
  } finally {
    await server.close();
  }
});
