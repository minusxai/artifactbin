import { test } from "node:test";
import assert from "node:assert/strict";
import { FILE_ID_PATTERN } from "../../../src/af-contracts.ts";
import type { PublishResponse, SaveResponse, SourceResponse } from "../../../src/server/af-api-contracts.ts";
import { compileOnlyHost, publishTodo } from "../support/todo.ts";
import { page, startServer, type TestServer } from "../support/server.ts";
import { skillFile } from "../support/skill.ts";

function meta(source: string): Record<string, unknown> {
  const block = /<script type="application\/json" data-af="meta">([\s\S]*?)<\/script>/.exec(source);
  assert.ok(block, "saved source has a data-af=meta block");
  return JSON.parse(block[1]!) as Record<string, unknown>;
}
const nodeIds = (source: string) => [...source.matchAll(/data-af-id="([^"]+)"/g)].map((m) => m[1]!);
const bodyElements = (source: string) =>
  [...source.slice(source.indexOf("<body")).matchAll(/<(?!\/|!|script|style|template)([a-z][a-z0-9-]*)/g)].length - 1;

async function publish(server: TestServer, token: string, body: Record<string, unknown>) {
  const response = await server.request("/api/publish", { token, body });
  return { status: response.status, body: (await response.json()) as PublishResponse & { error?: string } };
}

test("publishing the todo example with its backend returns the page exactly as saved", async () => {
  const server = await startServer({ backendHost: compileOnlyHost() });
  try {
    const token = await server.token();
    const body = await publishTodo(server, token, { requestId: "todo-publish-1" });
    assert.match(body.id, FILE_ID_PATTERN);
    assert.equal(body.version, 1);
    assert.equal(body.url, `${server.origin}/a/${body.id}`);
    assert.equal(typeof body.path, "string");
    const saved = meta(body.source);
    assert.equal(saved.id, body.id);
    assert.equal(saved.version, 1);
    assert.equal(saved.name, "Team todo list");
    assert.equal(nodeIds(body.source).length, bodyElements(body.source), "every body element has a data-af-id");
    assert.match(body.source, new RegExp(`<script src="${server.origin}/af/v1/core.js"></script>`));
    assert.doesNotMatch(body.source, /artifactbin\.dev/);
    assert.ok(
      body.source.includes(`<link rel="af-backend" href="${server.origin}/af/v1/ids/${body.backendId}" data-af-name="team">`),
      "the backend link points at this server",
    );
    const backends = (await (await server.request(`/api/files/${body.id}/backends`, { token })).json()) as {
      backends: { name: string; id: string }[];
    };
    assert.deepEqual(backends.backends.map(({ name, id }) => ({ name, id })), [{ name: "team", id: body.backendId }]);
  } finally {
    await server.close();
  }
});

test("a publish with more backend files than the batch limit is refused before anything compiles", async () => {
  let compiles = 0;
  const host = compileOnlyHost();
  const server = await startServer({
    backendHost: { ...host, compile: (source, signal) => (compiles++, host.compile(source, signal)) },
  });
  try {
    const token = await server.token();
    const reserved = await server.request("/api/ids", { token, body: { count: 65 }, headers: { "Idempotency-Key": "sixty-five-0000001" } });
    const { ids } = (await reserved.json()) as { ids: string[] };
    const backend = skillFile("examples/backends/todos.ts");
    const links = ids.map((id, i) => `<link rel="af-backend" href="${server.origin}/af/v1/ids/${id}" data-af-name="b${i}">`).join("\n");
    const files = Object.fromEntries(ids.map((id) => [id, backend]));
    const { status, body } = await publish(server, token, { requestId: "too-many-backends", source: page("<h1>Many</h1>", links), files });
    assert.equal(status, 422, JSON.stringify(body));
    assert.match(body.error ?? "", /at most 64 backend files/);
    assert.equal(compiles, 0);
  } finally {
    await server.close();
  }
});

