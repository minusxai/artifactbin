import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicProfileRoute } from "../../../src/server/public-profile-route.ts";
test("public profile routes bound pagination and escape all public text", async () => {
  const calls: any[] = [];
  const route = createPublicProfileRoute({
    async read(handle, after, limit) {
      calls.push({ handle, after, limit });
      return {
        handle: "alice",
        files: [{ id: "Page01", title: "<img src=x onerror=alert(1)>" }],
        next: "Page01",
      };
    },
  });
  const result = await route(
    "GET",
    new URL("https://example.test/@Alice?after=Page00&limit=2"),
  );
  assert.equal(result?.status, 200);
  assert.deepEqual(calls, [{ handle: "alice", after: "Page00", limit: 2 }]);
  assert.match(result!.body, /&lt;img/);
  assert.doesNotMatch(result!.body, /<img/);
  assert.match(result!.body, /href="\/a\/Page01"/);
  assert.match(result!.body, /after=Page01&amp;limit=2/);
  assert.equal(result!.headers["Cache-Control"], "no-store");
  for (const query of [
    "?limit=0",
    "?limit=51",
    "?limit=1.5",
    "?after=bad",
    "?after=Page00&after=Page01",
    "?scope=private",
  ])
    assert.equal(
      (await route("GET", new URL("https://example.test/@alice" + query)))
        ?.status,
      400,
    );
  assert.equal(calls.length, 1);
  assert.equal(
    await route("GET", new URL("https://example.test/@alice/page")),
    null,
  );
});
test("unknown profiles and forbidden methods reveal no account details", async () => {
  const route = createPublicProfileRoute({ read: async () => null });
  assert.equal(
    (await route("GET", new URL("https://example.test/@unknown")))?.status,
    404,
  );
  assert.equal(
    (await route("POST", new URL("https://example.test/@unknown")))?.status,
    404,
  );
  assert.equal(
    (await route("GET", new URL("https://example.test/@bad%2Fhandle")))?.status,
    404,
  );
});
