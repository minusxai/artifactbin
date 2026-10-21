import { test } from "node:test";
import { jsonCopy } from "../src/json.ts";
import assert from "node:assert/strict";
import { createConnectionCoordinator } from "../src/browser/connection-coordinator.ts";
import type {
  PlatformClient,
  PlatformEvent,
} from "../src/browser/platform-contracts.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(local = true) {
  let origin: string | undefined;
  let active = true;
  let epoch = 0;
  let clientCount = 0;
  let clientDisposed = 0;
  let popupClosed = 0;
  let event!: (event: PlatformEvent) => void;
  let pair: () => Promise<any> = async () => ({
    username: "person",
    publication: { fileId: "doc", share: "share", sourceRevision: "s" },
  });
  const events: string[] = [];
  let result: any;
  const coordinator = createConnectionCoordinator({
    local,
    binding: () => ({
      origin,
      sourceRevision: "s",
      sessionId: "session",
      source: "<html/>",
    }),
    gate: {
      get epoch() {
        return epoch;
      },
      get active() {
        return active;
      },
      accepts: (e) => active && e === epoch,
      assert: (e) => {
        if (!active || e !== epoch) throw Error("obsolete");
      },
    },
    createClient: (options) => {
      clientCount++;
      event = options.onEvent;
      return {
        ready: Promise.resolve(),
        pair: () => pair(),
        disconnect: async () => {
          events.push("disconnect");
        },
        dispose: () => clientDisposed++,
      } as unknown as PlatformClient;
    },
    trusted: {
      connect: async (_origin, binding) => {
        jsonCopy(binding);
        assert.equal("origin" in binding, false);
        return { ...(await pair()), token: "secret" };
      },
      cancel: () => events.push("cancel"),
    },
    openPopup: () => {
      events.push("popup");
      return {
        navigate: (url) => events.push(url),
        close: () => popupClosed++,
      };
    },
    approveLink: (url) => events.push(url),
    onEvent: () => events.push("event"),
    apply: (r) => {
      result = r;
      events.push("apply");
      origin = r.origin;
    },
    connected: async () => {
      events.push("connected");
    },
  });
  return {
    coordinator,
    events,
    get result() {
      return result;
    },
    get clients() {
      return clientCount;
    },
    get disposed() {
      return clientDisposed;
    },
    get closed() {
      return popupClosed;
    },
    event: (e: PlatformEvent) => event(e),
    set pair(fn: () => Promise<any>) {
      pair = fn;
    },
    invalidate() {
      active = false;
      epoch++;
    },
  };
}
test("local publication opens approval, then applies binding before connecting", async () => {
  const f = fixture();
  await f.coordinator.connect("https://platform.example/path");
  assert.deepEqual(f.events, ["popup", "apply", "connected"]);
  assert.equal(f.result.session, true);
  assert.equal(f.result.origin, "https://platform.example");
  assert.equal(f.closed, 1);
  f.coordinator.dispose();
});
test("trusted shell receives credentialed identity without creating a credential iframe client", async () => {
  const f = fixture(false);
  await f.coordinator.connect("https://platform.example");
  assert.equal(f.result.session, "secret");
  assert.equal("token" in f.result, false);
  assert.equal(f.clients, 0);
  f.coordinator.dispose();
});
test("late pairing after suspension never applies authority, and invalid origins never open a popup", async () => {
  const f = fixture();
  let release!: (value: any) => void;
  f.pair = () => new Promise((resolve) => (release = resolve));
  const pending = f.coordinator.connect("https://platform.example");
  await tick();
  f.invalidate();
  release({ username: "person" });
  await pending;
  assert.equal(f.result, undefined);
  assert.equal(f.closed, 1);
  await assert.rejects(f.coordinator.connect("http://remote.example"), /HTTPS/);
  await assert.rejects(
    f.coordinator.connect("https://name:password@platform.example"),
    /HTTPS/,
  );
  f.coordinator.dispose();
});

test("broker is reused only for the same authority, and disposal closes its lifetime", async () => {
  const f = fixture();
  const first = f.coordinator.broker("https://one.example");
  await tick();
  assert.equal(f.coordinator.broker("https://one.example/path"), first);
  assert.equal(f.clients, 1);
  f.coordinator.broker("https://two.example");
  assert.equal(f.clients, 2);
  assert.equal(f.disposed, 1);
  f.coordinator.dispose();
  assert.equal(f.disposed, 2);
  assert.throws(() => f.coordinator.broker("https://one.example"), /disposed/);
});
test("explicit cancellation closes approval and suppresses a late pairing result", async () => {
  const f = fixture();
  let release!: (value: any) => void;
  f.pair = () => new Promise((resolve) => (release = resolve));
  const pairing = f.coordinator.connect("https://platform.example");
  await tick();
  f.coordinator.cancel();
  release({ username: "late" });
  await pairing;
  assert.equal(f.result, undefined);
  assert.equal(f.closed, 1);
  assert.ok(!f.events.includes("apply"));
  assert.equal(f.disposed, 1);
  f.coordinator.dispose();
});
test("pairing links follow the current approval popup", async () => {
  const f = fixture();
  let release!: (value: any) => void;
  f.pair = () => new Promise((resolve) => (release = resolve));
  const pairing = f.coordinator.connect("https://platform.example");
  await tick();
  f.event({
    type: "pairing",
    url: "https://platform.example/pair",
    pairGeneration: 1,
  });
  release({ username: "person" });
  await pairing;
  f.coordinator.dispose();
});