test("'Start with an example' publishes the todo example with its backend, or the page alone without backends", async () => {
  const example = async (server: TestServer, token: string, requestId: string) => {
    const response = await server.request("/api/library/example", {
      token,
      body: { requestId },
      headers: { "X-Pagegi-Home": "1", Origin: server.origin },
    });
    return { status: response.status, body: (await response.json()) as PublishResponse & { error?: string } };
  };
  const withBackends = await startServer({ backendHost: compileOnlyHost() });
  try {
    const token = await withBackends.token();
    const first = await example(withBackends, token, "example-1");
    assert.equal(first.status, 201, first.body.error);
    const backends = (await (await withBackends.request(`/api/files/${first.body.id}/backends`, { token })).json()) as {
      backends: { name: string; id: string }[];
    };
    assert.deepEqual(backends.backends.map((b) => b.name), ["team"]);
    assert.ok(first.body.source.includes(`/af/v1/ids/${backends.backends[0]!.id}" data-af-name="team"`));
    const again = await example(withBackends, token, "example-1");
    assert.equal(again.status, 200, "a retry with the same requestId is the same page");
    assert.equal(again.body.id, first.body.id);
  } finally {
    await withBackends.close();
  }
  const without = await startServer();
  try {
    const token = await without.token();
    const alone = await example(without, token, "example-2");
    assert.equal(alone.status, 201, alone.body.error);
    assert.doesNotMatch(alone.body.source, /rel="af-backend"/);
    // In a folder, the example is named from its title like in the root, never a fixed name.
    const inFolder = async (requestId: string) => {
      const response = await without.request("/api/library/example", {
        token,
        body: { requestId, folder: "/Projects" },
        headers: { "X-Pagegi-Home": "1", Origin: without.origin },
      });
      return { status: response.status, body: (await response.json()) as PublishResponse & { error?: string } };
    };
    const first = await inFolder("example-folder-1");
    assert.equal(first.status, 201, first.body.error);
    assert.equal(first.body.path, "Projects/team-todo-list.html");
    const retry = await inFolder("example-folder-1");
    assert.equal(retry.status, 200, retry.body.error);
    assert.equal(retry.body.id, first.body.id, "a retry is the same page, not a renamed copy");
    const second = await inFolder("example-folder-2");
    assert.equal(second.body.path, "Projects/team-todo-list-2.html");
  } finally {
    await without.close();
  }
});

test("a publish repeated with the same requestId creates nothing new", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const request = { source: page("<p>Once</p>"), requestId: "same-request-id" };
    const first = await publish(server, token, request);
    const again = await publish(server, token, request);
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first.body);
    const { entries } = (await (await server.request("/api/paths", { token })).json()) as { entries: unknown[] };
    assert.equal(entries.length, 1);
  } finally {
    await server.close();
  }
});

test("saving needs the current version and returns the next one", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const { body: published } = await publish(server, token, { source: page("<h1>One</h1>"), requestId: "save-flow" });
    const read = await server.request(`/api/files/${published.id}/source`, { token });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("etag"), '"1"');
    const current = (await read.json()) as SourceResponse;
    assert.deepEqual(current, { source: published.source, version: 1 });

    const edited = current.source.replace("</h1>", "</h1>\n<p>Two</p>");
    const put = (source: string, ifMatch?: string) =>
      server.request(`/api/files/${published.id}/source`, {
        method: "PUT",
        token,
        body: { source },
        headers: ifMatch === undefined ? {} : { "If-Match": ifMatch },
      });
    const saved = await put(edited, "1");
    assert.equal(saved.status, 200);
    const next = (await saved.json()) as SaveResponse;
    assert.equal(next.version, 2);
    assert.equal(meta(next.source).version, 2);
    const stale = await put(edited, "1");
    assert.equal(stale.status, 409);
    const conflict = (await stale.json()) as { error: string; version: number };
    assert.ok(conflict.error);
    assert.equal(conflict.version, 2);
    assert.equal((await put(edited)).status, 428);
    assert.equal((await put(edited, '"2"')).status, 200, "a quoted ETag value is accepted");
  } finally {
    await server.close();
  }
});

