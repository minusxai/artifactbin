/**
 * publish.mjs as a pure model (src/af-script/publish-model.ts) over an
 * in-memory file system and a fake server with the documented semantics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublishMode } from "../../../src/af-script/af-contracts.ts";
import type { PublishJournal } from "../../../src/af-script/lifecycle-contracts.ts";
import { publishPage } from "../../../src/af-script/publish-model.ts";
import { assignNodeIds } from "../../../src/page/page-model.ts";
import { FakeServer, MemoryFs, ORIGIN, fakePorts, page } from "../support/lifecycle-fakes.ts";

const DIR = "/work";
const FILE = "/work/page.html";

function agent(server: FakeServer, account = "alice", dir = DIR, fs = new MemoryFs()) {
  const { ports, sleeps } = fakePorts(server, fs);
  const env = { AF_TOKEN: server.token(account), AF_SERVER: ORIGIN + "/" };
  const file = `${dir}/page.html`;
  return {
    fs,
    sleeps,
    file,
    read: () => fs.files.get(file)!,
    write: (text: string) => fs.files.set(file, text),
    edit: (change: (source: string) => string) => fs.files.set(file, change(fs.files.get(file)!)),
    publish: (mode: PublishMode = "publish", visibility?: import("../../../src/contracts.ts").Visibility) => publishPage("page.html", mode, { env, cwd: dir, ports, visibility }),
    sidecar: () => fs.under(`${dir}/.af`),
  };
}
const meta = (source: string) => JSON.parse(/data-af="meta">([\s\S]*?)<\/script>/.exec(source)![1]!) as Record<string, unknown>;
/** Let a request that will never be answered get as far as the server. */
async function settle() {
  for (let index = 0; index < 20; index++) await new Promise((resolve) => setImmediate(resolve));
}

test("a new page is published, and the file and base become the saved source", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const outcome = await a.publish();
  assert.equal(outcome.code, 0, outcome.json.message);
  assert.equal(outcome.json.status, "created");
  const id = outcome.json.id!;
  assert.equal(a.read(), server.head(id).source);
  assert.equal(meta(a.read()).version, 1);
  assert.match(a.read(), /<h1 data-af-id="n1">Plan<\/h1>/);
  assert.match(a.read(), new RegExp(`${ORIGIN}/af/v1/core.js`), "hosts are rewritten to the server");
  assert.deepEqual(a.sidecar(), [`base/${id}.html`], "the journal is gone once the outcome is known");
  assert.equal(a.fs.files.get(`${DIR}/.af/base/${id}.html`), a.read());
  assert.deepEqual(outcome.json.wrote, ["page.html"]);
  assert.equal(outcome.json.url, `${ORIGIN}/a/${id}`);
  const [request] = server.requests("POST", /^\/api\/publish$/);
  assert.equal(request!.body!.requestId, "key-1");
});

test("an unchanged page makes no request; a changed one saves with If-Match and an Idempotency-Key", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const id = (await a.publish()).json.id!;
  const before = server.log.length;
  const unchanged = await a.publish();
  assert.equal(unchanged.code, 0);
  assert.equal(unchanged.json.status, "unchanged");
  assert.equal(server.log.length, before, "no request");

  a.edit((source) => source.replace("</h1>", "</h1>\n<p>Step one</p>"));
  const saved = await a.publish();
  assert.equal(saved.code, 0, saved.json.message);
  assert.equal(saved.json.status, "saved");
  assert.equal(saved.json.version, 2);
  const [put] = server.requests("PUT", /\/source$/);
  assert.equal(put!.headers["If-Match"], "1");
  assert.ok(put!.headers["Idempotency-Key"]);
  assert.equal(a.read(), server.head(id).source);
  assert.match(a.read(), /<p data-af-id="n2">Step one<\/p>/);
});

test("a crash between the journal and the request replays the same requestId: one page", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  server.fail((request) => request.path === "/api/publish", "hang-before");
  void a.publish();
  await settle();
  const journal = JSON.parse(a.fs.files.get(`${DIR}/.af/journal/new-page.html.json`)!) as PublishJournal;
  assert.equal(journal.kind, "create");
  assert.equal(journal.body.requestId, journal.key);
  assert.equal(server.pages.size, 0);

  const rerun = await a.publish();
  assert.equal(rerun.code, 0, rerun.json.message);
  assert.equal(server.pages.size, 1);
  assert.deepEqual(
    server.requests("POST", /^\/api\/publish$/).map((request) => request.body!.requestId),
    [journal.key, journal.key],
  );
  assert.match(rerun.json.message, /Resolved the earlier publish/);
  assert.equal(a.read(), server.head(rerun.json.id!).source);
});

