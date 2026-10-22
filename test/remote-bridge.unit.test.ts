import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, createLocalStore, gql } from "../src/apollo/client.ts";
import { createRemoteClient } from "../src/browser/remote-client.ts";
import { createRemoteHost } from "../src/browser/remote-host.ts";
import type { RemoteBridgeResponse } from "../src/browser/remote-bridge-contracts.ts";
import type { AfJsonObject } from "../src/af-contracts.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Page ↔ platform wired directly, as postMessage would, with a fake server behind the host. */
function wire(server: (url: string, body: AfJsonObject) => Promise<{ status: number; body: unknown }>, endpoint: string | null = "/api/files/Pg4mQ2/graphql") {
  const posted: { url: string; body: AfJsonObject }[] = [];
  const timers: (() => void)[] = [];
  let pageOnline = true;
  let hostOnline = true;
  let client: ReturnType<typeof createRemoteClient>;
  const host = createRemoteHost({
    endpoint: () => endpoint,
    active: () => true,
    online: () => hostOnline,
    post: (url, body) => {
      posted.push({ url, body });
      return server(url, body);
    },
    reply: (response: RemoteBridgeResponse) => queueMicrotask(() => client.receive(response)),
  });
  let next = 0;
  client = createRemoteClient({
    send: (message) => queueMicrotask(() => host.handle(message)),
    id: () => `r${++next}`,
    online: () => pageOnline,
    schedule: (callback) => {
      timers.push(callback);
      return () => timers.splice(timers.indexOf(callback), 1);
    },
  });
  const apollo = createClient({ backends: ["billing"], state: createLocalStore(), remote: client.port });
  return {
    apollo,
    client,
    posted,
    timers,
    set pageOnline(value: boolean) {
      pageOnline = value;
    },
    set hostOnline(value: boolean) {
      hostOnline = value;
    },
  };
}
const PAY = gql`mutation Pay($id: ID!) { billing { pay(invoice: $id) { id } } }`;

test("a backend call reaches the page's graphql route with only its query and variables", async () => {
  const page = wire(async () => ({
    status: 200,
    body: { data: { billing: { pay: { id: "42" } } }, extensions: { outcomes: { "billing.pay": "committed" } } },
  }));
  const result = await page.apollo.mutate({ mutation: PAY, variables: { id: "42" } });
  assert.deepEqual(result.data, { billing: { pay: { id: "42" } } });
  assert.deepEqual(result.extensions?.outcomes, { "billing.pay": "committed" });
  assert.equal(page.posted.length, 1);
  assert.equal(page.posted[0]!.url, "/api/files/Pg4mQ2/graphql");
  assert.deepEqual(Object.keys(page.posted[0]!.body).sort(), ["query", "variables"]);
  assert.deepEqual(page.posted[0]!.body.variables, { id: "42" });
});

test("offline on either side: nothing is sent and the call settles offline", async () => {
  const page = wire(async () => ({ status: 200, body: { data: null } }));
  page.pageOnline = false;
  assert.deepEqual((await page.apollo.mutate({ mutation: PAY, variables: { id: "1" } })).extensions?.outcomes, { "billing.pay": "offline" });
  page.pageOnline = true;
  page.hostOnline = false;
  assert.deepEqual((await page.apollo.mutate({ mutation: PAY, variables: { id: "1" } })).extensions?.outcomes, { "billing.pay": "offline" });
  assert.equal(page.posted.length, 0);
  const unpublished = wire(async () => ({ status: 200, body: { data: null } }), null);
  assert.deepEqual((await unpublished.apollo.mutate({ mutation: PAY, variables: { id: "1" } })).extensions?.outcomes, { "billing.pay": "offline" });
});

test("a refused request is rejected; a failure after sending is unknown and never retried", async () => {
  const refused = wire(async () => ({ status: 403, body: { error: "Not allowed" } }));
  const no = await refused.apollo.mutate({ mutation: PAY, variables: { id: "1" } });
  assert.deepEqual(no.extensions?.outcomes, { "billing.pay": "rejected" });
  assert.deepEqual(no.errors, [{ message: "Not allowed" }]);

  for (const failure of [async () => ({ status: 502, body: { error: "Bad gateway" } }), async () => Promise.reject(new TypeError("connection reset"))]) {
    const lost = wire(failure);
    const result = await lost.apollo.mutate({ mutation: PAY, variables: { id: "1" } });
    await tick();
    assert.deepEqual(result.extensions?.outcomes, { "billing.pay": "unknown" });
    assert.equal(lost.posted.length, 1);
  }
});

