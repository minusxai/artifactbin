import test from "node:test";
import assert from "node:assert/strict";
import { createCollaborationTransport } from "../src/browser/collaboration-transport.ts";
test("transport maps typed operations once, encodes IDs and preserves abort and HTTP errors", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const transport = createCollaborationTransport({
    sessionId: "s",
    connection: () => ({
      origin: "https://example.test",
      fileId: "a/b",
      token: "t",
      sourceRevision: "r",
    }),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init! });
      return new Response(
        JSON.stringify(status === 200 ? { ok: true } : { error: "Denied" }),
        { status },
      );
    },
  });
  const signal = new AbortController().signal;
  await transport.request(
    { kind: "comments.resolve", id: "c/d", revision: 2 },
    signal,
  );
  assert.equal(
    requests[0]!.url,
    "https://example.test/api/files/a%2Fb/comments/c%2Fd",
  );
  assert.equal(requests[0]!.init.method, "PUT");
  assert.equal(requests[0]!.init.signal, signal);
  assert.equal(
    (requests[0]!.init.headers as Record<string, string>)["If-Match"],
    "2",
  );
  status = 403;
  await assert.rejects(
    transport.request({ kind: "permissions" }, signal),
    /Denied/,
  );
});

test("every operation has an explicit HTTP contract and websocket refreshes credentials", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let token = "old";
  let captured: any;
  const sent: unknown[] = [];
  const transport = createCollaborationTransport({
    sessionId: "s",
    connection: () => ({
      origin: "https://example.test",
      fileId: "f",
      token,
      sourceRevision: "r",
    }),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init! });
      const record = {
        id: "a",
        nodeId: "n1",
        quote: "",
        body: "b",
        parentId: null,
        version: 1,
        author: "u",
        createdAt: "",
        revision: 0,
        resolved: false,
      };
      const path = new URL(String(url)).pathname;
      return new Response(
        JSON.stringify(
          path.endsWith("/comments") && init?.method === "GET"
            ? { comments: [record], head: 1 }
            : path.endsWith("/comments")
              ? record
              : path.includes("/context/")
                ? { comment: record, source: "<p>", state: null }
                : {},
        ),
      );
    },
    openLive(options) {
      captured = options;
      return {
        close() {
          sent.push("close");
        },
        send(v) {
          sent.push(v);
          return true;
        },
      };
    },
  });
  const cases: any[] = [
    [{ kind: "permissions" }, "/permissions", "GET"],
    [{ kind: "comments.list" }, "/comments", "GET"],
    [
      { kind: "comments.create", comment: { id: 1 }, snapshot: null },
      "/comments",
      "POST",
    ],
    [{ kind: "context.get", id: "a" }, "/context/a", "GET"],
    [{ kind: "profiles.list" }, "/profiles", "GET"],
    [{ kind: "presence.capture", sessionId: "s" }, "/capture", "POST"],
  ];
  for (const [op, path, method] of cases) {
    await transport.request(op, new AbortController().signal);
    const req = requests.at(-1)!;
    assert.ok(req.url.endsWith(path));
    assert.equal(req.init.method, method);
  }
  const live = transport.connect({
    ready() {},
    viewers() {},
    changed() {},
    status() {},
  });
  assert.equal(captured.url, "wss://example.test/api/files/f/live");
  token = "new";
  assert.equal(captured.auth().token, "new");
  live.send({ sessionId: "s" });
  live.cursor!(null);
  live.close();
  assert.deepEqual(sent, [
    { type: "presence", presence: { sessionId: "s" } },
    { type: "cursor", cursor: null },
    "close",
  ]);
});

test("broker retired subscriptions ignore failed startup and cannot stop a replacement", async () => {
  const { createBrokerCollaborationTransport } = await import(
    "../src/browser/collaboration-transport.ts"
  );
  const errors: string[] = [];
  let reject!: (e: Error) => void,
    stops = 0;
  const sent: unknown[] = [];
  const client: any = {
    request: async (op: unknown) => op,
    startLive: () => new Promise<void>((_, r) => (reject = r)),
    stopLive: async () => {
      stops++;
    },
    sendPresence: async (v: unknown) => {
      sent.push(v);
      return true;
    },
  };
  const transport = createBrokerCollaborationTransport({
    client: () => client,
    binding: () => ({ sessionId: "s", sourceRevision: "r" }),
    presence: () => ({ sessionId: "s", visible: true }),
  });
  const callbacks = {
    ready() {
      errors.push("ready");
    },
    viewers() {
      errors.push("viewers");
    },
    changed() {
      errors.push("changed");
    },
    status(s: string) {
      errors.push(s);
    },
  };
  const first = transport.connect(callbacks);
  const oldReject = reject;
  first.close();
  transport.event({ type: "changed" });
  const second = transport.connect({ ...callbacks });
  oldReject(Error("old"));
  await Promise.resolve();
  first.close();
  first.send({ sessionId: "s" });
  second.cursor!(null);
  assert.equal(stops, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(sent, [{ sessionId: "s", visible: true, cursor: null }]);
  transport.event({ type: "live-ready" });
  transport.event({ type: "viewers", viewers: [] });
  transport.event({ type: "changed" });
  transport.event({ type: "status", status: "live" });
  assert.deepEqual(errors, ["ready", "viewers", "changed", "live"]);
  reject(Error("failed"));
  await Promise.resolve();
  assert.equal(errors.at(-1), "error");
  second.close();
  assert.equal(stops, 2);
});
