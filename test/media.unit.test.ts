import test from "node:test";
import assert from "node:assert/strict";
import { mediaAddress, parseMediaAddress } from "../src/media/address.ts";
import { mediaRange } from "../src/media/range.ts";
import { createMediaService } from "../src/media/service.ts";
import type { MediaDescriptor, MediaAddress } from "../src/media/contracts.ts";
const address: MediaAddress = {
  pageId: "ABC123",
  revision: "2",
  variant: "original",
  sha256: "a".repeat(64),
};
const descriptor: MediaDescriptor = {
  ...address,
  contentType: "image/png",
  filename: "sample.png",
  byteLength: 6,
  storageKey: address.sha256,
};
const body = Buffer.from([0, 255, 1, 2, 3, 4]);
test("media addresses identify immutable revisions and reject paths, URLs and invalid digests", () => {
  const path = mediaAddress(address);
  assert.deepEqual(parseMediaAddress(path), address);
  assert.equal(
    mediaAddress(address, "https://platform.example.test"),
    `https://platform.example.test${path}`,
  );
  for (const path of [
    "/af/v1/ids/ABC123/assets/2/original/../secret",
    `/af/v1/ids/ABC123/assets/2/original/${"A".repeat(64)}`,
    `/af/v1/ids/ABC123/assets/02/original/${"a".repeat(64)}`,
    `/af/v1/ids/ABC123/assets/2/%6friginal/${"a".repeat(64)}`,
  ])
    assert.equal(parseMediaAddress(path), null);
  assert.throws(() => mediaAddress({ ...address, sha256: "../secret" }));
  assert.throws(() =>
    mediaAddress(address, "https://user:secret@platform.example.test"),
  );
});
test("single byte ranges support closed, open and suffix forms without overflow", () => {
  assert.equal(mediaRange(undefined, 6), null);
  assert.deepEqual(mediaRange("bytes=1-3", 6), { start: 1, end: 3 });
  assert.deepEqual(mediaRange("bytes=3-", 6), { start: 3, end: 5 });
  assert.deepEqual(mediaRange("bytes=-2", 6), { start: 4, end: 5 });
  assert.deepEqual(mediaRange("bytes=0-999", 6), { start: 0, end: 5 });
  for (const range of [
    "bytes=6-",
    "bytes=3-1",
    "bytes=-0",
    "bytes=0-1,3-4",
    "bytes=9007199254740992-",
    "items=0-1",
    "bytes= 0-1",
    "",
  ])
    assert.throws(() => mediaRange(range, 6));
  assert.throws(() => mediaRange("bytes=0-", 0));
});
test("authorization precedes storage, including HEAD and unsatisfiable ranges", async () => {
  let opens = 0;
  const service = createMediaService(
    {
      async read() {
        return null;
      },
    },
    {
      async open() {
        opens++;
        throw new Error("must not read");
      },
    },
  );
  for (const method of ["GET", "HEAD"] as const) {
    const response = await service.read({
      address,
      method,
      credential: "parent-page-grant",
      range: "bytes=999-",
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers["Content-Range"], undefined);
  }
  assert.equal(opens, 0);
});
test("GET, HEAD and ranges preserve bytes and emit inert private headers", async () => {
  let closes = 0,
    streams = 0;
  const service = createMediaService(
    {
      async read() {
        return descriptor;
      },
    },
    {
      async open() {
        return {
          async *stream(range) {
            streams++;
            yield range ? body.subarray(range.start, range.end + 1) : body;
          },
          async close() {
            closes++;
          },
        };
      },
    },
  );
  const full = await service.read({
    address,
    method: "GET",
    credential: "account",
  });
  assert.equal(full.status, 200);
  assert.equal(
    full.headers["Content-Disposition"]?.startsWith("inline;"),
    true,
  );
  assert.deepEqual(Buffer.concat(await collect(full.body!)), body);
  await full.close();
  const range = await service.read({
    address,
    method: "GET",
    credential: "account",
    range: "bytes=1-3",
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers["Content-Range"], "bytes 1-3/6");
  assert.deepEqual(
    Buffer.concat(await collect(range.body!)),
    body.subarray(1, 4),
  );
  await range.close();
  const head = await service.read({
    address,
    method: "HEAD",
    credential: "account",
  });
  assert.equal(head.body, undefined);
  await head.close();
  assert.equal(streams, 2);
  assert.equal(closes, 3);
  assert.equal(full.headers["Cache-Control"], "private, no-store");
  assert.equal(full.headers["Cross-Origin-Resource-Policy"], "same-site");
  assert.equal(full.headers["Access-Control-Allow-Origin"], undefined);
  const invalid = await service.read({
    address,
    method: "GET",
    credential: "account",
    range: "bytes=99-",
  });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers["Content-Range"], "bytes */6");
});
test("SVG, PDF and general files are sandboxed attachments and filenames cannot inject headers", async () => {
  for (const contentType of [
    "image/svg+xml",
    "application/pdf",
    "text/html",
    "application/octet-stream",
  ]) {
    const service = createMediaService(
      {
        async read() {
          return {
            ...descriptor,
            contentType,
            filename: 'bad"\r\nInjected: yes/é.svg',
          };
        },
      },
      {
        async open() {
          return {
            async *stream() {
              yield body;
            },
            async close() {},
          };
        },
      },
    );
    const response = await service.read({
      address,
      method: "HEAD",
      credential: "",
    });
    assert.ok(
      response.headers["Content-Disposition"]?.startsWith("attachment;"),
    );
    assert.match(response.headers["Content-Security-Policy"]!, /sandbox/);
    assert.doesNotMatch(response.headers["Content-Disposition"]!, /[\r\n]/);
    await response.close();
  }
});
test("authorized unavailable bytes are sanitized and mismatched descriptors never reach storage", async () => {
  let opens = 0;
  const service = createMediaService(
    {
      async read() {
        return descriptor;
      },
    },
    {
      async open() {
        opens++;
        throw new Error("private filesystem details");
      },
    },
  );
  const result = await service.read({ address, method: "GET", credential: "" });
  assert.equal(result.status, 503);
  assert.equal(result.body, undefined);
  const tampered = createMediaService(
    {
      async read() {
        return { ...descriptor, sha256: "b".repeat(64) };
      },
    },
    {
      async open() {
        throw new Error("must not open");
      },
    },
  );
  assert.equal(
    (await tampered.read({ address, method: "GET", credential: "" })).status,
    404,
  );
  assert.equal(opens, 1);
});

async function collect(
  source: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}
