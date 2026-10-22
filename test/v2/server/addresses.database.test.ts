/**
 * A page's address forms (skills/pagegi-author/SKILL.md, references/http-api.md
 * "Addresses"): /a/<id> with any title slug, /@<handle>/<path> once the owner
 * has a handle, and /af/v1/ids/<id>, all behaving the same: hosted view,
 * ?download=1, sign-in for a private page, 404 for anything unknown. An email
 * address is never a page address.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { page, startServer, type TestServer } from "../support/server.ts";
import { compileOnlyHost } from "../support/todo.ts";

const OWNER = "alice@example.test";
const HANDLE = "_alice__";
/** Every form of one page's address, as a request path. */
const forms = (id: string, path: string) => [
  `/a/${id}`,
  `/a/${id}-`,
  `/a/${id}-quarterly-report.html`,
  `/@${HANDLE}/${path.split("/").map(encodeURIComponent).join("/")}`,
  `/@${HANDLE.toUpperCase()}/${path.split("/").map(encodeURIComponent).join("/")}`,
  `/af/v1/ids/${id}`,
];
const get = (server: TestServer, path: string, token?: string) =>
  fetch(server.origin + path, {
    redirect: "manual",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

/** An account token for `email`, with `handle` chosen. */
async function owner(server: TestServer, email = OWNER, handle = HANDLE): Promise<string> {
  const token = await server.token(email);
  const saved = await server.request("/api/account/handle", { method: "PUT", token, body: { handle } });
  assert.equal(saved.status, 200);
  return token;
}

async function publish(server: TestServer, token: string, body: Record<string, unknown>): Promise<PublishResponse> {
  const response = await server.request("/api/publish", { token, body });
  assert.equal(response.status, 201);
  return (await response.json()) as PublishResponse;
}

test("a published page's url is /a/<id>, and every address form opens the same page or its download", async () => {
  const server = await startServer();
  try {
    const token = await owner(server);
    const published = await publish(server, token, {
      source: page("<h1>Quarterly report</h1>"),
      requestId: "addresses",
      path: "reports/q3 notes.html",
    });
    assert.equal(published.url, `${server.origin}/a/${published.id}`);
    assert.equal(published.path, "reports/q3 notes.html");
    const paths = (await (await server.request("/api/paths", { token })).json()) as { entries: { path: string; url?: string }[] };
    assert.equal(paths.entries.find((e) => e.path === published.path)?.url, published.url);
    const sharing = (await (await server.request(`/api/files/${published.id}/sharing`, { token })).json()) as { url: string };
    assert.equal(sharing.url, published.url, "the sharing dialog copies the canonical address");
    const library = (await (
      await server.request("/api/library", { token, headers: { "x-pagegi-home": "1" } })
    ).json()) as { files: { fileId: string; url: string }[] };
    assert.equal(library.files.find((f) => f.fileId === published.id)?.url, `/a/${published.id}`, "the library links there");
    const hosted = (await (await server.request(`/api/library/${published.id}/host`)).json()) as { boot: { url: string } };
    assert.equal(hosted.boot.url, published.url, "the hosted shell shows it");

    for (const path of forms(published.id, published.path)) {
      const view = await get(server, path);
      assert.equal(view.status, 200, path);
      assert.match(view.headers.get("content-type") ?? "", /text\/html/, path);
      assert.match(await view.text(), /pagegi-host/, path);
      const download = await get(server, path + "?download=1");
      assert.equal(download.status, 200, path);
      assert.match(download.headers.get("content-disposition") ?? "", /attachment/, path);
      assert.match(await download.text(), /<h1 data-af-id="[^"]+">Quarterly report<\/h1>/, path);
    }
  } finally {
    await server.close();
  }
});

test("unknown addresses are 404: another ID, a slug on a missing page, an unknown account, a renamed path", async () => {
  const server = await startServer();
  try {
    const token = await owner(server);
    const published = await publish(server, token, {
      source: page("<h1>Moved</h1>"),
      requestId: "addresses-404",
      path: "old.html",
    });
    const handle = HANDLE;
    for (const path of [
      "/a/Zz9Zz9",
      "/a/Zz9Zz9-title",
      `/a/${published.id}/extra`,
      `/a/${published.id}-slug/extra`,
      "/a/",
      `/@${handle}`,
      `/@${handle}/`,
      `/@${handle}/missing.html`,
      `/@${handle}/../old.html`,
      `/@${handle}/%2e%2e/old.html`,
      `/@${handle}/old.html%3F`,
      `/@nobody/old.html`,
      `/@${encodeURIComponent(OWNER)}/old.html`,
      `/@${OWNER}/old.html`,
      "/@/old.html",
    ])
      for (const suffix of ["", "?download=1"]) {
        const response = await get(server, path + suffix, token);
        assert.equal(response.status, 404, path + suffix);
        assert.deepEqual(await response.json(), { error: "Not found" }, path + suffix);
      }
    assert.equal((await get(server, `/@${handle}/old.html`)).status, 200);
    const moved = await server.request("/api/paths", { token, body: { kind: "move", from: "old.html", path: "new.html" } });
    assert.equal(moved.status, 200);
    assert.equal((await get(server, `/@${handle}/old.html`)).status, 404, "the old path is gone");
    assert.equal((await get(server, `/@${handle}/new.html`)).status, 200, "the new path opens the page");
    assert.equal((await get(server, `/a/${published.id}`)).status, 200, "the ID address never changes");
    for (const path of [`/a/${published.id}`, `/@${handle}/new.html`]) {
      const post = await fetch(server.origin + path, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      assert.equal(post.status, 404, `POST ${path}`);
    }
  } finally {
    await server.close();
  }
});

test("only a handle opens a path address: none without one, the old one 404 once changed, another account's after", async () => {
  const server = await startServer();
  try {
    const token = await server.token(OWNER);
    const published = await publish(server, token, {
      source: page("<h1>Handles</h1>"),
      requestId: "addresses-handles",
      path: "notes.html",
    });
    const email = encodeURIComponent(OWNER);
    for (const path of [`/@${email}/notes.html`, `/@${OWNER}/notes.html`, `/@alice/notes.html`])
      assert.equal((await get(server, path, token)).status, 404, `${path} without a handle`);

    const handle = (body: unknown) => server.request("/api/account/handle", { method: "PUT", token, body });
    assert.equal((await handle({ handle: "alice" })).status, 200);
    assert.equal((await get(server, "/@alice/notes.html")).status, 200);
    assert.equal((await get(server, `/@${email}/notes.html`, token)).status, 404, "the email form never opens a page");

    assert.equal((await handle({ handle: "alice-renamed" })).status, 200);
    assert.equal((await get(server, "/@alice/notes.html")).status, 404, "the old handle is gone, without a redirect");
    assert.equal((await get(server, "/@alice/notes.html")).headers.get("location"), null);
    assert.equal((await get(server, "/@alice-renamed/notes.html")).status, 200);

    const bob = await owner(server, "bob@example.test", "alice");
    const bobs = await publish(server, bob, { source: page("<h1>Bob's notes</h1>"), requestId: "addresses-bob", path: "notes.html" });
    const opened = await get(server, "/@alice/notes.html?download=1");
    assert.equal(opened.status, 200);
    assert.match(await opened.text(), /Bob's notes/, "a freed handle names its new account's pages");
    assert.notEqual(bobs.id, published.id);

    assert.equal((await server.request("/api/account/handle", { method: "DELETE", token })).status, 200);
    assert.equal((await get(server, "/@alice-renamed/notes.html")).status, 404, "a cleared handle opens nothing");
    assert.equal((await get(server, `/a/${published.id}`)).status, 200, "the ID address never changes");
  } finally {
    await server.close();
  }
});

test("a private page sends a signed-out visitor to sign in and back, and is 404 to other accounts, at every address", async () => {
  const server = await startServer();
  try {
    const token = await owner(server);
    const other = await server.token("bob@example.test");
    const published = await publish(server, token, {
      source: page("<h1>Secret</h1>"),
      requestId: "addresses-private",
      path: "secret.html",
      visibility: "private",
    });
    for (const path of forms(published.id, "secret.html")) {
      const anonymous = await get(server, path);
      assert.equal(anonymous.status, 302, path);
      assert.equal(anonymous.headers.get("location"), "/?next=" + encodeURIComponent(path), path);
      const download = await get(server, path + "?download=1");
      assert.equal(download.status, 404, path + "?download=1");
      assert.doesNotMatch(await download.text(), /Secret/);
      const stranger = await get(server, path, other);
      assert.equal(stranger.status, 404, path);
      assert.equal(stranger.headers.get("location"), null, path);
      assert.equal((await get(server, path, token)).status, 200, path);
    }
  } finally {
    await server.close();
  }
});

test("a backend file is only addressed by ID: JSON for its owner, 404 for everyone else", async () => {
  const server = await startServer({ backendHost: compileOnlyHost() });
  try {
    const token = await owner(server);
    const other = await server.token("bob@example.test");
    const reserved = await server.request("/api/ids", { token, body: { count: 1 }, headers: { "Idempotency-Key": "backend-address" } });
    const [backendId] = ((await reserved.json()) as { ids: string[] }).ids;
    const published = await server.request("/api/publish", {
      token,
      body: {
        source: page("<h1>With backend</h1>", `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${backendId}" data-af-name="api">\n`),
        files: { [backendId!]: "import { gql } from '@afbin/apollo';\nexport const typeDefs = gql`type Query { ok: Boolean! }`;\nexport default { Query: { ok: () => true } };\n" },
        requestId: "backend-address",
      },
    });
    assert.equal(published.status, 201, await published.text());
    for (const path of [`/a/${backendId}`, `/af/v1/ids/${backendId}`]) {
      const owner = await get(server, path, token);
      assert.equal(owner.status, 200, path);
      const shown = (await owner.json()) as { id: string; kind: string; version: string };
      assert.equal(shown.id, backendId);
      assert.equal(shown.kind, "backend");
      assert.equal(typeof shown.version, "string");
      assert.equal((await get(server, path, other)).status, 404, path);
      assert.equal((await get(server, path)).status, 404, path);
      assert.equal((await get(server, path + "?download=1", token)).status, 404, path);
    }
  } finally {
    await server.close();
  }
});
