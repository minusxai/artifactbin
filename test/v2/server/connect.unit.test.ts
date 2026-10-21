/**
 * Connecting a downloaded file to its page: the frame begins, the viewer
 * approves as their account in a window on the server, the frame polls once
 * for the grant. Pure model with an injected clock and random source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnectService } from "../../../src/server/af-connect.ts";
import type { ConnectPagePort } from "../../../src/server/af-connect-contracts.ts";

function fakePages(options: { readers?: string[] } = {}): ConnectPagePort & { grants: string[]; revoked: string[] } {
  const grants: string[] = [];
  const revoked: string[] = [];
  return {
    grants,
    revoked,
    async revoke(token) {
      revoked.push(token);
    },
    async connectInfo(id) {
      if (id !== "Pg4mQ2") throw Object.assign(Error("Not found"), { status: 404 });
      return { id, path: null };
    },
    async grant(credential, id) {
      if (!credential.startsWith("account:")) throw Object.assign(Error("Sign in required"), { status: 401 });
      const username = credential.slice("account:".length);
      if (options.readers && !options.readers.includes(username))
        throw Object.assign(Error("No access"), { status: 403 });
      grants.push(`${username}:${id}`);
      return { token: `grant-${grants.length}`, username };
    },
  };
}
function service(pages = fakePages(), clock = { now: 1_000 }) {
  let counter = 0;
  return createConnectService({ pages, now: () => clock.now, random: (bytes) => `r${bytes}-${++counter}` });
}

test("a connection is begun for a page, approved once as an account, and polled once for its grant", async () => {
  const pages = fakePages();
  const connect = service(pages);
  const begun = await connect.begin("Pg4mQ2");
  assert.equal(begun.status, 201);
  const { code, deviceCode } = begun.value;
  assert.notEqual(code, deviceCode);
  assert.deepEqual(connect.info(code), { fileId: "Pg4mQ2" });
  assert.deepEqual(connect.poll(deviceCode), { status: 202, value: { pending: true } });
  assert.deepEqual(await connect.approve("account:alice", code), { status: 200, value: { approved: true } });
  assert.deepEqual(pages.grants, ["alice:Pg4mQ2"]);
  await assert.rejects(connect.approve("account:bob", code), { status: 409, message: "Already approved" });
  assert.deepEqual(pages.revoked, []);
  assert.deepEqual(connect.poll(deviceCode), {
    status: 200,
    value: { token: "grant-1", username: "alice", purpose: "document" },
  });
  // The grant is handed out once, and the human code is not a credential.
  assert.throws(() => connect.poll(deviceCode), { status: 410 });
  assert.throws(() => connect.poll(code), { status: 410 });
  assert.throws(() => connect.info(code), { status: 410 });
});

test("approval needs an account that can read the page; beginning needs only a published page", async () => {
  const pages = fakePages({ readers: ["alice"] });
  const connect = service(pages);
  await assert.rejects(connect.begin("Zz9Zz9"), { status: 404 });
  await assert.rejects(connect.begin(""), { status: 404 });
  const { code, deviceCode } = (await connect.begin("Pg4mQ2")).value;
  await assert.rejects(connect.approve("", code), { status: 401 });
  await assert.rejects(connect.approve("account:bob", code), { status: 403 });
  assert.deepEqual(connect.poll(deviceCode), { status: 202, value: { pending: true } });
  assert.deepEqual(pages.grants, []);
  await connect.approve("account:alice", code);
  assert.equal(connect.poll(deviceCode).status, 200);
});

test("pending connections expire, unknown codes are 410, and there is a cap on how many wait", async () => {
  const clock = { now: 1_000 };
  const connect = createConnectService({ pages: fakePages(), now: () => clock.now, ttl: 60_000, capacity: 2 });
  const first = (await connect.begin("Pg4mQ2")).value;
  await connect.begin("Pg4mQ2");
  await assert.rejects(connect.begin("Pg4mQ2"), { status: 429 });
  assert.throws(() => connect.info("no-such-code"), { status: 410 });
  assert.throws(() => connect.poll("no-such-device"), { status: 410 });
  assert.throws(() => connect.poll(42), { status: 410 });
  clock.now += 60_001;
  assert.throws(() => connect.info(first.code), { status: 410 });
  await assert.rejects(connect.approve("account:alice", first.code), { status: 410 });
  assert.throws(() => connect.poll(first.deviceCode), { status: 410 });
  // Expired entries make room.
  const third = (await connect.begin("Pg4mQ2")).value;
  await connect.approve("account:alice", third.code);
  clock.now += 60_001;
  // An approved grant that was never collected expires too.
  assert.throws(() => connect.poll(third.deviceCode), { status: 410 });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("capacity reserves in-flight lookups and releases rejected admission", async () => {
  const lookup = deferred<{ id: string; path: null }>();
  let calls = 0;
  const pages = fakePages();
  pages.connectInfo = () => { calls++; return lookup.promise; };
  const connect = createConnectService({ pages, capacity: 1 });
  const first = connect.begin("Pg4mQ2");
  const second = connect.begin("Pg4mQ2");
  void second.catch(() => {});
  assert.equal(calls, 1);
  await assert.rejects(second, { status: 429 });
  lookup.reject(Error("lookup failed"));
  await assert.rejects(first, /lookup failed/);
  pages.connectInfo = async (id) => ({ id, path: null });
  assert.equal((await connect.begin("Pg4mQ2")).status, 201);
  await assert.rejects(connect.begin("Pg4mQ2"), { status: 429 });
});

test("approval is exclusive before grant issuance, and rejection permits retry", async () => {
  const issued = deferred<{ token: string; username: string }>();
  const pages = fakePages();
  let calls = 0;
  pages.grant = () => { calls++; return issued.promise; };
  const connect = service(pages);
  const { code, deviceCode } = (await connect.begin("Pg4mQ2")).value;
  const first = connect.approve("account:alice", code);
  const second = connect.approve("account:bob", code);
  void second.catch(() => {});
  assert.equal(calls, 1);
  // The grant in flight may still fail, so the second approval is told to retry, not that it is approved.
  await assert.rejects(second, { status: 409, message: "Approval in progress, try again" });
  assert.equal(connect.poll(deviceCode).status, 202);
  issued.reject(Error("grant failed"));
  await assert.rejects(first, /grant failed/);
  pages.grant = async () => ({ token: "retry", username: "alice" });
  assert.equal((await connect.approve("account:alice", code)).status, 200);
  assert.equal(connect.poll(deviceCode).status, 200);
});

test("expiry during grant issuance never reports success, exposes the late grant, or leaves it live", async () => {
  for (const sweepWhileWaiting of [false, true]) {
    const issued = deferred<{ token: string; username: string }>();
    const pages = fakePages();
    pages.grant = () => issued.promise;
    const clock = { now: 0 };
    const connect = createConnectService({ pages, now: () => clock.now, ttl: 10, capacity: 1 });
    const { code, deviceCode } = (await connect.begin("Pg4mQ2")).value;
    const approval = connect.approve("account:alice", code);
    clock.now = 10;
    if (sweepWhileWaiting) assert.throws(() => connect.poll(deviceCode), { status: 410 });
    issued.resolve({ token: "late", username: "alice" });
    await assert.rejects(approval, { status: 410 });
    assert.deepEqual(pages.revoked, ["late"]);
    assert.throws(() => connect.poll(deviceCode), { status: 410 });
    assert.equal((await connect.begin("Pg4mQ2")).status, 201);
  }
});

test("a reentrant grant port cannot issue another grant for its own connection", async () => {
  const pages = fakePages();
  const connect = service(pages);
  const { code } = (await connect.begin("Pg4mQ2")).value;
  let nested: Promise<unknown>;
  let calls = 0;
  pages.grant = async () => {
    calls++;
    if (calls === 1) {
      nested = connect.approve("account:bob", code);
      void nested.catch(() => {});
    }
    return { token: "one", username: "alice" };
  };
  await connect.approve("account:alice", code);
  await assert.rejects(nested!, { status: 409 });
  assert.equal(calls, 1);
});

test("a failed revocation of a late grant still answers 410", async () => {
  const pages = fakePages();
  const clock = { now: 0 };
  const connect = createConnectService({ pages, now: () => clock.now, ttl: 10 });
  const { code } = (await connect.begin("Pg4mQ2")).value;
  pages.grant = async () => {
    clock.now = 10;
    return { token: "late", username: "alice" };
  };
  pages.revoke = async () => { throw Error("database down"); };
  await assert.rejects(connect.approve("account:alice", code), { status: 410 });
});
