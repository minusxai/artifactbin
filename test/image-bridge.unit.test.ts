import test from "node:test";
import assert from "node:assert/strict";
import { createImageClient } from "../src/browser/image-client.ts";
import { createImageHost } from "../src/browser/image-host.ts";
const url = "/af/v1/ids/ABC123/person-images/assignee/" + "a".repeat(64);
test("image bridge returns authorized bytes, rejects cross-page requests, and disposes cancelled/late reads", async () => {
  let context: string | null = "read-a",
    seq = 0;
  const queue: any[] = [];
  let resolve: ((value: any) => void) | undefined;
  const replies: any[] = [];
  const client = createImageClient({
    id: () => String(++seq),
    send: (m) => queue.push(m),
    schedule: () => () => {},
  });
  const host = createImageHost({
    pageId: () => "ABC123",
    authority: () => context,
    load: async () =>
      new Promise((r) => {
        resolve = r;
      }),
    reply: (r) => {
      replies.push(r);
      client.receive(r);
    },
  });
  client.setAuthority(context);
  const first = client.load(url);
  host.handle(queue.shift());
  resolve!({ mimeType: "image/webp", base64: "AQI=" });
  assert.deepEqual(
    [...new Uint8Array(await (await first).arrayBuffer())],
    [1, 2],
  );
  const old = client.load(url);
  host.handle(queue.shift());
  client.setAuthority(null);
  await assert.rejects(old, /caller/);
  host.handle(queue.shift());
  resolve!({ mimeType: "image/webp", base64: "AwQ=" });
  await new Promise((r) => setImmediate(r));
  assert.equal(replies.length, 1);
  client.setAuthority("read-b");
  context = "read-b";
  const controller = new AbortController();
  const cancelled = client.load(url, controller.signal);
  host.handle(queue.shift());
  controller.abort();
  await assert.rejects(cancelled, /cancel/);
  host.handle(queue.shift());
  resolve!({ mimeType: "image/webp", base64: "AQI=" });
  await new Promise((r) => setImmediate(r));
  assert.equal(replies.length, 1);
  host.handle({
    kind: "image-request",
    id: "bad",
    url: url.replace("ABC123", "OTHER1"),
    authorizationContext: "read-b",
  });
  assert.equal(replies.at(-1).error, "Image unavailable");
  client.dispose();
  host.invalidate();
});
test("host compares authority again after I/O even if reader ignores abort", async () => {
  let context = "a";
  let resolve: any;
  const replies: any[] = [];
  const host = createImageHost({
    pageId: () => "ABC123",
    authority: () => context,
    load: () =>
      new Promise((r) => {
        resolve = r;
      }),
    reply: (r) => replies.push(r),
  });
  host.handle({
    kind: "image-request",
    id: "one",
    url,
    authorizationContext: "a",
  });
  context = "b";
  resolve({ mimeType: "image/webp", base64: "AQI=" });
  await new Promise((r) => setImmediate(r));
  assert.equal(replies[0].error, "Image caller changed");
});
