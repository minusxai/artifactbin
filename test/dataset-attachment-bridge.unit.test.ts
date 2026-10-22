import assert from "node:assert/strict";
import test from "node:test";
import { createAttachmentClient } from "../src/browser/dataset-attachment-client.ts";
import type { AttachmentBridgeRequest, AttachmentUpload } from "../src/browser/dataset-attachment-bridge-contracts.ts";

const upload = (): AttachmentUpload => ({ backendNamespace: "data", bindingName: "files", requestId: "request-0001", filename: "image.png", contentType: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) });
function fixture() {
  const sent: AttachmentBridgeRequest[] = [], timers = new Set<() => void>();
  let seq = 0;
  const client = createAttachmentClient({ send: (m) => { sent.push(m); }, id: () => `request-${++seq}`, schedule: (f) => { timers.add(f); return () => { timers.delete(f); }; } });
  return { client, sent, timers };
}
test("attachment uploads preserve binary identity and require authority before sending", async () => {
  const { client, sent } = fixture(), request = upload();
  await assert.rejects(client.upload(request), /unavailable/i);
  assert.equal(sent.length, 0);
  client.setAuthority("epoch-one");
  const result = client.upload(request);
  const message = sent[0];
  assert.equal(message?.kind, "attachment-upload");
  if (message?.kind !== "attachment-upload") throw Error("Missing upload");
  assert.equal(message.request.blob, request.blob);
  client.receive({ id: message.id, receipt: { ref: `dfile:${"a".repeat(32)}`, url: "/protected", name: request.filename, contentType: "image/png", size: 3 } });
  assert.equal((await result).size, 3);
});
test("authority loss cancels uploads and late receipts cannot restore the old caller", async () => {
  const { client, sent, timers } = fixture();
  client.setAuthority("epoch-one");
  const result = client.upload(upload());
  const rejection = assert.rejects(result, /unknown|caller/i);
  client.setAuthority(null);
  assert.equal(sent.at(-1)?.kind, "attachment-cancel");
  client.receive({ id: sent[0]!.id, receipt: { ref: `dfile:${"a".repeat(32)}`, name: "image.png", url: "/protected", size: 3, contentType: "image/png" } });
  await rejection;
  assert.equal(timers.size, 0);
  await assert.rejects(client.upload(upload()), /unavailable/i);
});
test("oversized and invalid MIME requests never enter the bridge", async () => {
  const { client, sent } = fixture(); client.setAuthority("epoch-one");
  await assert.rejects(client.upload({ ...upload(), blob: new Blob([new Uint8Array(50_000_001)]) }), /invalid|large/i);
  await assert.rejects(client.upload({ ...upload(), contentType: "text/html" as never }), /invalid/i);
  await assert.rejects(client.read({ backendNamespace: "data", bindingName: "files", ref: "https://example.invalid/image" }), /invalid/i);
  assert.equal(sent.length, 0);
});
test("an uncertain upload is not automatically retried or replaced", async () => {
  const { client, sent, timers } = fixture(); client.setAuthority("epoch-one");
  const request = upload(), result = client.upload(request), rejection = assert.rejects(result, /unknown/i);
  for (const timer of [...timers]) timer();
  await rejection;
  assert.equal(sent.filter((m) => m.kind === "attachment-upload").length, 1);
  const retry = client.upload(request), retryRejection = assert.rejects(retry);
  const message = sent.at(-1);
  assert.equal(message?.kind, "attachment-upload");
  if (message?.kind === "attachment-upload") {
    assert.equal(message.request.requestId, request.requestId);
    assert.equal(message.request.blob, request.blob);
  }
  client.dispose(); await retryRejection;
});
test("queued upload metadata is snapshotted and concurrency is bounded", async () => {
  const { client, sent } = fixture(); client.setAuthority("epoch-one");
  const request = upload(), first = client.upload(request), firstRejection = assert.rejects(first);
  request.filename = "changed.png";
  const firstMessage = sent[0];
  assert.equal(firstMessage?.kind === "attachment-upload" && firstMessage.request.filename, "image.png");
  const second = client.upload(upload()), secondRejection = assert.rejects(second);
  await assert.rejects(client.upload(upload()), /too many/i);
  assert.equal(sent.filter((m) => m.kind === "attachment-upload").length, 2);
  client.dispose(); await Promise.all([firstRejection, secondRejection]);
});
test("aborted reads release their timers and a reauthorized client accepts only its new reply", async () => {
  const { client, sent, timers } = fixture(); client.setAuthority("old");
  const controller = new AbortController();
  const first = client.read({ backendNamespace: "data", bindingName: "files", ref: `dfile:${"b".repeat(32)}` }, controller.signal);
  const rejected = assert.rejects(first); controller.abort(); await rejected;
  assert.equal(timers.size, 0);
  client.setAuthority("new");
  const second = client.read({ backendNamespace: "data", bindingName: "files", ref: `dfile:${"b".repeat(32)}` });
  client.receive({ id: sent[0]!.id, blob: new Blob(["stale"], { type: "image/png" }) });
  const message = sent.at(-1)!;
  client.receive({ id: message.id, blob: new Blob(["fresh"], { type: "image/png" }) });
  assert.equal(await (await second).text(), "fresh"); assert.equal(timers.size, 0);
});
test("attachment availability is typed, scope-bound and invalidated with its caller", async () => {
  const { client, sent } = fixture(); client.setAuthority("epoch-one");
  const result = client.availability({ backendNamespace: "data", bindingName: "files" });
  assert.equal(sent[0]?.kind, "attachment-availability");
  client.receive({ id: sent[0]!.id, availability: { canAttempt: true } });
  assert.deepEqual(await result, { canAttempt: true });
  const pending = client.availability({ backendNamespace: "data", bindingName: "files" }), rejected = assert.rejects(pending);
  client.setAuthority(null); await rejected;
});
