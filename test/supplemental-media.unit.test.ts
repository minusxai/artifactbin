import test from "node:test";
import assert from "node:assert/strict";
import { createSupplementalService } from "../src/media/supplemental-service.ts";
import {
  supplementalAddress,
  parseSupplementalAddress,
} from "../src/media/supplemental-address.ts";
import type {
  SupplementalAddress,
  SupplementalDescriptor,
} from "../src/media/supplemental-contracts.ts";
const sha = "a".repeat(64);
const address: SupplementalAddress = {
  kind: "comment",
  pageId: "ABC123",
  commentId: "comment-1",
  attachmentId: "attachment-1",
  variant: "thumbnail",
};
const descriptor: SupplementalDescriptor = {
  address,
  sha256: sha,
  byteLength: 4,
  width: 1,
  height: 1,
  contentType: "image/webp",
  storageKey: sha,
  filename: "Attached image.webp",
};
function fixture() {
  let grant: SupplementalDescriptor | null = descriptor;
  let opens = 0;
  const service = createSupplementalService({
    repository: {
      async read() {
        return grant;
      },
    },
    store: {
      async open() {
        opens++;
        return {
          async *stream(range) {
            yield new Uint8Array([1, 2, 3, 4]).slice(
              range?.start ?? 0,
              (range?.end ?? 3) + 1,
            );
          },
          async close() {},
        };
      },
    },
  });
  return {
    service,
    set(next: SupplementalDescriptor | null) {
      grant = next;
    },
    opens: () => opens,
  };
}
test("canonical opaque routes reject path/query aliases and keep profile source identity private", () => {
  const path = supplementalAddress(address);
  assert.deepEqual(parseSupplementalAddress(path), address);
  const person: SupplementalAddress = {
    kind: "person",
    pageId: "ABC123",
    valueName: "reviewer",
    assetId: sha,
  };
  assert.deepEqual(
    parseSupplementalAddress(supplementalAddress(person)),
    person,
  );
  for (const path of [
    "/api/files/ABC123/comments/../attachments/a/original",
    "/af/v1/ids/ABC123/person-images/reviewer/" + sha + "?token=x",
    "/af/v1/ids/ABC123/person-images/reviewer/" + sha.toUpperCase(),
    "/api/files/ABC123/comments/comment-1/attachments/a/%6friginal",
  ])
    assert.equal(parseSupplementalAddress(path), null);
});
test("GET HEAD and ranges use the same current grant and private raster headers", async () => {
  const f = fixture();
  const get = await f.service.read({
    address,
    credential: "credential",
    method: "GET",
  });
  assert.equal(get.status, 200);
  assert.equal(get.headers["Content-Type"], "image/webp");
  assert.equal(get.headers["Cache-Control"], "private, no-store");
  assert.equal(get.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(get.headers["X-Content-Type-Options"], "nosniff");
  await get.close();
  const head = await f.service.read({
    address,
    credential: "credential",
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  await head.close();
  const range = await f.service.read({
    address,
    credential: "credential",
    method: "GET",
    range: "bytes=1-2",
  });
  assert.equal(range.status, 206);
  const chunks = [];
  for await (const chunk of range.body!) chunks.push(...chunk);
  assert.deepEqual(chunks, [2, 3]);
  await range.close();
});
test("revoked, missing or cross-comment descriptors cannot open bytes", async () => {
  const f = fixture();
  f.set(null);
  assert.equal(
    (await f.service.read({ address, credential: "expired", method: "GET" }))
      .status,
    404,
  );
  f.set({ ...descriptor, address: { ...address, commentId: "other" } });
  assert.equal(
    (await f.service.read({ address, credential: "credential", method: "GET" }))
      .status,
    404,
  );
  assert.equal(f.opens(), 0);
});
test("corrupt proof and unavailable bytes fail closed without a public URL fallback", async () => {
  const f = fixture();
  f.set({ ...descriptor, storageKey: "../escape" });
  assert.equal(
    (await f.service.read({ address, credential: "credential", method: "GET" }))
      .status,
    404,
  );
  assert.equal(f.opens(), 0);
  const service = createSupplementalService({
    repository: {
      async read() {
        return descriptor;
      },
    },
    store: {
      async open() {
        throw Error("missing");
      },
    },
  });
  assert.equal(
    (await service.read({ address, credential: "credential", method: "GET" }))
      .status,
    503,
  );
});
test("page access or descriptor changes during object open close bytes before delivery", async () => {
  for (const next of [
    null,
    { ...descriptor, address: { ...address, pageId: "OTHER1" } },
  ]) {
    let grant: SupplementalDescriptor | null = descriptor;
    let closed = 0,
      streamed = 0;
    const service = createSupplementalService({
      repository: {
        async read() {
          return grant;
        },
      },
      store: {
        async open() {
          grant = next;
          return {
            async *stream() {
              streamed++;
              yield new Uint8Array([1]);
            },
            async close() {
              closed++;
            },
          };
        },
      },
    });
    const response = await service.read({
      address,
      credential: "page-grant",
      method: "GET",
    });
    assert.equal(response.status, 404);
    assert.equal(response.body, undefined);
    assert.equal(closed, 1);
    assert.equal(streamed, 0);
  }
});
