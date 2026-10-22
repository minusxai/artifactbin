import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformSession } from "../src/browser/platform-frame.ts";
import {
  platformImageBlob,
  readPlatformImage,
  PLATFORM_IMAGE_MAX_BYTES,
} from "../src/browser/platform-image.ts";
const address = {
  kind: "comment" as const,
  pageId: "ABC123",
  commentId: "comment",
  attachmentId: "attachment",
  variant: "thumbnail" as const,
};
test("image bridge binds page and fresh read epoch; credential remains in frame and image bytes only return", async () => {
  const calls: any[] = [];
  const session = createPlatformSession(
    "https://service.example",
    {
      fileId: "ABC123",
      share: "synthetic-private",
      sourceRevision: "1",
      sessionId: "viewer",
    },
    {
      emit() {},
      async fetch(url, options) {
        calls.push({ url, options });
        return url.endsWith("permissions")
          ? Response.json({ read: true, authorizationContext: "epoch" })
          : new Response(new Uint8Array([1, 2, 255]), {
              headers: { "Content-Type": "image/webp" },
            });
      },
    },
  );
  await assert.rejects(
    session.handle({
      kind: "image",
      id: "image-request",
      address,
      authorizationContext: "epoch",
    }),
    /caller/,
  );
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  const value = await session.handle({
    kind: "image",
    id: "image-request",
    address,
    authorizationContext: "epoch",
  });
  assert.deepEqual(
    [...new Uint8Array(await platformImageBlob(value).arrayBuffer())],
    [1, 2, 255],
  );
  assert.equal(JSON.stringify(value).includes("synthetic-private"), false);
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer synthetic-private",
  );
  assert.equal(calls[1].options.credentials, "omit");
  assert.equal(calls[1].options.redirect, "error");
  await assert.rejects(
    session.handle({
      kind: "image",
      id: "image-request",
      address: { ...address, pageId: "OTHER1" },
      authorizationContext: "epoch",
    }),
    /another page/,
  );
  await session.handle({ kind: "disconnect" });
  await assert.rejects(
    session.handle({
      kind: "image",
      id: "image-request",
      address,
      authorizationContext: "epoch",
    }),
    /caller/,
  );
  session.dispose();
});
test("image bridge rejects oversized, wrong MIME and malformed encoded data", async () => {
  await assert.rejects(
    readPlatformImage(
      new Response(new Uint8Array(PLATFORM_IMAGE_MAX_BYTES + 1), {
        headers: { "Content-Type": "image/webp" },
      }),
    ),
    /large/,
  );
  await assert.rejects(
    readPlatformImage(
      new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    ),
    /Invalid/,
  );
  assert.throws(
    () => platformImageBlob({ mimeType: "image/webp", base64: "%%%%" }),
    /Invalid/,
  );
});
test("pending image replies cannot survive final credential owner disconnect", async () => {
  let release: any;
  const session = createPlatformSession(
    "https://service.example",
    {
      fileId: "ABC123",
      share: "synthetic-private",
      sourceRevision: "1",
      sessionId: "viewer",
    },
    {
      emit() {},
      async fetch(url) {
        if (url.endsWith("permissions"))
          return Response.json({ read: true, authorizationContext: "epoch" });
        return new Promise((r) => {
          release = r;
        });
      },
    },
  );
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  const pending = session.handle({
    kind: "image",
    id: "image-request",
    address,
    authorizationContext: "epoch",
  });
  await session.handle({ kind: "disconnect" });
  release(
    new Response(new Uint8Array([1]), {
      headers: { "Content-Type": "image/webp" },
    }),
  );
  await assert.rejects(pending, /cancel|abort/i);
  session.dispose();
});
test("final image owner aborts cancelled and stale live-epoch reads before emitting bytes", async () => {
  let live: any, release: any, signal: AbortSignal | undefined;
  const session = createPlatformSession(
    "https://service.example",
    {
      fileId: "ABC123",
      share: "synthetic-private",
      sourceRevision: "1",
      sessionId: "viewer",
    },
    {
      emit() {},
      openLive: ((options: any) => {
        live = options;
        return {
          close() {},
          send() {
            return true;
          },
        };
      }) as any,
      async fetch(url, options) {
        if (url.endsWith("permissions"))
          return Response.json({ read: true, authorizationContext: "epoch" });
        signal = options.signal as AbortSignal;
        return new Promise((r) => {
          release = r;
        });
      },
    },
  );
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  const pending = session.handle({
    kind: "image",
    id: "one",
    address,
    authorizationContext: "epoch",
  });
  await session.handle({ kind: "image.cancel", id: "one" });
  assert.equal(signal?.aborted, true);
  release(
    new Response(new Uint8Array([1]), {
      headers: { "Content-Type": "image/webp" },
    }),
  );
  await assert.rejects(pending, /abort|cancel/i);
  await session.handle({
    kind: "live.start",
    sessionId: "viewer",
    sourceRevision: "1",
    liveGeneration: 1,
  });
  const stale = session.handle({
    kind: "image",
    id: "two",
    address,
    authorizationContext: "epoch",
  });
  live.onChanged();
  assert.equal(signal?.aborted, true);
  release(
    new Response(new Uint8Array([1]), {
      headers: { "Content-Type": "image/webp" },
    }),
  );
  await assert.rejects(stale, /abort|cancel/i);
  session.dispose();
});
