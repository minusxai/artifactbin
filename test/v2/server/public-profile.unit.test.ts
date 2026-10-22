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
        image: null,
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
  assert.doesNotMatch(result!.headers["Content-Security-Policy"]!, /img-src/);
  assert.doesNotMatch(result!.body, /<img/);
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

const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
test("a profile with a photo shows it beside the handle and allows only inline images; anything else from storage is refused", async () => {
  const page = (image: unknown) =>
    createPublicProfileRoute({
      read: async () => ({
        handle: "alice",
        image: image as string | null,
        files: [],
        next: null,
      }),
    })("GET", new URL("https://example.test/@alice"));
  const shown = await page(PHOTO);
  assert.equal(shown?.status, 200);
  assert.match(
    shown!.body,
    new RegExp(
      '<img class="profile-photo" src="' +
        PHOTO.replace(/[+/]/g, "\\$&") +
        '" alt="" width="64" height="64">',
    ),
  );
  assert.match(
    shown!.headers["Content-Security-Policy"]!,
    /default-src 'none'; .*img-src data:;/,
  );
  assert.doesNotMatch(
    shown!.headers["Content-Security-Policy"]!,
    /img-src [^;]*(https?:|'self'|\*)/,
  );
  const head = await createPublicProfileRoute({
    read: async () => ({
      handle: "alice",
      image: PHOTO,
      files: [],
      next: null,
    }),
  })("HEAD", new URL("https://example.test/@alice"));
  assert.equal(head?.body, "");
  assert.match(head!.headers["Content-Security-Policy"]!, /img-src data:/);
  const without = await page(null);
  assert.doesNotMatch(without!.body, /<img/);
  assert.doesNotMatch(without!.headers["Content-Security-Policy"]!, /img-src/);
  for (const bad of [
    "https://example.test/avatar.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    'data:image/png;base64,abc"onerror="alert(1)',
    "data:image/png;base64," + "A".repeat(150000),
    undefined,
    7,
  ])
    await assert.rejects(
      page(bad),
      /Invalid public profile result/,
      String(bad).slice(0, 40),
    );
});
