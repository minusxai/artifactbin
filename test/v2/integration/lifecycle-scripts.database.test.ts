/**
 * Integration: publish.mjs and comments.mjs, run as built, against a real
 * server and database. Edge cases live in the pure model's unit tests; these
 * check that the real routes give the scripts what they rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishJson } from "../../../src/af-script/lifecycle-contracts.ts";
import type { CommentsResponse, SourceResponse } from "../../../src/server/af-api-contracts.ts";
import { repositoryPath } from "../support/load.ts";
import { skillFile } from "../support/skill.ts";

/** The todo example without its backend link: these tests are about the page's lifecycle, not backends. */
const TODO_PAGE = skillFile("examples/todo.html").replace(/\n\s*<link rel="af-backend"[^>]*>/, "");
import { startServer, type TestServer } from "../support/server.ts";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "af-lifecycle-"));
  cpSync(repositoryPath("skills/pagegi-author/scripts"), join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "home"));
  const dir = (name: string) => {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const run = (
    script: "publish" | "comments",
    args: string[],
    cwd: string,
    env: Record<string, string>,
    until?: (stdout: string) => boolean,
  ): Promise<Run> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "scripts", `${script}.mjs`), ...args], {
        cwd,
        env: { PATH: process.env.PATH ?? "", HOME: join(root, "home"), ...env },
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (until?.(stdout)) child.kill("SIGINT");
      });
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  return { dir, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const publishJson = (result: Run) => JSON.parse(result.stdout) as PublishJson;

async function head(server: TestServer, token: string, id: string): Promise<SourceResponse> {
  return (await (await server.request(`/api/files/${id}/source`, { token })).json()) as SourceResponse;
}
async function share(server: TestServer, token: string, id: string, email: string, role: string) {
  const response = await server.request(`/api/files/${id}/sharing`, {
    method: "PUT",
    token,
    body: { email, role },
    headers: { "If-Match": "1" },
  });
  assert.equal(response.status, 200);
}

/** A proxy that forwards each request to the server but drops the connection as soon as the answer starts. */
async function droppingProxy(target: string): Promise<{ origin: string; dropped: string[]; close(): Promise<void> }> {
  const { hostname, port } = new URL(target);
  const dropped: string[] = [];
  const proxy: Server = createServer((client) => {
    const upstream = connect(Number(port), hostname);
    client.on("data", (chunk) => upstream.write(Buffer.from(String(chunk).replace(/^host: .*$/im, `host: ${hostname}:${port}`))));
    upstream.once("data", (chunk) => {
      dropped.push(String(chunk).split("\r\n")[0]!);
      client.destroy();
      upstream.destroy();
    });
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${address.port}`,
    dropped,
    close: () => new Promise((resolve) => proxy.close(() => resolve())),
  };
}

test("two clients on one page: a clean merge saves both edits; an overlap is left for the agent", async () => {
  const server = await startServer();
  const ws = workspace();
  try {
    const alice = { AF_SERVER: server.origin, AF_TOKEN: await server.token("alice@example.test") };
    const bob = { AF_SERVER: server.origin, AF_TOKEN: await server.token("bob@example.test") };
    const a = ws.dir("a"),
      b = ws.dir("b");
    writeFileSync(join(a, "page.html"), TODO_PAGE);
    const created = publishJson(await ws.run("publish", ["page.html", "--json"], a, alice));
    assert.equal(created.status, "created", created.message);
    await share(server, alice.AF_TOKEN, created.id!, "bob@example.test", "editor");
    writeFileSync(join(b, "page.html"), readFileSync(join(a, "page.html"), "utf8"));
    assert.equal((await ws.run("publish", ["page.html", "--pull"], b, bob)).code, 0);

    const edit = (dir: string, from: string, to: string) =>
      writeFileSync(join(dir, "page.html"), readFileSync(join(dir, "page.html"), "utf8").replace(from, to));
    edit(a, ">Team todo list<", ">Alice's list<");
    edit(b, ">Add<", ">Add task<");
    const [first, second] = await Promise.all([
      ws.run("publish", ["page.html", "--json"], a, alice),
      ws.run("publish", ["page.html", "--json"], b, bob),
    ]);
    const statuses = [publishJson(first).status, publishJson(second).status].sort();
    assert.deepEqual(statuses, ["merged", "saved"], first.stdout + second.stdout);
    const loser = publishJson(first).status === "merged" ? { dir: a, env: alice } : { dir: b, env: bob };
    const rerun = publishJson(await ws.run("publish", ["page.html", "--json"], loser.dir, loser.env));
    assert.equal(rerun.status, "saved", rerun.message);
    assert.equal(rerun.version, 3);
    const merged = await head(server, alice.AF_TOKEN, created.id!);
    assert.match(merged.source, /<h1 data-af-id="n1">Alice's list<\/h1>/);
    assert.match(merged.source, /<button data-af-id="n4">Add task<\/button>/);

    // Both change the heading: the second gets the head and a diff, and exit 4.
    for (const { dir, env } of [{ dir: a, env: alice }, { dir: b, env: bob }])
      assert.equal((await ws.run("publish", ["page.html", "--pull"], dir, env)).code, 0);
    edit(a, ">Alice's list<", ">Ours<");
    edit(b, ">Alice's list<", ">Theirs<");
    assert.equal((await ws.run("publish", ["page.html"], a, alice)).code, 0);
    const local = readFileSync(join(b, "page.html"), "utf8");
    const conflict = await ws.run("publish", ["page.html", "--json"], b, bob);
    assert.equal(conflict.code, 4, conflict.stdout);
    assert.equal(readFileSync(join(b, "page.html"), "utf8"), local);
    assert.equal(readFileSync(join(b, "page.remote.html"), "utf8"), (await head(server, bob.AF_TOKEN, created.id!)).source);
    assert.match(readFileSync(join(b, "page.conflict.diff"), "utf8"), /\+  <h1 data-af-id="n1">Theirs<\/h1>[\s\S]*\+  <h1 data-af-id="n1">Ours<\/h1>/);
    edit(b, ">Theirs<", ">Ours and theirs<");
    const resolved = publishJson(await ws.run("publish", ["page.html", "--json"], b, bob));
    assert.equal(resolved.status, "saved", resolved.message);
    assert.equal(existsSync(join(b, "page.remote.html")), false);
  } finally {
    ws.cleanup();
    await server.close();
  }
});

test("an uncertain create and an uncertain save are replayed: one page, one new version", async () => {
  const server = await startServer();
  const proxy = await droppingProxy(server.origin);
  const ws = workspace();
  try {
    const token = await server.token("agent@example.test");
    const dropped = { AF_SERVER: proxy.origin, AF_TOKEN: token };
    const direct = { AF_SERVER: server.origin, AF_TOKEN: token };
    const dir = ws.dir("page");
    writeFileSync(join(dir, "page.html"), TODO_PAGE);
    const lost = await ws.run("publish", ["page.html", "--json"], dir, dropped);
    assert.equal(lost.code, 5, lost.stdout);
    assert.deepEqual(proxy.dropped, ["HTTP/1.1 201 Created", "HTTP/1.1 200 OK", "HTTP/1.1 200 OK"]);
    const created = publishJson(await ws.run("publish", ["page.html", "--json"], dir, direct));
    assert.equal(created.status, "created", created.message);
    const paths = (await (await server.request("/api/paths", { token })).json()) as { entries: { fileId: string | null }[] };
    assert.equal(paths.entries.filter((entry) => entry.fileId).length, 1, "never created twice");

    writeFileSync(join(dir, "page.html"), readFileSync(join(dir, "page.html"), "utf8").replace(">Team todo list<", ">Renamed<"));
    proxy.dropped.length = 0;
    const unknown = await ws.run("publish", ["page.html"], dir, dropped);
    assert.equal(unknown.code, 5, unknown.stderr);
    assert.deepEqual(proxy.dropped, ["HTTP/1.1 200 OK", "HTTP/1.1 200 OK", "HTTP/1.1 200 OK"]);
    assert.equal((await head(server, token, created.id!)).version, 2, "applied once although sent three times");
    const replayed = publishJson(await ws.run("publish", ["page.html", "--json"], dir, direct));
    assert.equal(replayed.status, "saved", replayed.message);
    assert.equal(replayed.version, 2);
    assert.equal(readFileSync(join(dir, "page.html"), "utf8"), (await head(server, token, created.id!)).source);
  } finally {
    ws.cleanup();
    await proxy.close();
    await server.close();
  }
});

test("--pull backs up local edits, --new forks, --delete --yes removes the page and its records", async () => {
  const server = await startServer();
  const ws = workspace();
  try {
    const owner = { AF_SERVER: server.origin, AF_TOKEN: await server.token("owner@example.test") };
    const other = { AF_SERVER: server.origin, AF_TOKEN: await server.token("other@example.test") };
    const a = ws.dir("a"),
      c = ws.dir("c");
    writeFileSync(join(a, "page.html"), TODO_PAGE);
    const { id } = publishJson(await ws.run("publish", ["page.html", "--json"], a, owner));
    const original = readFileSync(join(a, "page.html"), "utf8");
    const saved = await server.request(`/api/files/${id}/source`, {
      method: "PUT",
      token: owner.AF_TOKEN,
      body: { source: original.replace(">Team todo list<", ">Remote<") },
      headers: { "If-Match": "1" },
    });
    assert.equal(saved.status, 200);
    const mine = original.replace(">Add<", ">Mine<");
    writeFileSync(join(a, "page.html"), mine);
    const pulled = publishJson(await ws.run("publish", ["page.html", "--pull", "--json"], a, owner));
    assert.equal(pulled.status, "pulled", pulled.message);
    assert.equal(readFileSync(join(a, pulled.backups[0]!), "utf8"), mine);
    assert.match(readFileSync(join(a, "page.html"), "utf8"), />Remote</);

    writeFileSync(join(c, "page.html"), readFileSync(join(a, "page.html"), "utf8"));
    const refused = await ws.run("publish", ["page.html"], c, other);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--new/);
    const fork = publishJson(await ws.run("publish", ["page.html", "--new", "--json"], c, other));
    assert.equal(fork.status, "forked", fork.message);
    assert.notEqual(fork.id, id);
    assert.match(readFileSync(join(c, "page.html"), "utf8"), /<h1 data-af-id="n1">Remote<\/h1>/);

    assert.equal((await ws.run("publish", ["page.html", "--delete"], a, owner)).code, 2, "refused without --yes");
    assert.equal((await ws.run("publish", ["page.html", "--delete", "--yes"], c, { ...other, AF_TOKEN: "expired" })).code, 2);
    assert.ok(existsSync(join(c, ".af", "base", `${fork.id}.html`)), "a 401 never clears .af/");
    const deleted = publishJson(await ws.run("publish", ["page.html", "--delete", "--yes", "--json"], a, owner));
    assert.equal(deleted.status, "deleted", deleted.message);
    assert.equal((await server.request(`/api/files/${id}/source`, { token: owner.AF_TOKEN })).status, 404);
    assert.deepEqual(readdirSync(join(a, ".af", "base")), []);
  } finally {
    ws.cleanup();
    await server.close();
  }
});

test("comments: a reply, a stale resolve, and --watch resuming after a restart without repeats", async () => {
  const server = await startServer();
  const ws = workspace();
  try {
    const owner = { AF_SERVER: server.origin, AF_TOKEN: await server.token("owner@example.test") };
    const dir = ws.dir("page");
    writeFileSync(join(dir, "page.html"), TODO_PAGE);
    const { id } = publishJson(await ws.run("publish", ["page.html", "--json"], dir, owner));
    const reviewer = await server.token("reviewer@example.test");
    await share(server, owner.AF_TOKEN, id!, "reviewer@example.test", "commenter");
    const post = async (body: Record<string, unknown>) => {
      const response = await server.request(`/api/files/${id}/comments`, { token: reviewer, body: { comment: { quote: "", ...body } } });
      assert.equal(response.status, 201);
      return (await response.json()) as { id: string; revision: number };
    };
    const first = await post({ nodeId: "n1", body: "Rename this?" });

    const lines = (run: Run) => run.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { event: string; comment: { id: string } });
    const watched = await ws.run("comments", ["page.html", "--watch", "--json"], dir, owner, (out) => out.includes("\n"));
    assert.deepEqual(lines(watched).map((line) => [line.event, line.comment.id]), [["comment", first.id]]);

    const reply = await ws.run("comments", ["page.html", "--reply", first.id, "--body", "Done."], dir, owner);
    assert.equal(reply.code, 0, reply.stderr);
    const edited = await server.request(`/api/files/${id}/comments/${first.id}`, {
      method: "PUT",
      token: reviewer,
      body: { body: "Rename this, please?" },
      headers: { "If-Match": String(first.revision) },
    });
    assert.equal(edited.status, 200);
    const stale = await ws.run("comments", ["page.html", "--resolve", first.id], dir, owner);
    assert.equal(stale.code, 4, stale.stderr);
    assert.match(stale.stderr, /changed since you read it/);
    const second = await post({ nodeId: "n2", body: "And the button?" });

    // Stopped once the newest change shows: anything repeated would come before it.
    const resumed = await ws.run("comments", ["page.html", "--watch", "--json"], dir, owner, (out) => out.includes(second.id));
    assert.deepEqual(
      lines(resumed).map((line) => [line.event, line.comment.id]),
      [["comment", second.id]],
      "the reply was the agent's own, and the stale resolve already showed the edit",
    );
    const list = (await (await server.request(`/api/files/${id}/comments`, { token: owner.AF_TOKEN })).json()) as CommentsResponse;
    assert.equal(list.comments.filter((comment) => comment.parentId === first.id).length, 1);
  } finally {
    ws.cleanup();
    await server.close();
  }
});
