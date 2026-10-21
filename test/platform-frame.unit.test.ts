import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPlatformSession,
  createFrameReceiver,
} from "../src/browser/platform-frame.ts";
const binding = {
  fileId: "file-a",
  share: "public-read",
  sourceRevision: "rev",
  sessionId: "view-a",
};
test("pairing keeps device and scoped token inside frame, public results only", async () => {
  const calls: any[] = [],
    events: any[] = [];
  let polls = 0;
  const session = createPlatformSession("https://service.example", binding, {
    fetch: async (url: string, options: any) => {
      calls.push({ url, ...options });
      if (url.endsWith("/api/pair"))
        return new Response(
          JSON.stringify({ code: "human-code", deviceCode: "private-device" }),
          { status: 201 },
        );
      if (url.endsWith("/poll")) {
        polls++;
        return new Response(
          JSON.stringify({
            purpose: "document",
            token: "private-token",
            username: "alice",
            unexpected: "do not forward",
          }),
        );
      }
      return new Response(JSON.stringify({ read: true }));
    },
    sleep: async () => {},
    emit: (e) => events.push(e),
  });
  assert.deepEqual(await session.handle({ kind: "pair", pairGeneration: 1 }), {
    username: "alice",
  });
  assert.deepEqual(events, [
    {
      type: "pairing",
      pairGeneration: 1,
      url: "https://service.example/connect?code=human-code",
    },
  ]);
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  assert.equal(calls.at(-1).headers.Authorization, "Bearer private-token");
  assert.equal(polls, 1);
  assert.equal(JSON.parse(calls[0].body).purpose, "document");
  assert.equal(JSON.stringify(events).includes("private"), false);
  await session.handle({ kind: "disconnect" });
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  assert.equal(calls.at(-1).headers.Authorization, "Bearer public-read");
  session.dispose();
});
test("only scoped semantic operations; no path or file retargeting", async () => {
  const calls: any[] = [];
  const session = createPlatformSession("https://service.example", binding, {
    fetch: async (url: string, o: any) => {
      calls.push({ url, ...o });
      const comment = {
        id: "../../account",
        nodeId: null,
        quote: "",
        body: "b",
        parentId: null,
        version: 1,
        author: "u",
        createdAt: "",
        revision: 0,
        resolved: false,
      };
      return new Response(JSON.stringify({ comment, source: "", state: null }));
    },
    emit: () => {},
  });
  await assert.rejects(
    session.handle({
      kind: "request",
      operation: { kind: "fetch", path: "/api/account" },
    } as any),
    /operation/,
  );
  await session.handle({
    kind: "request",
    operation: { kind: "context.get", id: "../../account" },
  });
  assert.equal(
    calls[0].url,
    "https://service.example/api/files/file-a/context/..%2F..%2Faccount",
  );
  await assert.rejects(
    session.handle({ kind: "init", binding: { ...binding, fileId: "other" } }),
    /command/,
  );
  session.dispose();
});
test("frame binds exact parent, origin and session; stale/replayed commands are ignored", async () => {
  const parent = {},
    stranger = {},
    sent: any[] = [];
  let handled = 0;
  const receive = createFrameReceiver({
    parent,
    send: (m) => sent.push(m),
    create: () => ({
      handle: async () => {
        handled++;
        return null;
      },
      dispose() {},
    }),
  });
  const message = (
    session = "nonce-1234567890123456",
    seq = 1,
    kind = "init",
  ) => ({
    pagegiPlatform: 1,
    session,
    seq,
    id: String(seq),
    command:
      kind === "init"
        ? { kind, binding }
        : { kind: "request", operation: { kind: "permissions" } },
  });
  await receive({ source: stranger, origin: "null", data: message() });
  assert.equal(sent.length, 0);
  await receive({ source: parent, origin: "null", data: message() });
  assert.equal(sent.length, 1);
  await receive({
    source: parent,
    origin: "https://evil.example",
    data: message(undefined, 2, "request"),
  });
  await receive({
    source: parent,
    origin: "null",
    data: message("wrong-session-123456789", 2, "request"),
  });
  await receive({
    source: parent,
    origin: "null",
    data: message(undefined, 1, "request"),
  });
  assert.equal(handled, 0);
  await receive({
    source: parent,
    origin: "null",
    data: message(undefined, 2, "request"),
  });
  assert.equal(handled, 1);
});
test("live reconnect/stop suppress stale callbacks and bind presence session", async () => {
  const configs: any[] = [],
    events: any[] = [],
    sent: any[] = [];
  let closed = 0;
  const session = createPlatformSession("https://service.example", binding, {
    emit: (e) => events.push(e),
    openLive: (o: any) => {
      configs.push(o);
      return {
        close() {
          closed++;
        },
        send(v: any) {
          sent.push(v);
          return true;
        },
      };
    },
  });
  await session.handle({
    kind: "live.start",
    liveGeneration: 1,
    sessionId: "view-a",
    sourceRevision: "rev",
  });
  await session.handle({
    kind: "live.start",
    liveGeneration: 1,
    sessionId: "view-a",
    sourceRevision: "next",
  });
  configs[0].onReady();
  assert.equal(events.length, 0);
  configs[1].onReady();
  assert.equal(events.length, 1);
  await session.handle({
    kind: "live.presence",
    presence: { sessionId: "spoof", cursor: null },
  });
  assert.equal(sent[0].presence.sessionId, "view-a");
  await session.handle({ kind: "live.stop" });
  configs[1].onViewers([]);
  assert.equal(events.length, 1);
  assert.equal(closed, 2);
  session.dispose();
});
test("publishing returns whitelisted publication and keeps polling credential private", async () => {
  const events: any[] = [],
    urls: string[] = [];
  const session = createPlatformSession(
    "https://service.example",
    {
      source: "<h1>hi</h1>",
      requestId: "request-a",
      sourceRevision: "rev",
      sessionId: "s",
    },
    {
      sleep: async () => {},
      emit: (e) => events.push(e),
      fetch: async (url: string, options: any) => {
        urls.push(url);
        if (url.endsWith("/publish"))
          assert.equal(JSON.parse(options.body).purpose, "document");
        return new Response(
          JSON.stringify(
            url.endsWith("/publish")
              ? { deviceCode: "secret-device", code: "public-code" }
              : url.endsWith("/poll")
                ? {
                    purpose: "document",
                    token: "secret-token",
                    username: "alice",
                    publication: {
                      fileId: "new",
                      share: "public-read",
                      sourceRevision: "newrev",
                      token: "bad-extra",
                    },
                  }
                : { read: true },
          ),
        );
      },
    },
  );
  assert.deepEqual(await session.handle({ kind: "pair", pairGeneration: 1 }), {
    username: "alice",
    publication: {
      fileId: "new",
      share: "public-read",
      sourceRevision: "newrev",
    },
  });
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  assert.ok(urls.at(-1)?.includes("/files/new/permissions"));
  assert.equal(JSON.stringify(events).includes("secret"), false);
  session.dispose();
});
test("pair expiry and disposal cannot install a late credential or emit late events", async () => {
  let clock = 0;
  const expiring = createPlatformSession("https://service.example", binding, {
    emit: () => {},
    now: () => clock,
    sleep: async () => {
      clock += 300001;
    },
    fetch: async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/poll")
            ? { pending: true }
            : { deviceCode: "device", code: "code" },
        ),
        { status: url.endsWith("/poll") ? 202 : 200 },
      ),
  });
  await assert.rejects(
    expiring.handle({ kind: "pair", pairGeneration: 1 }),
    /expired/,
  );
  expiring.dispose();
  let resolve!: (v: Response) => void;
  const events: any[] = [];
  const late = createPlatformSession("https://service.example", binding, {
    emit: (e) => events.push(e),
    fetch: () => new Promise((r) => (resolve = r)),
  });
  const pending = late.handle({ kind: "pair", pairGeneration: 1 });
  late.dispose();
  resolve(
    new Response(JSON.stringify({ deviceCode: "private", code: "code" })),
  );
  await assert.rejects(pending, /cancelled/);
  assert.equal(events.length, 0);
  await assert.rejects(
    late.handle({ kind: "request", operation: { kind: "permissions" } }),
    /disposed/,
  );
});
test("receiver bounds concurrency and stops all replies after disposal", async () => {
  const parent = {},
    sent: any[] = [],
    releases: Array<(v: any) => void> = [];
  let disposed = false;
  const receive = createFrameReceiver({
    parent,
    send: (m) => sent.push(m),
    create: () => ({
      handle: async (command: any) =>
        command.kind === "dispose"
          ? null
          : new Promise((r) => releases.push(r)),
      dispose() {
        disposed = true;
      },
    }),
  });
  const send = (seq: number, command: any) =>
    receive({
      source: parent,
      origin: "null",
      data: {
        pagegiPlatform: 1,
        session: "test-session-123456789",
        seq,
        id: String(seq),
        command,
      },
    });
  await send(1, { kind: "init", binding });
  const active = [];
  for (let i = 2; i <= 17; i++)
    active.push(
      send(i, { kind: "request", operation: { kind: "permissions" } }),
    );
  await send(18, { kind: "request", operation: { kind: "permissions" } });
  assert.match(sent.at(-1).error, /quota/);
  await send(19, { kind: "dispose" });
  assert.equal(disposed, true);
  const count = sent.length;
  for (const release of releases) release(null);
  await Promise.all(active);
  assert.equal(sent.length, count);
});
test("a downloaded file's frame opens its page without a capability, keeps the link capability and the grant inside, and comments on the file's version", async () => {
  const calls: any[] = [];
  const representation = {
    source: "<html>",
    version: 3,
    state: {
      format: 1,
      fileId: "file-a",
      sourceRevision: "digest-3",
      remote: { origin: "https://service.example", share: "link-capability", head: "digest-3" },
      anchors: {},
      comments: [],
      pending: [],
      app: null,
      snapshots: {},
      sources: { "digest-3": "<html>" },
      profiles: {},
      publishRequest: "",
    },
    seed: { filter: "all" },
    boot: {
      fileId: "file-a",
      version: 3,
      url: "https://service.example/af/v1/ids/file-a",
      token: "hosted-grant-never-forwarded",
      permissions: { role: "viewer", read: true, comment: false, edit: false, manage: false },
      username: null,
      home: "https://service.example",
      path: "/notes.html",
    },
  };
  const session = createPlatformSession(
    "https://service.example",
    { fileId: "file-a", sourceRevision: "digest-2", version: 2, sessionId: "view-a" },
    {
      fetch: async (url: string, options: any) => {
        calls.push({ url, ...options });
        if (url.endsWith("/host")) return new Response(JSON.stringify(representation));
        if (url.endsWith("/graphql"))
          return new Response(JSON.stringify({ error: "Backend refused" }), { status: 403 });
        return new Response(JSON.stringify({ id: "c1", version: 2, author: "a", createdAt: "", revision: 0, resolved: false, nodeId: null, quote: "", body: "b", parentId: null }));
      },
      emit: () => {},
    },
  );
  const page = await session.handle({ kind: "page" });
  assert.equal(calls[0].url, "https://service.example/api/library/file-a/host");
  assert.equal(calls[0].headers.Authorization, "Bearer ");
  assert.equal(page.boot.version, 3);
  assert.equal(page.state.sourceRevision, "digest-3");
  assert.equal(page.state.remote.share, "", "the link capability stays in the frame");
  assert.equal("token" in page.boot, false, "the hosted grant stays in the frame");
  assert.equal(JSON.stringify(page).includes("link-capability"), false);
  // From here on the frame reads as the link.
  await session.handle({ kind: "request", operation: { kind: "permissions" } });
  assert.equal(calls.at(-1).headers.Authorization, "Bearer link-capability");
  // A comment on the file's open version carries that version; other revisions are their numbers.
  await session.handle({
    kind: "request",
    operation: {
      kind: "comments.create",
      comment: { id: "x", nodeId: null, quote: "", body: "b", parentId: null, sourceRevision: "digest-2" },
      snapshot: null,
    },
  });
  assert.equal(JSON.parse(calls.at(-1).body).comment.version, 2);
  await session.handle({
    kind: "request",
    operation: {
      kind: "comments.create",
      comment: { id: "y", nodeId: null, quote: "", body: "b", parentId: null, sourceRevision: "1" },
      snapshot: null,
    },
  });
  assert.equal(JSON.parse(calls.at(-1).body).comment.version, 1);
  // Backend calls go out with the frame's credential, and the status comes back as it is.
  const backend = await session.handle({ kind: "backend", path: "graphql", method: "POST", body: { query: "{ team { list { id } } }", variables: {} } });
  assert.equal(calls.at(-1).url, "https://service.example/api/files/file-a/graphql");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer link-capability");
  assert.deepEqual(backend, { status: 403, body: { error: "Backend refused" } });
  await assert.rejects(session.handle({ kind: "backend", path: "../account", method: "GET" } as any), /backend/i);
  session.dispose();
});
