/**
 * comments.mjs as a pure model (src/af-script/comments-model.ts) over an
 * in-memory file system and a fake server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommentsAction } from "../../../src/af-script/af-contracts.ts";
import type { LifecyclePorts } from "../../../src/af-script/lifecycle-contracts.ts";
import { runComments } from "../../../src/af-script/comments-model.ts";
import { publishPage } from "../../../src/af-script/publish-model.ts";
import { FakeServer, MemoryFs, ORIGIN, fakePorts, page } from "../support/lifecycle-fakes.ts";

async function setup() {
  const server = new FakeServer();
  const fs = new MemoryFs();
  const { ports, sleeps } = fakePorts(server, fs);
  const env = { AF_TOKEN: server.token("alice"), AF_SERVER: ORIGIN };
  fs.files.set("/work/page.html", page("<h1>Plan</h1>\n<p>Budget</p>"));
  const id = (await publishPage("page.html", "publish", { env, cwd: "/work", ports })).json.id!;
  server.pages.get(id)!.editors.add("bob");
  const run = async (action: CommentsAction, options: { json?: boolean; target?: string; ports?: Partial<LifecyclePorts> } = {}) => {
    const out = { stdout: "", stderr: "" };
    const code = await runComments(options.target ?? "page.html", action, options.json ?? false, {
      env,
      cwd: "/work",
      ports: { ...ports, ...options.ports },
      stdout: (text) => (out.stdout += text),
      stderr: (text) => (out.stderr += text),
    });
    return { code, ...out };
  };
  return { server, fs, id, run, sleeps, ports };
}

test("the default lists threads with their replies, by page file or by ID", async () => {
  const { server, id, run } = await setup();
  server.comment("bob", id, { nodeId: "n2", body: "Too low?" });
  server.comment("alice", id, { nodeId: "n2", body: "Raised it.", parentId: "c1" });
  const listed = await run({ kind: "list" });
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stdout, `c1 on n2 by bob, version 1, revision 1\n  Too low?\n  reply c2 by alice, revision 1: Raised it.\n`);
  const json = await run({ kind: "list" }, { json: true, target: id });
  assert.deepEqual(
    JSON.parse(json.stdout).threads.map((thread: { id: string; replies: { id: string }[] }) => [thread.id, thread.replies.map((reply) => reply.id)]),
    [["c1", ["c2"]]],
  );
});

test("a reply whose outcome is unknown is resent with the same key and posted once", async () => {
  const { server, id, run, fs } = await setup();
  server.comment("bob", id, { nodeId: "n2", body: "Too low?" });
  server.fail((request) => request.method === "POST", "error-after", "error-before", "error-before");
  const lost = await run({ kind: "reply", commentId: "c1", body: "Raised it." });
  assert.equal(lost.code, 5);
  assert.match(lost.stderr, /Run the same command again/);
  assert.equal(fs.under("/work/.af/journal").length, 1);
  const rerun = await run({ kind: "reply", commentId: "c1", body: "Raised it." });
  assert.equal(rerun.code, 0, rerun.stderr);
  const replies = server.comments.get(id)!.filter((comment) => comment.parentId === "c1");
  assert.equal(replies.length, 1, "posted once");
  assert.equal(replies[0]!.nodeId, "n2", "a reply is on its thread's element");
  const keys = server.requests("POST", /\/comments$/).map((request) => request.headers["Idempotency-Key"]);
  assert.equal(new Set(keys).size, 1);
  assert.deepEqual(fs.under("/work/.af/journal"), []);
});

test("resolving sends the revision the agent saw; a changed comment exits 4 and shows the change", async () => {
  const { server, id, run } = await setup();
  server.comment("bob", id, { nodeId: "n2", body: "Too low?" });
  await run({ kind: "list" });
  const comment = server.comments.get(id)![0]!;
  comment.body = "Too low? Make it 20.";
  comment.revision = 2;
  const stale = await run({ kind: "resolve", commentId: "c1", resolved: true });
  assert.equal(stale.code, 4);
  assert.match(stale.stderr, /you saw revision 1; it is now revision 2\): Too low\? Make it 20\./);
  assert.match(stale.stderr, /may be your own earlier attempt/, "a rerun after no answer finds its own change");
  assert.equal(server.requests("PUT", /\/comments\/c1$/)[0]!.headers["If-Match"], "1");
  const resolved = await run({ kind: "resolve", commentId: "c1", resolved: true });
  assert.equal(resolved.code, 0, resolved.stderr);
  assert.equal(comment.resolved, true);
  assert.match(resolved.stdout, /Resolved c1/);
});

test("--context writes what the commenter saw to a file and prints its path", async () => {
  const { server, id, run, fs } = await setup();
  server.comment("bob", id, { nodeId: "n2", body: "Too low?" });
  const shown = await run({ kind: "context", commentId: "c1" });
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /\.af\/context\/c1\.html/);
  assert.equal(fs.files.get("/work/.af/context/c1.html"), server.head(id).source);
  assert.equal(fs.files.get("/work/.af/context/c1.state.json"), '{\n  "todos": []\n}\n');
  assert.match(shown.stdout, new RegExp(`Open it with that state: ${ORIGIN}/a/${id}#af-state=eyJ0b2RvcyI6W119\n`));
  const json = await run({ kind: "context", commentId: "c1" }, { json: true });
  assert.equal(json.code, 0, json.stderr);
  const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
  assert.equal(parsed.url, `${ORIGIN}/a/${id}#af-state=eyJ0b2RvcyI6W119`, "the address field is named url, as in the HTTP API");
  assert.equal("address" in parsed, false);
  assert.equal(parsed.source, ".af/context/c1.html");
});

test("a server that answers 404 to the API and the session route is not an Artifactbin server: exit 2 naming AF_SERVER", async () => {
  const { fs } = await setup();
  const out = { stdout: "", stderr: "" };
  const code = await runComments("page.html", { kind: "list" }, false, {
    env: { AF_TOKEN: "t", AF_SERVER: "https://example.invalid" },
    cwd: "/work",
    ports: { ...fakePorts(new FakeServer(), fs).ports, fetch: async () => ({ status: 404, json: async () => ({ error: "not_found" }) }) },
    stdout: (text) => (out.stdout += text),
    stderr: (text) => (out.stderr += text),
  });
  assert.equal(code, 2);
  assert.match(out.stderr, /https:\/\/example\.invalid does not look like an Artifactbin server/);
  assert.match(out.stderr, /AF_SERVER/);
});

test("--watch prints each change once, survives errors, and resumes after a restart without repeats", async () => {
  for (const cursors of [true, false]) {
    const { server, id, run } = await setup();
    server.cursors = cursors;
    server.comment("bob", id, { nodeId: "n2", body: "Too low?" });
    let polls = 0;
    const watch = (limit: number) => {
      polls = 0;
      const controller = new AbortController();
      return run(
        { kind: "watch" },
        {
          json: true,
          ports: {
            signal: controller.signal,
            // Only the waits between polls count; retries inside one request wait without a signal.
            sleep: async (_ms, signal) => {
              if (signal && ++polls >= limit) controller.abort();
            },
          },
        },
      );
    };
    const first = await watch(1);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.stdout.trim().split("\n").map((line) => JSON.parse(line).event), ["comment"]);

    // Changes while stopped, then a transient error on the first poll after the restart.
    server.comment("alice", id, { nodeId: "n2", body: "Raised it.", parentId: "c1" });
    const comment = server.comments.get(id)![0]!;
    comment.resolved = true;
    comment.revision = 2;
    comment.sequence = ++server.sequence;
    server.fail((request) => request.method === "GET" && request.path.includes("/comments"), "error-before", "error-before", "error-before");
    const second = await watch(3);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stderr, /Retrying in 4s/);
    const events = second.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => [event.event, event.comment.id]).sort(), [["reply", "c2"], ["resolved", "c1"]], `cursors: ${cursors}`);
  }
});
