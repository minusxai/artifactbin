import test from "node:test";
import assert from "node:assert/strict";
import { createLibrarySession } from "../src/library-client/session.ts";
import type {
  LibrarySnapshot,
  LibraryTransport,
} from "../src/library-client/contracts.ts";
const deferred = () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test("only newest load publishes; superseded requests are aborted even when transport ignores abort", async () => {
  const calls: { signal: AbortSignal; d: ReturnType<typeof deferred> }[] = [];
  const states: LibrarySnapshot[] = [];
  const s = createLibrarySession({
    embedded: false,
    sharing: false,
    changed: (v) => states.push(v),
    request: async (_p, _b, signal) => {
      const d = deferred();
      calls.push({ signal, d });
      return d.promise;
    },
  });
  const first = s.load();
  const second = s.load();
  assert.equal(calls[0]!.signal.aborted, true);
  calls[2]!.d.resolve({ username: "new" });
  calls[3]!.d.resolve({ name: "new", image: null });
  await second;
  calls[0]!.d.resolve({ username: "old" });
  calls[1]!.d.resolve({ name: "old", image: null });
  assert.equal(await first, undefined);
  const latest = states.at(-1);
  assert.equal(latest?.status, "signed-in");
  if (latest?.status === "signed-in") assert.equal(latest.data.username, "new");
});
test("unauthorized load differs from network failure and disposal suppresses notifications", async () => {
  const states: LibrarySnapshot[] = [];
  let fail: unknown = Object.assign(Error("unauthorized"), { status: 401 });
  const s = createLibrarySession({
    embedded: false,
    sharing: false,
    changed: (v) => states.push(v),
    request: async () => {
      throw fail;
    },
  });
  await s.load();
  assert.equal(states.at(-1)?.status, "signed-out");
  fail = Error("offline");
  await s.load();
  assert.equal(states.at(-1)?.status, "failed");
  s.dispose();
  assert.equal(await s.load(), undefined);
  assert.equal(states.length, 4);
});
test("embedded verification installs token, logout clears it, and ordinary verification uses cookie session", async () => {
  const calls: { path: string; body: any; token: string | null }[] = [];
  const request: LibraryTransport = async (path, body, _signal, token) => {
    calls.push({ path, body, token });
    return { token: "secret" };
  };
  const s = createLibrarySession({
    embedded: true,
    sharing: true,
    request,
    changed: () => {},
  });
  assert.equal(await s.verify("a", "123"), true);
  assert.equal(s.token(), "secret");
  assert.equal(calls[0]!.body.browserSession, false);
  await s.request("/test");
  assert.equal(calls[1]!.token, "secret");
  await s.logout();
  assert.equal(s.token(), null);
  const normal = createLibrarySession({
    embedded: false,
    sharing: false,
    request,
    changed: () => {},
  });
  await normal.verify("b", "456");
  assert.equal(calls.at(-1)!.body.browserSession, true);
  assert.equal(normal.token(), null);
});
test("logout invalidates a pending load and disposed verification cannot install credentials", async () => {
  const auth = deferred(),
    data = deferred();
  const states: LibrarySnapshot[] = [];
  const s = createLibrarySession({
    embedded: true,
    sharing: true,
    changed: (v) => states.push(v),
    request: async (path) =>
      path.endsWith("verify")
        ? auth.promise
        : path.endsWith("logout")
          ? {}
          : data.promise,
  });
  const loading = s.load();
  await s.logout();
  data.resolve({ username: "stale" });
  assert.equal(await loading, undefined);
  const verify = s.verify("a", "b");
  s.dispose();
  auth.resolve({ token: "late" });
  assert.equal(await verify, false);
  assert.equal(s.token(), null);
});
test("a request completing after authority changes cannot update a profile view", async () => {
  const old = deferred();
  const s = createLibrarySession({
    embedded: false,
    sharing: true,
    changed: () => {},
    request: async (path) => (path === "/profile" ? old.promise : {}),
  });
  const profile = s.request("/profile");
  await s.logout();
  old.resolve({ name: "old" });
  await assert.rejects(profile, /superseded/);
});
test("failed logout retains embedded credential, and sharing loads omit profile data", async () => {
  const calls: string[] = [];
  const s = createLibrarySession({
    embedded: true,
    sharing: true,
    changed: () => {},
    request: async (path) => {
      calls.push(path);
      if (path.endsWith("/logout")) throw Error("offline");
      if (path.endsWith("/verify")) return { token: "secret" };
      return { username: "user" };
    },
  });
  await s.verify("a", "b");
  await assert.rejects(s.logout(), /offline/);
  assert.equal(s.token(), "secret");
  assert.equal((await s.load())?.status, "signed-in");
  assert.equal(calls.includes("/api/library/profile"), false);
  assert.equal(calls.at(-1), "/api/library/session");
});
test("cancelling an email challenge prevents a late verification from installing credentials", async () => {
  const response = deferred();
  const s = createLibrarySession({
    embedded: true,
    sharing: false,
    changed: () => {},
    request: async () => response.promise,
  });
  const verification = s.verify("old", "123");
  s.cancelAuthentication();
  response.resolve({ token: "late" });
  assert.equal(await verification, false);
  assert.equal(s.token(), null);
});

