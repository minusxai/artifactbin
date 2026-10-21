import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformClient } from "../src/browser/platform-client.ts";
function environment() {
  const events = new Map<string, Function>(),
    sent: any[] = [],
    loads: Function[] = [];
  let removed = false;
  const remote = {
    postMessage: (message: any, origin: string) =>
      sent.push({ message, origin }),
  };
  const iframe = {
    hidden: false,
    title: "",
    tabIndex: 0,
    src: "",
    sandbox: { add() {} },
    setAttribute() {},
    addEventListener(_name: string, fn: Function) {
      loads.push(fn);
    },
    contentWindow: remote,
    remove() {
      removed = true;
    },
  };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"),
    oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (name: string, fn: Function) => events.set(name, fn),
      removeEventListener: (name: string) => events.delete(name),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => iframe,
      body: { append: () => loads[0]?.() },
    },
  });
  return {
    sent,
    remote,
    iframe,
    get removed() {
      return removed;
    },
    respond(
      data: any,
      source: any = remote,
      origin = "https://service.example",
    ) {
      events.get("message")?.({ source, origin, data });
    },
    restore() {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
      else delete (globalThis as any).window;
      if (oldDocument)
        Object.defineProperty(globalThis, "document", oldDocument);
      else delete (globalThis as any).document;
    },
  };
}
test("client rejects wrong window/origin/session responses and disposes pending requests", async () => {
  const env = environment();
  let client;
  try {
    client = createPlatformClient({
      origin: "https://service.example",
      fileId: "f",
      share: "public",
      sourceRevision: "r",
      sessionId: "s",
    });
    const init = env.sent[0].message;
    const response = {
      pagegiPlatform: 1,
      session: init.session,
      kind: "response",
      id: init.id,
      ok: true,
      value: null,
    };
    let ready = false;
    client.ready.then(() => (ready = true));
    env.respond(response, {});
    env.respond(response, env.remote, "https://evil.example");
    env.respond({ ...response, session: "wrong" });
    await Promise.resolve();
    assert.equal(ready, false);
    env.respond(response);
    await client.ready;
    const pending = client.request({ kind: "permissions" });
    await Promise.resolve();
    const request = env.sent.at(-1).message;
    assert.deepEqual(request.command, {
      kind: "request",
      operation: { kind: "permissions" },
    });
    assert.equal(env.sent.at(-1).origin, "https://service.example");
    client.dispose();
    await assert.rejects(pending, /disposed/);
    assert.equal(env.removed, true);
    await assert.rejects(client.request({ kind: "permissions" }), /disposed/);
  } finally {
    client?.dispose();
    env.restore();
  }
});
test("insecure remote URL cannot create a credential frame", () => {
  assert.throws(
    () =>
      createPlatformClient({
        origin: "http://remote.example",
        sourceRevision: "r",
        sessionId: "s",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      createPlatformClient({
        origin: "https://user:password@service.example",
        sourceRevision: "r",
        sessionId: "s",
      }),
    /HTTPS/,
  );
});
test("an untrusted same-origin document cannot create a credential-holding frame", () => {
  const env = environment();
  try {
    (globalThis as any).window.location = { origin: "https://service.example" };
    assert.throws(
      () =>
        createPlatformClient({
          origin: "https://service.example",
          fileId: "f",
          share: "public",
          sourceRevision: "r",
          sessionId: "s",
        }),
      /separate origin/,
    );
  } finally {
    env.restore();
  }
});
test("failed initialization removes its frame and rejects subsequent work", async () => {
  const env = environment();
  let client;
  try {
    client = createPlatformClient({
      origin: "https://service.example",
      fileId: "f",
      share: "public",
      sourceRevision: "r",
      sessionId: "s",
    });
    const init = env.sent[0].message;
    env.respond({
      pagegiPlatform: 1,
      session: init.session,
      kind: "response",
      id: init.id,
      ok: false,
      error: "Invalid platform binding",
    });
    await assert.rejects(client.ready, /Invalid platform binding/);
    assert.equal(env.removed, true);
    await assert.rejects(client.pair(), /Invalid platform binding/);
  } finally {
    client?.dispose();
    env.restore();
  }
});

test("queued live events from previous subscription are rejected after restart and stop", async () => {
  const env = environment();
  let client;
  const events: any[] = [];
  try {
    client = createPlatformClient({
      origin: "https://service.example",
      fileId: "f",
      share: "public",
      sourceRevision: "r",
      sessionId: "s",
      onEvent: (event) => events.push(event),
    });
    const init = env.sent[0].message;
    const ack = (request: any) =>
      env.respond({
        pagegiPlatform: 1,
        session: init.session,
        kind: "response",
        id: request.id,
        ok: true,
        value: null,
      });
    const deliver = (generation: number) =>
      env.respond({
        pagegiPlatform: 1,
        session: init.session,
        kind: "event",
        event: { type: "changed", liveGeneration: generation },
      });
    ack(init);
    await client.ready;
    const first = client.startLive({ sessionId: "s", sourceRevision: "r" });
    await Promise.resolve();
    const old = env.sent.at(-1).message;
    ack(old);
    await first;
    assert.equal(typeof old.command.liveGeneration, "number");
    const second = client.startLive({ sessionId: "s", sourceRevision: "r2" });
    deliver(old.command.liveGeneration);
    assert.equal(events.length, 0);
    await Promise.resolve();
    const current = env.sent.at(-1).message;
    ack(current);
    await second;
    deliver(old.command.liveGeneration);
    assert.equal(events.length, 0);
    deliver(current.command.liveGeneration);
    assert.equal(events.length, 1);
    const stop = client.stopLive();
    deliver(current.command.liveGeneration);
    assert.equal(events.length, 1);
    await Promise.resolve();
    ack(env.sent.at(-1).message);
    await stop;
  } finally {
    client?.dispose();
    env.restore();
  }
});
test("queued pairing URLs are filtered across new pairing and disconnect generations", async () => {
  const env = environment();
  let client;
  const events: any[] = [];
  try {
    client = createPlatformClient({
      origin: "https://service.example",
      fileId: "f",
      share: "public",
      sourceRevision: "r",
      sessionId: "s",
      onEvent: (e) => events.push(e),
    });
    const init = env.sent[0].message;
    const ack = (m: any) =>
      env.respond({
        pagegiPlatform: 1,
        session: init.session,
        kind: "response",
        id: m.id,
        ok: true,
        value: { username: "alice" },
      });
    const deliver = (pairGeneration: number) =>
      env.respond({
        pagegiPlatform: 1,
        session: init.session,
        kind: "event",
        event: {
          type: "pairing",
          url: "https://service.example/connect?code=public",
          pairGeneration,
        },
      });
    ack(init);
    await client.ready;
    const first = client.pair();
    await Promise.resolve();
    const old = env.sent.at(-1).message;
    ack(old);
    await first;
    const next = client.pair();
    deliver(old.command.pairGeneration);
    assert.equal(events.length, 0);
    await Promise.resolve();
    const current = env.sent.at(-1).message;
    assert.ok(current.command.pairGeneration > old.command.pairGeneration);
    deliver(current.command.pairGeneration);
    assert.equal(events.length, 1);
    ack(current);
    await next;
    const disconnected = client.disconnect();
    deliver(current.command.pairGeneration);
    assert.equal(events.length, 1);
    await Promise.resolve();
    ack(env.sent.at(-1).message);
    await disconnected;
  } finally {
    client?.dispose();
    env.restore();
  }
});