test("no reply from the platform: the outcome is unknown", async () => {
  const page = wire(() => new Promise(() => {}));
  const pending = page.apollo.mutate({ mutation: PAY, variables: { id: "1" } });
  await tick();
  assert.equal(page.timers.length, 1);
  page.timers[0]!();
  assert.deepEqual((await pending).extensions?.outcomes, { "billing.pay": "unknown" });
});

test("the platform ignores malformed requests and refuses duplicates without sending", async () => {
  const posted: unknown[] = [];
  const replies: RemoteBridgeResponse[] = [];
  const host = createRemoteHost({
    endpoint: () => "/api/files/Pg4mQ2/graphql",
    active: () => true,
    online: () => true,
    post: async (url, body) => (posted.push(body), { status: 200, body: { data: {} } }),
    reply: (response) => replies.push(response),
  });
  assert.equal(host.handle({ kind: "shared-request" }), false);
  assert.equal(host.handle({ kind: "remote-request", id: "a", request: { query: 1, variables: {}, operation: "query" } }), true);
  assert.deepEqual(replies, [{ id: "a", error: { message: "Invalid backend request", sent: false } }]);
  host.handle({ kind: "remote-request", id: "b", request: { query: "{ billing { x } }", variables: {}, operation: "query" } });
  host.handle({ kind: "remote-request", id: "b", request: { query: "{ billing { x } }", variables: {}, operation: "query" } });
  await tick();
  assert.equal(posted.length, 1);
});

test("remote bridge invalidations notify owned query listeners and disposal removes them", () => {
  const remote = createRemoteClient({
    send() {},
    id: () => "id",
    online: () => true,
    schedule: () => () => {},
  });
  let count = 0;
  const stop = remote.port.subscribe!(() => {
    count++;
  });
  remote.invalidate();
  assert.equal(count, 1);
  stop();
  remote.invalidate();
  assert.equal(count, 1);
  remote.port.subscribe!(() => {
    count++;
  });
  remote.dispose();
  remote.invalidate();
  assert.equal(count, 1);
});

test('authorization context transitions clear opt-in reader watches in the same task and discard previous caller receipts',async()=>{
 const replies:Array<(v:{status:number;body:unknown})=>void>=[];
 const page=wire(()=>new Promise(resolve=>replies.push(resolve)));
 page.client.setAuthorizationContext('context-a');const seen:unknown[]=[];
 const sub=page.apollo.watchQuery({query:gql`{billing{viewer{id}}}`,clearOnRefresh:true}).subscribe(r=>seen.push(r.data.billing));await tick();
 replies.shift()!({status:200,body:{data:{billing:{viewer:{id:'first'}}}}});await tick();assert.deepEqual(seen.at(-1),{viewer:{id:'first'}});
 page.client.setAuthorizationContext('context-b');assert.equal(seen.at(-1),null);await tick();page.client.setAuthorizationContext(null);assert.equal(seen.at(-1),null);
 replies.shift()!({status:200,body:{data:{billing:{viewer:{id:'stale'}}}}});await tick();assert.equal(seen.at(-1),null);
 replies.shift()!({status:200,body:{data:{billing:{viewer:{id:null}}}}});await tick();assert.deepEqual(seen.at(-1),{viewer:{id:null}});
 sub.unsubscribe();page.client.dispose();
});

test("trusted access snapshots distinguish pending settlement, reject stale epochs and retire on disposal", () => {
  const client = createRemoteClient({
    send() {},
    id: () => "x",
    online: () => true,
    schedule: () => () => {},
  });
  let notifications = 0;
  client.port.subscribeAccess!(() => notifications++);
  assert.deepEqual(client.port.access!(), {
    epoch: null,
    state: "pending",
    context: null,
  });
  client.setAccess({ epoch: 1, state: "pending", context: null });
  assert.equal(notifications, 1);
  client.setAccess({ epoch: 1, state: "allowed", context: "guest-policy" });
  assert.equal(client.port.authorizationContext!(), "guest-policy");
  client.setAccess({ epoch: 2, state: "denied", context: null });
  assert.equal(client.port.authorizationContext!(), null);
  client.setAccess({ epoch: 1, state: "allowed", context: "stale" });
  assert.equal(client.port.access!().state, "denied");
  client.setAccess({ epoch: 2, state: "pending", context: "invalid" });
  assert.equal(client.port.access!().state, "denied");
  client.dispose();
  assert.equal(client.port.access!().state, "disposed");
  assert.equal(notifications, 4);
});
