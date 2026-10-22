import test from "node:test";
import assert from "node:assert/strict";
import { createAttachmentAccess } from "../src/browser/dataset-attachment-access.ts";
import type { RemoteAccessSnapshot } from "../src/apollo/apollo-contracts.ts";
import type { AttachmentPort } from "../src/browser/dataset-attachment-bridge-contracts.ts";
function setup() {
  let access: RemoteAccessSnapshot = {
      epoch: null,
      state: "pending",
      context: null,
    },
    calls = 0;
  const listeners = new Set<() => void>();
  let finish!: (value: any) => void;
  const transport: AttachmentPort = {
    availability: async () => {
      calls++;
      return { canAttempt: true };
    },
    read: async () => {
      calls++;
      return new Blob(["image"]);
    },
    upload: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const adapter = createAttachmentAccess({
    transport: () => transport,
    access: () => access,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  });
  return {
    adapter,
    listeners,
    calls: () => calls,
    finish: () =>
      finish({
        ref: "opaque",
        url: "fixed",
        name: "image",
        contentType: "image/png",
        size: 5,
      }),
    set(next: RemoteAccessSnapshot) {
      access = next;
      for (const fn of [...listeners]) fn();
    },
  };
}
const allowed: RemoteAccessSnapshot = {
  epoch: 1,
  state: "allowed",
  context: "opaque-context",
};
test("internal attachment access denies pending/denied and retained ports after revocation", async () => {
  const s = setup();
  assert.equal(s.adapter.transport(), null);
  assert.equal(s.adapter.authority(), null);
  s.set(allowed);
  const port = s.adapter.transport()!;
  assert.deepEqual(
    await port.availability({
      backendNamespace: "data",
      bindingName: "picture",
    }),
    { canAttempt: true },
  );
  s.set({ ...allowed, state: "denied" });
  assert.equal(s.adapter.transport(), null);
  await assert.rejects(
    port.read({
      backendNamespace: "data",
      bindingName: "picture",
      ref: "opaque",
    }),
    /unavailable/,
  );
  assert.equal(s.calls(), 1);
});
test("revocation after upload dispatch reports unknown and suppresses late receipt", async () => {
  const s = setup();
  s.set(allowed);
  const upload = s.adapter.transport()!.upload({
    backendNamespace: "data",
    bindingName: "picture",
    requestId: "id",
    filename: "a.png",
    contentType: "image/png",
    blob: new Blob(["image"], { type: "image/png" }),
  });
  await Promise.resolve();
  s.set({ ...allowed, epoch: 2, state: "denied", context: null });
  s.finish();
  await assert.rejects(upload, /unknown/);
});
test("disposal notifies subscribers once and makes retained capability terminal", async () => {
  const s = setup();
  s.set(allowed);
  let changed = 0;
  const stop = s.adapter.subscribe(() => changed++);
  const port = s.adapter.transport()!;
  s.adapter.dispose();
  s.adapter.dispose();
  assert.equal(changed, 1);
  assert.equal(s.listeners.size, 0);
  assert.equal(s.adapter.authority(), null);
  assert.equal(s.adapter.transport(), null);
  await assert.rejects(
    port.availability({ backendNamespace: "data", bindingName: "picture" }),
    /unavailable/,
  );
  stop();
  assert.equal(s.calls(), 0);
});
