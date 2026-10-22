import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLegacyAddress,
  legacyPageURL,
  readLegacyRaw,
} from "../src/server/legacy-addresses.ts";
import { createMediaService } from "../src/media/service.ts";
import type { LegacyAddressPorts } from "../src/server/legacy-addresses-contracts.ts";
const url = (path: string) => new URL(path, "https://example.test");
const hash = "a".repeat(64);
const asset = {
  pageId: "Ab1Cd2",
  revision: "3",
  variant: "original" as const,
  sha256: hash,
};

test("only exact supported legacy addresses dispatch, retaining history and download intent", () => {
  for (const path of ["/a/Ab1Cd2/app", "/a/Ab1Cd2/app/", "/workspace/Ab1Cd2"])
    assert.deepEqual(parseLegacyAddress(path), {
      id: "Ab1Cd2",
      kind: "hosted",
    });
  const request = url("/a/Ab1Cd2/download?version=3&x=kept&download=0");
  assert.equal(
    legacyPageURL(request, parseLegacyAddress(request.pathname)!).pathname,
    "/a/Ab1Cd2",
  );
  assert.equal(
    legacyPageURL(request, parseLegacyAddress(request.pathname)!).search,
    "?version=3&x=kept&download=1",
  );
  for (const path of [
    "/a/Ab1Cd2/raw/",
    "/workspace/Ab1Cd2/",
    "/a/Ab1Cd2/story",
    "/a/Ab1Cd2/unknown",
    "/a/Ab1Cd2/raw/more",
    "/a/Ab1Cd2-title/raw",
    "/workspace/abcdefghi",
    "/a/%41b1Cd2/raw",
  ])
    assert.equal(parseLegacyAddress(path), null, path);
});

test("raw document is exact stored HTML, sandboxed attachment and HEAD never emits a body", async () => {
  const source =
    '<!doctype html><html><body data-af-id="node-7">é<script>untrusted()</script></body></html>';
  const calls: unknown[] = [];
  const ports: LegacyAddressPorts = {
    raw: {
      async read(...args) {
        calls.push(args);
        return { kind: "document", source };
      },
    },
    media: {
      async read() {
        throw Error("not media");
      },
    },
  };
  const get = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?version=3"),
    "GET",
    "viewer",
    {},
    ports,
  );
  assert.equal(get.status, 200);
  let text = "";
  for await (const bytes of get.body ?? [])
    text += new TextDecoder().decode(bytes);
  assert.equal(text, source);
  assert.equal(
    get.headers["Content-Length"],
    String(Buffer.byteLength(source)),
  );
  assert.match(get.headers["Content-Security-Policy"]!, /sandbox/);
  assert.equal(get.headers["X-Content-Type-Options"], "nosniff");
  assert.match(get.headers["Content-Disposition"]!, /^attachment/);
  assert.equal(get.headers["Cache-Control"], "private, no-store");
  const head = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?version=3"),
    "HEAD",
    "viewer",
    {},
    ports,
  );
  assert.deepEqual(head.headers, get.headers);
  assert.equal(head.body, undefined);
  assert.deepEqual(calls, [
    ["Ab1Cd2", "viewer", 3],
    ["Ab1Cd2", "viewer", 3],
  ]);
});

test("raw media selects exact original revision and retains existing range/HEAD/close semantics", async () => {
  let closed = 0;
  const reads: unknown[] = [];
  const media = createMediaService(
    {
      async read(address, credential) {
        reads.push([address, credential]);
        return {
          ...asset,
          contentType: "image/webp",
          filename: "test.webp",
          byteLength: 5,
          storageKey: hash,
        };
      },
    },
    {
      async open() {
        return {
          async *stream(range) {
            yield new Uint8Array([1, 2, 3, 4, 5]).slice(
              range?.start ?? 0,
              range ? range.end + 1 : undefined,
            );
          },
          async close() {
            closed++;
          },
        };
      },
    },
  );
  const ports: LegacyAddressPorts = {
    raw: {
      async read(id, credential, version) {
        assert.equal(version, 3);
        return { kind: "media", address: asset };
      },
    },
    media,
  };
  const response = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?v=3"),
    "GET",
    "viewer",
    { range: "bytes=1-2" },
    ports,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers["Content-Range"], "bytes 1-2/5");
  const body = [];
  for await (const bytes of response.body ?? []) body.push(...bytes);
  assert.deepEqual(body, [2, 3]);
  await response.close();
  assert.equal(closed, 1);
  const head = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?version=3"),
    "HEAD",
    "viewer",
    { range: "bytes=1-2" },
    ports,
  );
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  await head.close();
  assert.deepEqual(reads, [
    [asset, "viewer"],
    [asset, "viewer"],
  ]);
  const unchanged = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?v=3"),
    "GET",
    "viewer",
    { range: "bytes=1-2", ifRange: '"old"' },
    ports,
  );
  assert.equal(unchanged.status, 200);
  await unchanged.close();
});

test("raw missing/denied never falls back, and malformed revision never reaches authority", async () => {
  let reads = 0;
  const ports: LegacyAddressPorts = {
    raw: {
      async read() {
        reads++;
        return null;
      },
    },
    media: {
      async read() {
        throw Error("no asset read");
      },
    },
  };
  for (const path of [
    "/a/Ab1Cd2/raw?version=0",
    "/a/Ab1Cd2/raw?version=3&version=3",
    "/a/Ab1Cd2/raw?v=2&version=3",
    "/a/Ab1Cd2/raw?version=1.0",
    "/a/Ab1Cd2/raw?version=9007199254740992",
  ])
    await assert.rejects(() => readLegacyRaw(url(path), "GET", "", {}, ports), {
      status: 400,
    });
  assert.equal(reads, 0);
  const denied = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?version=3"),
    "GET",
    "",
    {},
    ports,
  );
  assert.equal(denied.status, 404);
  assert.equal(denied.body, undefined);
  assert.equal(reads, 1);
});

test("raw media rejects a misbound descriptor and a permission revoked after alias lookup", async () => {
  let assetReads = 0;
  const media = createMediaService(
    {
      async read() {
        assetReads++;
        return null;
      },
    },
    {
      async open() {
        throw Error("denied bytes must never open");
      },
    },
  );
  const ports: LegacyAddressPorts = {
    raw: {
      async read() {
        return { kind: "media", address: asset };
      },
    },
    media,
  };
  const denied = await readLegacyRaw(
    url("/a/Ab1Cd2/raw?version=3"),
    "GET",
    "viewer",
    {},
    ports,
  );
  assert.equal(denied.status, 404);
  assert.equal(assetReads, 1);
  for (const address of [
    { ...asset, pageId: "Other1" },
    { ...asset, variant: "small" as const },
    { ...asset, revision: "2" },
  ]) {
    const response = await readLegacyRaw(
      url("/a/Ab1Cd2/raw?version=3"),
      "GET",
      "viewer",
      {},
      {
        ...ports,
        raw: {
          async read() {
            return { kind: "media", address };
          },
        },
      },
    );
    assert.equal(response.status, 404);
  }
  assert.equal(assetReads, 1);
});
