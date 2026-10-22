import assert from "node:assert/strict";
import test from "node:test";
import { createAttachmentHost } from "../src/browser/dataset-attachment-host.ts";
import type { AttachmentBridgeReply, AttachmentReceipt } from "../src/browser/dataset-attachment-bridge-contracts.ts";
const receipt: AttachmentReceipt = { ref: `dfile:${"a".repeat(32)}`, url: "/api/files/fixture/dataset-attachments/data/images/" + "a".repeat(32), name: "image.png", contentType: "image/png", size: 3 };
const message = (id: string) => ({ kind: "attachment-upload", id, authorizationContext: "epoch-one", request: { backendNamespace: "data", bindingName: "images", requestId: "request-0001", filename: "image.png", contentType: "image/png", blob: new Blob(["abc"], { type: "image/png" }) } });
test("host denies absent/mismatched authority before invoking transport", async () => {
  let calls = 0, context: string | null = null;
  const replies: AttachmentBridgeReply[] = [];
  const host = createAttachmentHost({ pageId: () => "fixture", authority: () => context, active: () => true, port: { async upload() { calls++; return receipt; }, async read() { throw Error("unexpected"); } }, reply: (r) => replies.push(r) });
  assert.equal(host.handle(message("one")), true);
  context = "different"; host.handle(message("two"));
  assert.equal(calls, 0); assert.equal(replies.length, 2);
});
test("authority changes during upload reject completion and invalidate aborts work", async () => {
  let resolve!: (value: AttachmentReceipt) => void, context: string | null = "epoch-one", observed: AbortSignal | undefined;
  const replies: AttachmentBridgeReply[] = [];
  const host = createAttachmentHost({ pageId: () => "fixture", authority: () => context, active: () => true, port: { upload: (_r, signal) => { observed = signal; return new Promise((r) => { resolve = r; }); }, async read() { throw Error("unexpected"); } }, reply: (r) => replies.push(r) });
  host.handle(message("one")); context = null;
  resolve(receipt); await new Promise((r) => setImmediate(r));
  assert.deepEqual(replies, [{ id: "one", error: "unknown" }]);
  context = "epoch-one"; host.handle(message("two")); host.invalidate();
  assert.equal(observed?.aborted, true);
  resolve(receipt); await new Promise((r) => setImmediate(r));
  assert.equal(replies.length, 1);
});
test("host bounds concurrency and never trusts receipt URL outside the captured scope", async () => {
  let calls = 0;
  const replies: AttachmentBridgeReply[] = [];
  const host = createAttachmentHost({ pageId: () => "fixture", authority: () => "epoch-one", active: () => true, port: { async upload() { calls++; return { ...receipt, url: "https://example.invalid/image" }; }, async read() { throw Error("unexpected"); } }, reply: (r) => replies.push(r) });
  host.handle(message("one")); host.handle(message("two")); host.handle(message("three"));
  assert.equal(calls, 2);
  await new Promise((r) => setImmediate(r));
  assert.equal(replies.length, 3);
  assert.ok(replies.every((r) => "error" in r));
});
test("cancelled transport retains admission until its cleanup settles", async () => {
  let calls = 0;
  const settle: ((receipt: AttachmentReceipt) => void)[] = [], replies: AttachmentBridgeReply[] = [];
  const host = createAttachmentHost({ pageId: () => "fixture", authority: () => "epoch-one", active: () => true, port: { upload: () => { calls++; return new Promise((resolve) => settle.push(resolve)); }, async read() { throw Error("unexpected"); } }, reply: (r) => replies.push(r) });
  host.handle(message("one")); host.handle(message("two"));
  host.handle({ kind: "attachment-cancel", id: "one" }); host.handle(message("three"));
  assert.equal(calls, 2); assert.deepEqual(replies, [{ id: "three", error: "unavailable" }]);
  settle[0]!(receipt); await new Promise((r) => setImmediate(r));
  host.handle(message("four")); assert.equal(calls, 3);
  host.invalidate(); for (const resolve of settle) resolve(receipt);
});
