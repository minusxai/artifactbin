import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { database } from "../src/database.js";
import { createService } from "../src/server.js";
import { hash } from "../src/server/text.ts";
import { insertPages } from "./fixtures/pages.js";
const shell = (html) =>
  JSON.parse(
    /<script id="pagegi-host" type="application\/json">([^<]+)<\/script>/.exec(
      html,
    )[1],
  );
test("owned paths and folders survive moves, keep the file's address and isolate concurrent names", async () => {
  const env = await testDatabase(),
    store = database(env);
  await store.health();
  const tokens = {};
  for (const actor of ["alice", "bob"])
    tokens[hash(actor + "-token")] = {
      actor,
      expires: Date.now() + 3600000,
    };
  await insertPages(env.pool, { accounts: { alice: {}, bob: {} }, tokens });
  const service = createService(env);
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const call = (path, body, actor = "alice", redirect = "follow") =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      redirect,
      headers: {
        Cookie: "pagegi_account=" + actor + "-token",
        Origin: origin,
        "Content-Type": "application/json",
        "X-Pagegi-Home": "1",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal(
      (await call("/api/library/paths", { kind: "folder", path: "/research/empty" }))
        .status,
      200,
    );
    const create = await call("/api/library", {
      source: "<title>Notes</title><h1>Notes</h1>",
      requestId: "one",
      visibility: "unlisted",
      path: "/research/notes.html",
    });
    assert.equal(create.status, 201);
    const f = await create.json();
    assert.equal(f.url, `${origin}/a/${f.id}`);
    assert.equal(f.path, "research/notes.html");
    const address = new URL(f.url).pathname;
    assert.equal(
      (await (await call("/api/library")).json()).files[0].url,
      address,
    );
    assert.equal(shell(await (await call(address)).text()).fileId, f.id);
    assert.equal((await call(address, null, "bob")).status, 200);
    assert.equal((await call(address, null, "guest")).status, 200);
    const collision = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        call("/api/library", {
          source: "<h1>Race</h1>",
          requestId: "race" + i,
          path: "/research/race.html",
        }),
      ),
    );
    assert.equal(collision.filter((r) => r.status === 201).length, 1);
    assert.equal(collision.filter((r) => r.status === 409).length, 7);
    assert.equal(
      (await (await call("/api/library")).json()).files.length,
      2,
      "failed publishes leave no files",
    );
    assert.equal(
      (await call("/api/library/paths", { kind: "move", from: "/research", path: "/archive" }))
        .status,
      200,
    );
    assert.equal(await store.catalog.filePath("alice", f.id), "/archive/notes.html");
    assert.equal(await store.catalog.sharedLink(f.id), address);
    assert.equal(shell(await (await call(address)).text()).fileId, f.id);
    assert.equal(
      (await call("/api/library/paths", { kind: "remove-folder", path: "/archive" })).status,
      409,
    );
    assert.equal(
      (await call("/api/library/paths", { kind: "remove-folder", path: "/archive/empty" }))
        .status,
      200,
    );
    const same = await call(
      "/api/library",
      { source: "<h1>Other owner</h1>", requestId: "bob", path: "/archive/notes.html" },
      "bob",
    );
    assert.equal(same.status, 201, "paths are per account");
    const privatePublication = await call("/api/library", {
      source: "<title>Private</title><h1>Private content</h1>",
      requestId: "private-address",
      visibility: "private",
    });
    const privateFile = await privatePublication.json();
    const privateAddress = new URL(privateFile.url).pathname;
    const ownerShell = await call(privateAddress);
    assert.equal(ownerShell.status, 200);
    const alternate = `/api/library/${privateFile.id}/source`;
    assert.equal(
      ownerShell.headers.get("link"),
      `<${alternate}>; rel="alternate"; type="text/plain"`,
    );
    const privateHtml = await ownerShell.text();
    assert.equal(shell(privateHtml).sourceUrl, alternate);
    assert.ok(privateHtml.includes(`href="${alternate}"`));
    assert.ok(!privateHtml.includes("Private content"), "the shell never inlines the page");
    const sourceResponse = await call(alternate);
    assert.equal(sourceResponse.status, 200);
    assert.ok((await sourceResponse.text()).includes("Private content"));
    assert.equal((await call(privateAddress, null, "bob", "manual")).status, 404);
    const anonymous = await call(privateAddress, null, "guest", "manual");
    assert.equal(anonymous.status, 302);
    assert.equal(
      anonymous.headers.get("location"),
      "/?next=" + encodeURIComponent(privateAddress),
    );
    for (const actor of ["bob", "guest"])
      assert.equal(
        (await call(alternate, null, actor, "manual")).status,
        actor === "bob" ? 403 : 401,
      );
    for (const locator of ["x".repeat(12), "short", "x".repeat(7), "bad%21i", "nested/id"])
      assert.equal(
        (await call("/af/v1/ids/" + locator, null, "guest", "manual")).status,
        404,
        locator,
      );
    for (const old of ["/d/" + "x".repeat(12), "/documents/" + f.id, "/f/archive/notes.html"])
      assert.equal((await call(old, null, "alice", "manual")).status, 404, old);
  } finally {
    await service.close();
    await new Promise((r) => service.server.close(r));
    await store.close();
    await env.cleanup();
  }
});