test("a crash after the server answered, before write-back, gets the first result on rerun", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  server.fail((request) => request.path === "/api/publish", "hang-after");
  void a.publish();
  await settle();
  assert.equal(server.pages.size, 1, "the server created it");
  assert.doesNotMatch(a.read(), /"id"/, "but the file never heard");
  const rerun = await a.publish();
  assert.equal(rerun.code, 0, rerun.json.message);
  assert.equal(server.pages.size, 1, "never created twice");
  assert.equal(a.read(), server.head(rerun.json.id!).source);
});

test("a full disk while writing the page back keeps the journal, so the rerun resolves the same page", async () => {
  const server = new FakeServer();
  class FullDisk extends MemoryFs {
    failing: string | null = FILE;
    override async write(path: string, text: string, options?: { private?: boolean }) {
      if (path === this.failing) {
        this.failing = null;
        throw Error("ENOSPC: no space left on device");
      }
      return super.write(path, text, options);
    }
  }
  const a = agent(server, "alice", DIR, new FullDisk());
  a.write(page("<h1>Plan</h1>"));
  await assert.rejects(a.publish(), /ENOSPC/);
  assert.equal(server.pages.size, 1, "the server created it");
  assert.ok(a.sidecar().includes("journal/new-page.html.json"), "the journal outlives a failed write-back");
  const rerun = await a.publish();
  assert.equal(rerun.code, 0, rerun.json.message);
  assert.equal(server.pages.size, 1, "never created twice");
  assert.equal(new Set(server.requests("POST", /^\/api\/publish$/).map((request) => request.body!.requestId)).size, 1);
  assert.equal(a.read(), server.head(rerun.json.id!).source);
  assert.deepEqual(a.sidecar(), [`base/${rerun.json.id}.html`]);
});

test("a 2xx answer without the saved page keeps the journal, so the rerun resolves the same page", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  server.fail((request) => request.path === "/api/publish", "garbled-after");
  const first = await a.publish();
  assert.notEqual(first.code, 0);
  assert.match(first.json.message, /no page source, version and ID.*Run publish\.mjs page\.html again/s);
  assert.equal(server.pages.size, 1, "the server created it");
  assert.ok(a.sidecar().includes("journal/new-page.html.json"), "the journal outlives a garbled answer");
  const rerun = await a.publish();
  assert.equal(rerun.code, 0, rerun.json.message);
  assert.match(rerun.json.message, /Resolved the earlier publish/);
  assert.equal(server.pages.size, 1, "never created twice");
  assert.equal(new Set(server.requests("POST", /^\/api\/publish$/).map((request) => request.body!.requestId)).size, 1);
  assert.equal(a.read(), server.head(rerun.json.id!).source);
  assert.deepEqual(a.sidecar(), [`base/${rerun.json.id}.html`]);
});

test("no answer after 3 tries: exit 5, the journal is kept and the rerun reuses the key", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const id = (await a.publish()).json.id!;
  a.edit((source) => source.replace("Plan</h1>", "Plans</h1>"));
  const isSave = (request: { method: string }) => request.method === "PUT";
  server.fail(isSave, "error-after", "error-before", "error-before");
  const lost = await a.publish();
  assert.equal(lost.code, 5);
  assert.equal(lost.json.status, "pending");
  assert.deepEqual(a.sleeps, [1000, 3000]);
  assert.ok(a.sidecar().includes(`journal/${id}.json`));
  assert.equal(server.head(id).version, 2, "the first attempt applied");

  const keys = server.requests("PUT", /\/source$/).map((request) => request.headers["Idempotency-Key"]);
  assert.equal(new Set(keys).size, 1, "every retry sent the same key");
  const rerun = await a.publish();
  assert.equal(rerun.code, 0, rerun.json.message);
  assert.equal(rerun.json.version, 2, "the replay returns the save that applied, not a 409");
  assert.equal(server.head(id).version, 2, "applied once");
  assert.equal(a.read(), server.head(id).source);
  assert.ok(!a.sidecar().includes(`journal/${id}.json`));
});