test("node IDs stay on their elements across saves, and removed IDs are never reused", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const { body: v1 } = await publish(server, token, { source: page("<h1>A</h1>\n<p>B</p>\n<p>C</p>"), requestId: "ids-flow" });
    const [h1, p1, p2] = nodeIds(v1.source);
    assert.ok(h1 && p1 && p2);
    // An agent deletes the last paragraph and adds two new ones above the first.
    const edited = v1.source
      .replace(/\n<p data-af-id="[^"]+">C<\/p>/, "")
      .replace(/(<h1[^>]*>A<\/h1>)/, "$1\n<p>New 1</p>\n<p>New 2</p>");
    const response = await server.request(`/api/files/${v1.id}/source`, {
      method: "PUT",
      token,
      body: { source: edited },
      headers: { "If-Match": "1" },
    });
    const v2 = (await response.json()) as SaveResponse;
    const after = nodeIds(v2.source);
    assert.equal(after[0], h1);
    assert.equal(after.at(-1), p1);
    assert.equal(after.includes(p2), false, "a removed ID is not reassigned");
    assert.equal(new Set(after).size, after.length);
  } finally {
    await server.close();
  }
});

test("a page whose meta block names an ID reserved by the publisher is published under it; any other named ID is 422", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const { ids } = (await (await server.request("/api/ids", { token, body: { count: 1 }, headers: { "Idempotency-Key": "reserved-page-0001" } })).json()) as { ids: string[] };
    const head = (id: string) => `  <script type="application/json" data-af="meta">{ "name": "Mine", "id": "${id}" }</script>\n`;
    const stranger = await server.token();
    const theirs = await publish(server, stranger, { source: page("<p>y</p>", head(ids[0]!)), requestId: "not-mine" });
    assert.equal(theirs.status, 422, "someone else's reservation is refused, not replaced by a new ID");
    assert.match(theirs.body.error ?? "", new RegExp(`${ids[0]}.*not an ID you reserved`));
    const { status, body } = await publish(server, token, { source: page("<p>x</p>", head(ids[0]!)), requestId: "reserved-page" });
    assert.equal(status, 201, body.error);
    assert.equal(body.id, ids[0]);
    const published = await publish(server, token, { source: page("<p>z</p>", head(ids[0]!)), requestId: "already-published" });
    assert.equal(published.status, 422, "an ID that is already published is refused");
    assert.match(published.body.error ?? "", new RegExp(ids[0]!));
    const unknown = await publish(server, token, { source: page("<p>w</p>", head("Zz9Zz9")), requestId: "never-reserved" });
    assert.equal(unknown.status, 422, "an ID nobody reserved is refused");
    assert.match(unknown.body.error ?? "", /Zz9Zz9/);
    const { entries } = (await (await server.request("/api/paths", { token })).json()) as { entries: unknown[] };
    assert.equal(entries.length, 1, "nothing was published under a fresh ID");
  } finally {
    await server.close();
  }
});

test("saved pages point at this server: the default host, earlier default hosts and other configured hosts", async () => {
  const server = await startServer({ knownOrigins: ["https://pages.example"] });
  try {
    const token = await server.token();
    const source = page('<img src="https://pages.example/af/v1/ids/Im4ge0" alt="">\n<a href="https://artifactbin.dev/af/v1/ids/Ol0dId">old</a>').replace(
      "https://artifactbin.dev/af/v1/core.js",
      "https://pagegi.artifactbin.dev/af/v1/core.js",
    );
    const { body } = await publish(server, token, { source, requestId: "hosts" });
    assert.match(body.source, new RegExp(`src="${server.origin}/af/v1/core.js"`));
    assert.match(body.source, new RegExp(`src="${server.origin}/af/v1/ids/Im4ge0"`));
    assert.match(body.source, new RegExp(`href="${server.origin}/af/v1/ids/Ol0dId"`), "the earlier default host is still rewritten without configuration");
    assert.doesNotMatch(body.source, /pages\.example|artifactbin\.dev/);
  } finally {
    await server.close();
  }
});

test("a page without the core gets it added on publish", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const { status, body } = await publish(server, token, {
      source: "<!DOCTYPE html><html><head><title>Bare</title><script>window.x=1</script></head><body><p>x</p></body></html>",
      requestId: "no-core",
    });
    assert.equal(status, 201);
    const head = body.source.slice(0, body.source.indexOf("</head>"));
    assert.ok(head.indexOf(`${server.origin}/af/v1/core.js`) < head.indexOf("window.x=1"));
  } finally {
    await server.close();
  }
});