test("session owns isolated snapshots and publishes logout authority immediately", async () => {
  const data = {
    username: "owner",
    files: [
      { path: "a.html", fileId: "a", title: "A", url: "/d/a", commentCount: 0 },
    ],
  };
  const s = createLibrarySession({
    embedded: false,
    sharing: true,
    changed: (snapshot) => {
      if (snapshot.status === "signed-in")
        snapshot.data.username = "mutated subscriber";
    },
    request: async () => data,
  });
  assert.equal(s.getSnapshot().status, "pending");
  await s.load();
  const snapshot = s.getSnapshot();
  if (snapshot.status !== "signed-in") assert.fail("signed in");
  snapshot.data.files![0]!.title = "mutated reader";
  data.files[0]!.title = "mutated transport";
  const fresh = s.getSnapshot();
  assert.equal(fresh.status, "signed-in");
  if (fresh.status === "signed-in") {
    assert.equal(fresh.data.username, "owner");
    assert.equal(fresh.data.files![0]!.title, "A");
  }
  await s.logout();
  assert.equal(s.getSnapshot().status, "signed-out");
});

test("a page served without a session is signed out on its first load without a request; signing in loads for real", async () => {
  const paths: string[] = [];
  const states: LibrarySnapshot[] = [];
  const s = createLibrarySession({
    embedded: false,
    sharing: false,
    signedOut: true,
    changed: (v) => states.push(v),
    request: async (path) => {
      paths.push(path);
      return path.endsWith("/profile")
        ? { name: "Ann", image: null }
        : { username: "ann" };
    },
  });
  assert.equal((await s.load())?.status, "signed-out");
  assert.deepEqual(paths, []);
  assert.equal((await s.load())?.status, "signed-in");
  assert.deepEqual(paths.sort(), ["/api/library", "/api/library/profile"]);
});

test("selected namespace scopes only listing; profile and account identity stay personal", async () => {
  const paths: string[] = [];
  const session = createLibrarySession({
    embedded: false,
    sharing: false,
    owner: "group:fixture",
    changed: () => {},
    request: async (path) => {
      paths.push(path);
      return path.startsWith("/api/library?")
        ? {
            username: "member",
            namespace: {
              owner: "group:fixture",
              kind: "group",
              name: "Team",
              handle: null,
              role: "viewer",
            },
          }
        : { name: "Member", image: null };
    },
  });
  const result = await session.load();
  assert.equal(result?.status, "signed-in");
  assert.deepEqual(paths, [
    "/api/library?owner=group%3Afixture",
    "/api/library/profile",
  ]);
  session.dispose();
});

test("successful logout resets namespace for the next account; failed logout preserves it", async () => {
  const paths: string[] = [];
  let failLogout = true;
  const session = createLibrarySession({
    embedded: false,
    sharing: false,
    owner: "group:fixture",
    changed: () => {},
    request: async (path) => {
      paths.push(path);
      if (path === "/api/library/logout" && failLogout) throw Error("Offline");
      return path === "/api/library/profile"
        ? { name: "Member", image: null }
        : { username: "member" };
    },
  });
  await assert.rejects(session.logout(), /Offline/);
  await session.load();
  assert.ok(paths.includes("/api/library?owner=group%3Afixture"));
  failLogout = false;
  await session.logout();
  paths.length = 0;
  await session.verify("other@example.test", "123456");
  await session.load();
  assert.deepEqual(paths, [
    "/api/auth/email/verify",
    "/api/library",
    "/api/library/profile",
  ]);
  session.dispose();
});

test("a superseded logout cannot reset a newer namespace load", async () => {
  const logout = deferred();
  const paths: string[] = [];
  const session = createLibrarySession({
    embedded: false,
    sharing: false,
    owner: "group:fixture",
    changed: () => {},
    request: async (path) => {
      paths.push(path);
      return path === "/api/library/logout"
        ? logout.promise
        : { username: "member", name: "Member", image: null };
    },
  });
  const pending = session.logout();
  const rejected = assert.rejects(pending, /superseded/);
  await session.load();
  logout.resolve({});
  await rejected;
  paths.length = 0;
  await session.load();
  assert.deepEqual(paths, [
    "/api/library?owner=group%3Afixture",
    "/api/library/profile",
  ]);
  session.dispose();
});