test("429 and 5xx are retried with the same key; 3 of them exit 3; a 422 is not retried", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const id = (await a.publish()).json.id!;
  a.edit((source) => source.replace("Plan</h1>", "Plans</h1>"));
  server.fail((request) => request.method === "PUT", { status: 429 }, { status: 503 });
  const retried = await a.publish();
  assert.equal(retried.code, 0, retried.json.message);
  assert.equal(server.requests("PUT", /\/source$/).length, 3);

  a.edit((source) => source.replace("Plans</h1>", "Plan B</h1>"));
  server.fail((request) => request.method === "PUT", { status: 500 }, { status: 502 }, { status: 503 });
  const down = await a.publish();
  assert.equal(down.code, 3);
  assert.match(down.json.message, /nothing was saved/);
  assert.match(down.json.message, /kept.*replay.*same key/s, "the message says the request is kept and replayed");
  assert.ok(a.sidecar().includes(`journal/${id}.json`), "kept: the rerun reuses the same key");
  assert.equal((await a.publish()).code, 0);

  a.edit((source) => source.replace("</head>", '<link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Bk0000">\n</head>'));
  server.fail((request) => request.method === "PUT", { status: 422 });
  const before = server.log.length;
  const invalid = await a.publish();
  assert.equal(invalid.code, 1);
  assert.equal(server.log.length, before + 1, "not retried");
  assert.ok(!a.sidecar().includes(`journal/${id}.json`));
});

test("a missing token exits 2 naming AF_TOKEN and AF_SERVER; a refused one asks to sign in again", async () => {
  const server = new FakeServer();
  const fs = new MemoryFs();
  fs.files.set(FILE, page("<h1>Plan</h1>"));
  const { ports } = fakePorts(server, fs);
  const missing = await publishPage("page.html", "publish", { env: {}, cwd: DIR, ports });
  assert.equal(missing.code, 2);
  assert.match(missing.json.message, /AF_TOKEN/);
  assert.match(missing.json.message, /AF_SERVER/);
  const refused = await publishPage("page.html", "publish", { env: { AF_TOKEN: "nope", AF_SERVER: ORIGIN }, cwd: DIR, ports });
  assert.equal(refused.code, 2);
  assert.match(refused.json.message, /401.*[Ss]ign in again/);
  assert.equal(fs.under(`${DIR}/.af`).length, 0, "a refused create leaves no journal");
});

test("a server that answers 404 to the API and the session route is not an Artifactbin server: exit 2 naming AF_SERVER", async () => {
  const fs = new MemoryFs();
  fs.files.set(FILE, page("<h1>Plan</h1>"));
  const urls: string[] = [];
  const { ports } = fakePorts(new FakeServer(), fs, {
    fetch: async (url) => {
      urls.push(new URL(url).pathname);
      return { status: 404, json: async () => ({ error: "not_found" }) };
    },
  });
  const outcome = await publishPage("page.html", "publish", { env: { AF_TOKEN: "t", AF_SERVER: "https://example.invalid" }, cwd: DIR, ports });
  assert.equal(outcome.code, 2);
  assert.match(outcome.json.message, /https:\/\/example\.invalid does not look like an Artifactbin server/);
  assert.match(outcome.json.message, /AF_SERVER/);
  assert.deepEqual(urls, ["/api/publish", "/api/auth/session"], "one probe of the session route, no retries");
});

test("a meta ID the server will not publish under is refused with the server's message and names --new", async () => {
  const server = new FakeServer();
  const a = agent(server);
  const theirs = server.reserve("bob");
  a.fs.files.set(`${DIR}/.af/ids.json`, JSON.stringify({ [theirs]: "page.html" }));
  a.write(page("<h1>Copied</h1>", `{ "name": "Copied", "id": "${theirs}" }`));
  const outcome = await a.publish();
  assert.equal(outcome.code, 1);
  assert.equal(outcome.json.status, "error");
  assert.match(outcome.json.message, new RegExp(`\\(422\\): The meta block names ID ${theirs}`));
  assert.match(outcome.json.message, /publish\.mjs page\.html --new/);
  assert.equal(server.pages.size, 0, "nothing was published under a new ID");
  assert.ok(!a.sidecar().some((path) => path.startsWith("journal/")), "a refused create leaves no journal");
});

