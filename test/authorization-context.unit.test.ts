import test from "node:test";
import assert from "node:assert/strict";
import {
  callerAuthorizationContext,
  guestAuthorizationContext,
} from "../src/server/caller-authorization-context.ts";
import { createRemoteClient } from "../src/browser/remote-client.ts";
import { createClient, createLocalStore } from "../src/apollo/client.ts";

test("opaque context survives same principal reload but separates pages and account incarnations", () => {
  const key = callerAuthorizationContext("page-a", "incarnation-a");
  assert.equal(callerAuthorizationContext("page-a", "incarnation-a"), key);
  assert.notEqual(callerAuthorizationContext("page-b", "incarnation-a"), key);
  assert.notEqual(callerAuthorizationContext("page-a", "incarnation-b"), key);
  assert.equal(callerAuthorizationContext("page-a", undefined), null);
  assert.ok(key && !key.includes("incarnation-a"));
});

test("trusted context reaches client, clears on signout/revocation and never survives disposal", () => {
  const remote = createRemoteClient({
    send() {},
    id: () => "request",
    online: () => true,
    schedule: () => () => {},
  });
  const client = createClient({
    state: createLocalStore({}),
    remote: remote.port,
    backends: [],
  });
  assert.equal(client.authorizationContext(), null);
  remote.setAuthorizationContext("opaque-a");
  assert.equal(client.authorizationContext(), "opaque-a");
  remote.setAuthorizationContext(null);
  assert.equal(client.authorizationContext(), null);
  remote.setAuthorizationContext("opaque-b");
  assert.equal(client.authorizationContext(), "opaque-b");
  remote.dispose();
  assert.equal(client.authorizationContext(), null);
});

test("a request queued before account switch is refused before credentials or backend are used", async () => {
  const { createRemoteHost } = await import("../src/browser/remote-host.ts");
  let queued: unknown;
  let posts = 0;
  const remote = createRemoteClient({
    send(message) {
      queued = message;
    },
    id: () => "request",
    online: () => true,
    schedule: () => () => {},
  });
  let current: string | null = "new-caller";
  const host = createRemoteHost({
    authorizationContext: () => current,
    endpoint: () => "/graphql",
    active: () => true,
    online: () => true,
    post: async () => {
      posts++;
      return { status: 200, body: { data: {} } };
    },
    reply: (response) => remote.receive(response),
  });
  remote.setAuthorizationContext("previous-caller");
  const call = remote.port.execute({
    operation: "mutation",
    query: "mutation { save }",
    variables: {},
  });
  host.handle(queued);
  await assert.rejects(call, /Caller changed/);
  assert.equal(posts, 0);
  current = null;
  const revoked = remote.port.execute({
    operation: "mutation",
    query: "mutation { save }",
    variables: {},
  });
  host.handle(queued);
  await assert.rejects(revoked, /Caller changed/);
  assert.equal(posts, 0);
});

test("guest resumable identity is the exact authorized capability generation, never anonymous global state", () => {
  const first = guestAuthorizationContext("page", "digest-a", "digest-a", 1);
  assert.ok(first);
  assert.equal(
    guestAuthorizationContext("page", "digest-a", "digest-a", 1),
    first,
  );
  assert.notEqual(
    guestAuthorizationContext("page", "digest-b", "digest-b", 2),
    first,
  );
  assert.notEqual(
    guestAuthorizationContext("page", "digest-a", "digest-a", 2),
    first,
  );
  assert.equal(guestAuthorizationContext("page", "", "digest-a", 1), null);
  assert.equal(
    guestAuthorizationContext("page", "revoked", "digest-a", 1),
    null,
  );
});