test("two agents race: the second is merged cleanly for review, then saves both changes", async () => {
  const server = new FakeServer();
  const a = agent(server, "alice", "/a");
  a.write(page("<h1>Plan</h1>\n<p>One</p>\n<p>Two</p>\n<p>Three</p>"));
  const id = (await a.publish()).json.id!;
  server.pages.get(id)!.editors.add("bob");
  const b = agent(server, "bob", "/b");
  b.write(a.read());
  b.fs.files.set(`/b/.af/base/${id}.html`, a.read());

  a.edit((source) => source.replace("One</p>", "One, by Alice</p>"));
  b.edit((source) => source.replace("Three</p>", "Three, by Bob</p>"));
  const [first, second] = await Promise.all([a.publish(), b.publish()]);
  const winner = first.json.status === "saved" ? a : b;
  const loser = winner === a ? b : a;
  const lost = winner === a ? second : first;
  assert.equal((winner === a ? first : second).code, 0);
  assert.equal(lost.code, 1, lost.json.message);
  assert.equal(lost.json.status, "merged");
  assert.match(lost.json.message, /run publish\.mjs page\.html again/);
  assert.equal(server.head(id).version, 2, "the merge is never saved automatically");
  for (const text of ["One, by Alice", "Three, by Bob"]) assert.ok(loser.read().includes(text), text);
  assert.equal(meta(loser.read()).version, 2, "the merged file builds on the head");
  assert.match(loser.read(), /<p data-af-id="n2">One, by Alice<\/p>/, "node IDs survive the merge");

  const rerun = await loser.publish();
  assert.equal(rerun.code, 0, rerun.json.message);
  assert.equal(rerun.json.version, 3);
  assert.match(server.head(id).source, /One, by Alice[\s\S]*Three, by Bob/);
});

test("new elements on both sides with the same new ID: theirs keep it, ours get a fresh one on save", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>\n<p>Middle</p>\n<footer>End</footer>"));
  const id = (await a.publish()).json.id!;
  server.saveAs("alice", id, (source) => source.replace("<h1", "<h2>Theirs</h2>\n<h1"));
  const theirs = /<h2 data-af-id="(n\d+)">Theirs/.exec(server.head(id).source)![1]!;
  // Ours gets the same next ID locally, as check.mjs --write-ids would give it.
  a.edit((source) => assignNodeIds(source.replace("<footer", "<aside>Ours</aside>\n<footer")).source);
  assert.match(a.read(), new RegExp(`<aside data-af-id="${theirs}">`));
  const merged = await a.publish();
  assert.equal(merged.json.status, "merged", merged.json.message);
  assert.match(a.read(), new RegExp(`<h2 data-af-id="${theirs}">Theirs`));
  assert.match(a.read(), /<aside>Ours<\/aside>/, "ours loses the colliding ID");
  assert.equal((await a.publish()).code, 0);
  const saved = server.head(id).source;
  assert.match(saved, new RegExp(`<h2 data-af-id="${theirs}">Theirs`));
  assert.doesNotMatch(saved, new RegExp(`<aside data-af-id="${theirs}">`));
  assert.match(saved, /<aside data-af-id="n\d+">Ours/);
});

test("overlapping edits: the file is untouched, remote and diff are written, exit 4 until resolved", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>\n<p>Budget: 10</p>"));
  const id = (await a.publish()).json.id!;
  server.saveAs("alice", id, (source) => source.replace("Budget: 10", "Budget: 20"));
  a.edit((source) => source.replace("Budget: 10", "Budget: 15"));
  const local = a.read();
  const outcome = await a.publish();
  assert.equal(outcome.code, 4, outcome.json.message);
  assert.equal(outcome.json.status, "conflict");
  assert.equal(a.read(), local, "the page file is untouched");
  assert.equal(a.fs.files.get("/work/page.remote.html"), server.head(id).source);
  const diff = a.fs.files.get("/work/page.conflict.diff")!;
  assert.match(diff, /--- base\n\+\+\+ local\n[\s\S]*-<p data-af-id="n2">Budget: 10<\/p>\n\+<p data-af-id="n2">Budget: 15<\/p>/);
  assert.match(diff, /--- base\n\+\+\+ remote\n[\s\S]*\+<p data-af-id="n2">Budget: 20<\/p>/);
  assert.deepEqual(outcome.json.conflict!.remote, "page.remote.html");
  assert.equal(outcome.json.conflict!.regions.length, 1);

  const before = server.log.length;
  const again = await a.publish();
  assert.equal(again.code, 4, "still unresolved");
  assert.equal(server.log.length, before, "without a request");
  assert.deepEqual(again.json.conflict!.regions, outcome.json.conflict!.regions, "the repeat run reports the same overlapping lines");
  assert.match(again.json.message, /overlapping edits are at line \d+/);

  a.edit((source) => source.replace("Budget: 15", "Budget: 25"));
  const resolved = await a.publish();
  assert.equal(resolved.code, 0, resolved.json.message);
  assert.equal(server.requests("PUT", /\/source$/).at(-1)!.headers["If-Match"], "2", "the resolution builds on the head");
  assert.match(server.head(id).source, /Budget: 25/);
  assert.ok(!a.fs.files.has("/work/page.remote.html") && !a.fs.files.has("/work/page.conflict.diff"), "resolved: the conflict files are gone");
  assert.ok(!a.sidecar().includes(`conflict/${id}.json`));
});

test("edits made while a save is in flight are kept on top of the saved source", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>\n<p>One</p>\n<p>Two</p>"));
  const id = (await a.publish()).json.id!;
  a.edit((source) => source.replace('<p data-af-id="n2">One', '<p>Zero</p>\n$&'));
  server.beforeApply = (request) => {
    if (request.method === "PUT") a.edit((source) => source.replace("Two</p>", "Two, edited meanwhile</p>"));
  };
  const outcome = await a.publish();
  server.beforeApply = null;
  assert.equal(outcome.code, 0, outcome.json.message);
  assert.match(outcome.json.message, /changed while it was saving/);
  assert.match(a.read(), /<p data-af-id="n\d+">Zero<\/p>/, "the saved source's new ID is written back");
  assert.match(a.read(), /Two, edited meanwhile/, "the newer edit is kept");
  assert.doesNotMatch(server.head(id).source, /meanwhile/);
  assert.equal(a.fs.files.get(`${DIR}/.af/base/${id}.html`), server.head(id).source);
  assert.equal((await a.publish()).json.version, 3);
});

test("--pull backs up local edits, takes the head, and refuses while a write is pending", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const id = (await a.publish()).json.id!;
  server.saveAs("alice", id, (source) => source.replace("Plan</h1>", "Plan v2</h1>"));
  a.edit((source) => source.replace("Plan</h1>", "My plan</h1>"));
  const local = a.read();
  const pulled = await a.publish("pull");
  assert.equal(pulled.code, 0, pulled.json.message);
  assert.equal(a.read(), server.head(id).source);
  assert.equal(pulled.json.backups.length, 1);
  assert.equal(a.fs.files.get(`/work/${pulled.json.backups[0]}`), local);
  assert.match(pulled.json.message, new RegExp(pulled.json.backups[0]!.replaceAll(".", "\\.")));
  const clean = await a.publish("pull");
  assert.equal(clean.json.backups.length, 0, "nothing to back up when the file matches");

  a.edit((source) => source.replace("Plan v2", "Plan v3"));
  server.fail((request) => request.method === "PUT", "error-before", "error-before", "error-before");
  assert.equal((await a.publish()).code, 5);
  const refused = await a.publish("pull");
  assert.equal(refused.code, 1);
  assert.match(refused.json.message, /Run publish\.mjs page\.html first/);
});

test("a page the token can't edit names --new; --new publishes a fork with the node IDs kept", async () => {
  const server = new FakeServer();
  const owner = agent(server, "alice", "/a");
  owner.write(page("<h1>Plan</h1>\n<p>Body</p>"));
  const original = (await owner.publish()).json.id!;
  const other = agent(server, "viewer-carol", "/c");
  other.write(owner.read().replace("Body</p>", "Body, mine</p>"));
  const refused = await other.publish();
  assert.equal(refused.code, 1);
  assert.match(refused.json.message, /--new/);

  const fork = await other.publish("new");
  assert.equal(fork.code, 0, fork.json.message);
  assert.equal(fork.json.status, "forked");
  assert.notEqual(fork.json.id, original);
  const sent = server.requests("POST", /^\/api\/publish$/).at(-1)!.body!.source as string;
  assert.deepEqual(Object.keys(meta(sent)), ["name"], "id, version and nextNodeId are stripped");
  assert.equal(meta(other.read()).id, fork.json.id);
  assert.match(other.read(), /<h1 data-af-id="n1">Plan<\/h1>\n<p data-af-id="n2">Body, mine<\/p>/);
  assert.equal(server.head(original).version, 1, "the original is untouched");
});

test("--force backs up the head it overwrites and says what it discarded", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const id = (await a.publish()).json.id!;
  server.saveAs("alice", id, (source) => source.replace("Plan</h1>", "Theirs</h1>"));
  const head = server.head(id).source;
  a.edit((source) => source.replace("Plan</h1>", "Mine</h1>"));
  const forced = await a.publish("force");
  assert.equal(forced.code, 0, forced.json.message);
  assert.equal(forced.json.status, "forced");
  assert.equal(forced.json.version, 3);
  assert.match(server.head(id).source, /Mine<\/h1>/);
  assert.equal(a.fs.files.get(`/work/${forced.json.backups[0]}`), head);
  assert.match(forced.json.message, /Overwrote version 2 \(their changes: 1 line added, 1 removed/);
});

test("an ID reserved by add.mjs is published under that ID; linked backends are sent until unchanged", async () => {
  const server = new FakeServer();
  const a = agent(server);
  const pageId = server.reserve("alice");
  const backend = server.reserve("alice");
  a.fs.files.set(`${DIR}/.af/ids.json`, JSON.stringify({ [pageId]: "page.html", [backend]: "backends/billing.ts" }));
  a.fs.files.set(`${DIR}/backends/billing.ts`, "export const typeDefs = 1;\n");
  a.write(page(`<h1>Bills</h1>`, `{ "name": "Bills", "id": "${pageId}" }`).replace("</head>", `<link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${backend}" data-af-name="billing">\n</head>`));
  const created = await a.publish();
  assert.equal(created.code, 0, created.json.message);
  assert.equal(created.json.id, pageId);
  assert.deepEqual(server.requests("POST", /^\/api\/publish$/)[0]!.body!.files, { [backend]: "export const typeDefs = 1;\n" });
  assert.ok(a.sidecar().includes(`base/${backend}.ts`));

  a.edit((source) => source.replace("Bills</h1>", "Invoices</h1>"));
  await a.publish();
  assert.equal(server.requests("PUT", /\/source$/)[0]!.body!.files, undefined, "an unchanged backend is not sent again");
  a.fs.files.set(`${DIR}/backends/billing.ts`, "export const typeDefs = 2;\n");
  await a.publish();
  assert.deepEqual(server.requests("PUT", /\/source$/)[1]!.body!.files, { [backend]: "export const typeDefs = 2;\n" });

  a.fs.files.delete(`${DIR}/backends/billing.ts`);
  const missing = await a.publish();
  assert.equal(missing.code, 1);
  assert.match(missing.json.message, new RegExp(`links backend ${backend}.*backends/billing\\.ts.*missing`));
});

test("a backend file edited after its save was journalled is not lost: the message names it, and the next run sends it", async () => {
  const server = new FakeServer();
  const a = agent(server);
  const backend = server.reserve("alice");
  a.fs.files.set(`${DIR}/.af/ids.json`, JSON.stringify({ [backend]: "backends/board.ts" }));
  a.fs.files.set(`${DIR}/backends/board.ts`, "export const ping = 'pong';\n");
  a.write(page(`<h1>Board</h1>`).replace("</head>", `<link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${backend}" data-af-name="board">\n</head>`));
  const id = (await a.publish()).json.id!;
  const isSave = (request: { method: string }) => request.method === "PUT";

  // Edit A is journalled, the server is down three times, then the file becomes B before the rerun replays A.
  a.fs.files.set(`${DIR}/backends/board.ts`, "export const ping = 'pongA';\n");
  server.fail(isSave, { status: 503 }, { status: 503 }, { status: 503 });
  assert.equal((await a.publish()).code, 3);
  a.fs.files.set(`${DIR}/backends/board.ts`, "export const ping = 'pongB';\n");
  const replayed = await a.publish();
  assert.equal(replayed.code, 0, replayed.json.message);
  assert.match(replayed.json.message, /Resolved the earlier save/);
  assert.match(replayed.json.message, /backends\/board\.ts changed while it was saving/);
  assert.match(replayed.json.message, /run publish\.mjs page\.html again/i);
  assert.deepEqual(server.requests("PUT", /\/source$/).at(-1)!.body!.files, { [backend]: "export const ping = 'pongA';\n" }, "the journalled contents were sent");
  assert.equal(a.fs.files.get(`${DIR}/.af/base/${backend}.ts`), "export const ping = 'pongA';\n", "the base records what the server runs");
  assert.equal(a.fs.files.get(`${DIR}/backends/board.ts`), "export const ping = 'pongB';\n", "the newer edit is kept");
  const next = await a.publish();
  assert.equal(next.code, 0, next.json.message);
  assert.deepEqual(server.requests("PUT", /\/source$/).at(-1)!.body!.files, { [backend]: "export const ping = 'pongB';\n" }, "the rerun sends the newer edit");
  assert.equal(server.head(id).version, 3);

  // The same when the file changes while the request is in flight.
  a.fs.files.set(`${DIR}/backends/board.ts`, "export const ping = 'pongC';\n");
  server.beforeApply = (request) => {
    if (request.method === "PUT") a.fs.files.set(`${DIR}/backends/board.ts`, "export const ping = 'pongD';\n");
  };
  const inFlight = await a.publish();
  server.beforeApply = null;
  assert.equal(inFlight.code, 0, inFlight.json.message);
  assert.match(inFlight.json.message, /backends\/board\.ts changed while it was saving/);
  assert.equal(a.fs.files.get(`${DIR}/backends/board.ts`), "export const ping = 'pongD';\n");
  assert.deepEqual((await a.publish()).json.version, 5, "the following run sends pongD");
});

test("--delete removes the page and its .af records; only the owner can", async () => {
  const server = new FakeServer();
  const a = agent(server);
  a.write(page("<h1>Plan</h1>"));
  const id = (await a.publish()).json.id!;
  server.pages.get(id)!.editors.add("bob");
  const b = agent(server, "bob", "/b");
  b.write(a.read());
  const refused = await b.publish("delete");
  assert.equal(refused.code, 1);
  assert.match(refused.json.message, /owner/);
  const deleted = await a.publish("delete");
  assert.equal(deleted.code, 0, deleted.json.message);
  assert.equal(server.pages.has(id), false);
  assert.deepEqual(a.sidecar(), []);
  assert.match(deleted.json.message, /--new/);
});

test("initial private visibility is sent atomically in creation and cannot silently change an existing page", async () => {
  const server = new FakeServer(), a = agent(server);
  a.write(page("<h1>Private draft</h1>"));
  const first = await a.publish("publish", "private");
  assert.equal(first.code, 0, first.json.message);
  assert.equal(server.requests("POST", /^\/api\/publish$/)[0]!.body!.visibility, "private");
  const before = server.log.length;
  const existing = await a.publish("publish", "public");
  assert.equal(existing.code, 2);
  assert.match(existing.json.message, /initial|new page/);
  assert.equal(server.log.length, before, "a visibility flag never changes an existing policy");
  const fork = await a.publish("new", "private");
  assert.equal(fork.code, 0, fork.json.message);
  assert.equal(server.requests("POST", /^\/api\/publish$/).at(-1)!.body!.visibility, "private");
});

test("an unresolved private creation keeps its policy and request identity across replay", async () => {
  const server = new FakeServer(), a = agent(server);
  a.write(page("<h1>Private draft</h1>"));
  server.fail((request) => request.path === "/api/publish", "hang-before");
  void a.publish("publish", "private");
  await settle();
  const journal = JSON.parse(a.fs.files.get(`${DIR}/.af/journal/new-page.html.json`)!) as PublishJournal;
  assert.equal(journal.body.visibility, "private");
  const before = server.log.length;
  const mismatch = await a.publish("publish", "public");
  assert.equal(mismatch.code, 2);
  assert.equal(server.log.length, before, "a different requested policy cannot replay an uncertain creation");
  const replay = await a.publish();
  assert.equal(replay.code, 0, replay.json.message);
  const requests = server.requests("POST", /^\/api\/publish$/);
  assert.deepEqual(requests.map(r => [r.body!.requestId, r.body!.visibility]), [[journal.key,"private"],[journal.key,"private"]]);
  assert.equal(server.pages.size, 1);
});
