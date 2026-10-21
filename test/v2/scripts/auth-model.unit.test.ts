/**
 * auth.mjs and token resolution as a pure model (src/af-script/auth-model.ts)
 * over an in-memory file system, a fake auth server and a fixed clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AfFetch } from "../../../src/af-script/af-contracts.ts";
import type { AuthAction, AuthJson, CredentialFile } from "../../../src/af-script/auth-contracts.ts";
import { resolveToken, runAuth } from "../../../src/af-script/auth-model.ts";
import { runComments } from "../../../src/af-script/comments-model.ts";
import { files } from "../../../src/af-script/ports.ts";
import { publishPage } from "../../../src/af-script/publish-model.ts";
import { FakeServer, MemoryFs, ORIGIN, fakePorts, page } from "../support/lifecycle-fakes.ts";

const HOME = "/home/agent";
const FILE = `${HOME}/.af/credentials.json`;
const NOW = Date.UTC(2026, 9, 21, 10, 0, 0);
const OTHER = "http://other.test";

/** A server with the sign-in routes: codes are "123456", tokens are minted per call. */
class AuthServer {
  readonly log: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  readonly valid = new Map<string, string>();
  /** Answers to force for a URL prefix: a status, or "down" to throw. */
  readonly forced = new Map<string, number | "down">();
  testLogin = true;
  minted = 0;
  fetch: AfFetch = async (url, init) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, string>) : null;
    this.log.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body });
    const reply = (status: number, value: unknown) => ({ status, json: async () => value });
    const forced = [...this.forced].find(([prefix]) => url.startsWith(prefix))?.[1];
    if (forced === "down") throw TypeError("fetch failed");
    if (forced) return reply(forced, { error: `forced ${forced}` });
    const { pathname } = new URL(url);
    const mint = (email: string) => {
      const token = `secret-token-${++this.minted}-${"x".repeat(32)}`;
      this.valid.set(token, email.trim().toLowerCase());
      return reply(200, { token, username: email.trim().toLowerCase() });
    };
    if (pathname === "/api/auth/email/request") return reply(200, { sent: true });
    if (pathname === "/api/auth/email/verify")
      return body?.code === "123456" ? mint(body.email!) : reply(401, { error: "Invalid or expired code" });
    if (pathname === "/api/auth/test-token") return this.testLogin ? mint(body!.email!) : reply(404, { error: "Not found" });
    if (pathname === "/api/auth/session") {
      const username = this.valid.get((init.headers.Authorization ?? "").replace(/^Bearer /, ""));
      return username ? reply(200, { username }) : reply(401, { error: "Sign in required" });
    }
    return reply(404, { error: "Not found" });
  };
}

function cli(server: AuthServer, fs = new MemoryFs(), baseEnv: Record<string, string> = { HOME, AF_SERVER: ORIGIN }) {
  const out = { stdout: "", stderr: "" };
  const run = async (action: AuthAction, json = false, env: Record<string, string> = {}) => {
    out.stdout = "";
    out.stderr = "";
    const code = await runAuth(action, json, {
      env: { ...baseEnv, ...env },
      ports: { fetch: server.fetch, fs, now: () => NOW },
      stdout: (text) => (out.stdout += text),
      stderr: (text) => (out.stderr += text),
    });
    return { code, ...out, json: () => JSON.parse(out.stdout) as AuthJson };
  };
  const saved = () => JSON.parse(fs.files.get(FILE) ?? "{}") as CredentialFile;
  return { fs, run, saved };
}

/** Every token the server ever minted, so a test can show none was printed. */
function assertNoToken(server: AuthServer, ...texts: string[]) {
  for (const token of server.valid.keys()) for (const text of texts) assert.ok(!text.includes(token), "a token was printed");
  for (const text of texts) assert.doesNotMatch(text, /secret-token/);
}

test("--email asks the server to send a code and saves nothing", async () => {
  const server = new AuthServer();
  const { run, fs } = cli(server);
  const sent = await run({ kind: "request", email: "you@example.test" });
  assert.equal(sent.code, 0, sent.stderr);
  assert.match(sent.stdout, /Sent a sign-in code to you@example\.test\. Run node scripts\/auth\.mjs --email you@example\.test --code <code>/);
  assert.deepEqual(server.log, [{ url: `${ORIGIN}/api/auth/email/request`, method: "POST", auth: null, body: { email: "you@example.test" } }]);
  assert.equal(fs.files.size, 0);

  server.forced.set(ORIGIN, 429);
  const limited = await run({ kind: "request", email: "you@example.test" }, true);
  assert.equal(limited.code, 1, "rate limited is a refusal, not retried");
  assert.equal(limited.json().status, "error");
  assert.equal(limited.json().email, "you@example.test", "--json echoes the address given, also on an error");
  assert.equal(server.log.length, 2);
  server.forced.set(ORIGIN, "down");
  assert.equal((await run({ kind: "request", email: "you@example.test" })).code, 3);
});

test("a server that answers 404 to sign-in routes is not a Pagegi server: exit 2 naming AF_SERVER, and status says so", async () => {
  const server = new AuthServer();
  server.forced.set(ORIGIN, 404);
  const { run } = cli(server);
  const request = await run({ kind: "request", email: "you@example.test" }, true);
  assert.equal(request.code, 2);
  assert.equal(request.json().email, "you@example.test");
  assert.match(request.json().message, /http:\/\/server\.test does not look like a Pagegi server/);
  assert.match(request.json().message, /AF_SERVER/);
  const verify = await run({ kind: "verify", email: "you@example.test", code: "123456" });
  assert.equal(verify.code, 2);
  assert.match(verify.stderr, /does not look like a Pagegi server.*AF_SERVER/s);
  const testToken = await run({ kind: "test-token", email: "dev@example.test" });
  assert.equal(testToken.code, 2, "a 404 from a server without the session route is not 'no test tokens'");
  assert.match(testToken.stderr, /does not look like a Pagegi server/);
  const status = await run({ kind: "status" }, false, { AF_TOKEN: "t" });
  assert.equal(status.code, 1);
  assert.match(status.stdout, /does not look like a Pagegi server.*AF_SERVER/s);

  // A Pagegi server without test login still answers the session route: that 404 means no test tokens.
  const production = new AuthServer();
  production.testLogin = false;
  const noTokens = await cli(production).run({ kind: "test-token", email: "dev@example.test" });
  assert.equal(noTokens.code, 1);
  assert.match(noTokens.stderr, /does not issue test tokens \(404\)/);
});

test("--email --code saves the token for the server's origin, 0600, and never prints it", async () => {
  const server = new AuthServer();
  const { run, fs, saved } = cli(server, new MemoryFs(), { HOME, AF_SERVER: `${ORIGIN}/some/path/` });
  fs.files.set(FILE, JSON.stringify({ [OTHER]: { token: "other-token", email: "o@example.test", savedAt: "2026-01-01T00:00:00.000Z" } }));

  const wrong = await run({ kind: "verify", email: "You@Example.test", code: "000000" });
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /refused the code/);
  assert.deepEqual(Object.keys(saved()), [OTHER], "nothing saved for a wrong code");

  const ok = await run({ kind: "verify", email: "You@Example.test", code: "123456" });
  assert.equal(ok.code, 0, ok.stderr);
  const token = [...server.valid.keys()][0]!;
  assert.deepEqual(saved(), {
    [OTHER]: { token: "other-token", email: "o@example.test", savedAt: "2026-01-01T00:00:00.000Z" },
    [ORIGIN]: { token, email: "you@example.test", savedAt: new Date(NOW).toISOString() },
  });
  assert.ok(fs.private.has(FILE), "written as a private file");
  assert.equal(ok.stdout, `Signed in to ${ORIGIN} as you@example.test. The token is saved in ${FILE}.\n`);

  const json = await run({ kind: "verify", email: "you@example.test", code: "123456" }, true);
  assert.deepEqual(json.json(), {
    status: "signed-in",
    server: ORIGIN,
    email: "you@example.test",
    file: FILE,
    message: `Signed in to ${ORIGIN} as you@example.test. The token is saved in ${FILE}.`,
  });
  assertNoToken(server, wrong.stdout, wrong.stderr, ok.stdout, ok.stderr, json.stdout, json.stderr);
});

test("--test-token saves a token on a development server, notes what it is for, and is refused elsewhere", async () => {
  const server = new AuthServer();
  const { run, saved } = cli(server);
  const ok = await run({ kind: "test-token", email: "dev@example.test" });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stderr, /^Note: --test-token only works on development servers/);
  assert.equal(saved()[ORIGIN]!.email, "dev@example.test");
  assert.equal(server.log[0]!.url, `${ORIGIN}/api/auth/test-token`);

  server.testLogin = false;
  const refused = await run({ kind: "test-token", email: "dev@example.test" }, true);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^Note: --test-token only works on development servers/, "the note goes to stderr with --json too");
  assert.match(refused.json().message, /does not issue test tokens \(404\)/);
  assertNoToken(server, ok.stdout, ok.stderr, refused.stdout);
});

test("status checks each saved server once: valid, expired, unreachable, and a current server with no token", async () => {
  const server = new AuthServer();
  const { run, fs } = cli(server);
  assert.equal((await run({ kind: "verify", email: "you@example.test", code: "123456" })).code, 0);
  const current = JSON.parse(fs.files.get(FILE)!) as CredentialFile;
  fs.files.set(
    FILE,
    JSON.stringify({
      ...current,
      [OTHER]: { token: "expired-token", email: "old@example.test", savedAt: "2026-01-01T00:00:00.000Z" },
      "http://down.test": { token: "down-token", email: "d@example.test", savedAt: "2026-01-01T00:00:00.000Z" },
    }),
  );
  server.forced.set("http://down.test", "down");
  server.log.length = 0;

  const valid = await run({ kind: "status" });
  assert.equal(valid.code, 0, valid.stderr);
  assert.equal(server.log.length, 3, "one request per server");
  assert.ok(server.log.every((call) => call.method === "GET" && new URL(call.url).pathname === "/api/auth/session"));
  const lines = valid.stdout.trimEnd().split("\n");
  assert.equal(lines[0], `${ORIGIN} (current): signed in as you@example.test.`);
  assert.equal(lines[1], "http://down.test: d@example.test, but could not reach it (fetch failed).");
  assert.equal(
    lines[2],
    `${OTHER}: signed out (old@example.test): the server refused the token (401). Run AF_SERVER=${OTHER} node scripts/auth.mjs --email old@example.test to sign in again.`,
  );

  const json = await run({ kind: "status" }, true);
  assert.deepEqual(
    json.json().servers!.map((entry) => [entry.server, entry.current, entry.state, entry.source, entry.email]),
    [
      [ORIGIN, true, "signed-in", "credentials", "you@example.test"],
      ["http://down.test", false, "unknown", "credentials", "d@example.test"],
      [OTHER, false, "signed-out", "credentials", "old@example.test"],
    ],
  );

  // The same file, seen from a server that has no saved token: exit 1.
  const elsewhere = await run({ kind: "status" }, false, { AF_SERVER: "http://new.test" });
  assert.equal(elsewhere.code, 1);
  assert.match(elsewhere.stdout, /^http:\/\/new\.test \(current\): not signed in\. Run AF_SERVER=http:\/\/new\.test node scripts\/auth\.mjs --email <address>\./);

  // Its token expires: status shows it signed out and exits 1.
  server.valid.clear();
  const expired = await run({ kind: "status" });
  assert.equal(expired.code, 1);
  assert.match(expired.stdout, /^http:\/\/server\.test \(current\): signed out \(you@example\.test\): the server refused the token \(401\)/);

  // AF_TOKEN stands in for the current server's saved token.
  const fromEnv = await run({ kind: "status" }, true, { AF_TOKEN: "unknown-env-token" });
  assert.equal(fromEnv.code, 1);
  assert.deepEqual(fromEnv.json().servers![0], {
    server: ORIGIN,
    current: true,
    source: "AF_TOKEN",
    email: null,
    state: "signed-out",
    detail: "the server refused the token (401)",
  });
  assert.equal(server.log.at(-3)!.auth, "Bearer unknown-env-token");
  assertNoToken(server, valid.stdout, json.stdout, expired.stdout, fromEnv.stdout);
  assert.ok(![valid.stdout, json.stdout].some((text) => text.includes("expired-token") || text.includes("down-token")));
});

test("--logout removes only the current server's token; the file stays private", async () => {
  const server = new AuthServer();
  const { run, fs, saved } = cli(server);
  await run({ kind: "verify", email: "you@example.test", code: "123456" });
  await run({ kind: "test-token", email: "o@example.test" }, false, { AF_SERVER: OTHER });
  fs.private.clear();
  const out = await run({ kind: "logout" }, true);
  assert.equal(out.code, 0);
  assert.deepEqual(out.json(), {
    status: "signed-out",
    server: ORIGIN,
    email: "you@example.test",
    file: FILE,
    message: `Signed out of ${ORIGIN}: removed its token from ${FILE}.`,
  });
  assert.deepEqual(Object.keys(saved()), [OTHER]);
  assert.ok(fs.private.has(FILE));
  const again = await run({ kind: "logout" });
  assert.equal(again.code, 0);
  assert.match(again.stdout, /No saved token for http:\/\/server\.test/);
  const withEnv = await run({ kind: "logout" }, false, { AF_TOKEN: "t" });
  assert.match(withEnv.stderr, /AF_TOKEN is set/);
  assert.ok(server.log.every((call) => !call.url.includes("logout")), "logout is local");
});

test("tokens resolve as AF_TOKEN, else the file's entry for AF_SERVER, else exit 2 naming auth.mjs and AF_TOKEN", async () => {
  const fs = new MemoryFs();
  fs.files.set(FILE, JSON.stringify({ [ORIGIN]: { token: "saved", email: "you@example.test", savedAt: "x" } }));
  assert.deepEqual(await resolveToken({ HOME, AF_SERVER: ORIGIN, AF_TOKEN: "from-env" }, fs, "publish"), {
    origin: ORIGIN,
    token: "from-env",
    source: "AF_TOKEN",
    email: null,
  });
  assert.deepEqual(await resolveToken({ HOME, AF_SERVER: `${ORIGIN}/` }, fs, "publish"), {
    origin: ORIGIN,
    token: "saved",
    source: "credentials",
    email: "you@example.test",
  });
  await assert.rejects(resolveToken({ HOME }, fs, "publish pages"), (error: Error & { code: number }) => {
    assert.equal(error.code, 2);
    assert.equal(
      error.message,
      "Not signed in to https://pagegi.artifactbin.dev. To publish pages, run node scripts/auth.mjs --email <address> to sign in, or set AF_TOKEN to an account token (and AF_SERVER for a server other than https://pagegi.artifactbin.dev).",
    );
    return true;
  });
  // AF_HOME moves the file.
  fs.files.set("/elsewhere/credentials.json", JSON.stringify({ [ORIGIN]: { token: "moved", email: "m@example.test", savedAt: "x" } }));
  assert.equal((await resolveToken({ HOME, AF_HOME: "/elsewhere", AF_SERVER: ORIGIN }, fs, "x")).token, "moved");
  fs.files.set(FILE, "{ not json");
  await assert.rejects(resolveToken({ HOME, AF_SERVER: ORIGIN }, fs, "x"), /credentials\.json is not valid JSON/);
  await assert.rejects(resolveToken({ HOME, AF_SERVER: "not a url" }, fs, "x"), /AF_SERVER=not a url is not a URL/);
});

test("publish and comments use the saved token without AF_TOKEN, and a 401 asks to sign in again with auth.mjs", async () => {
  const server = new FakeServer();
  const fs = new MemoryFs();
  const { ports } = fakePorts(server, fs);
  fs.files.set("/work/page.html", page("<h1>Plan</h1>"));
  fs.files.set(FILE, JSON.stringify({ [ORIGIN]: { token: server.token("alice"), email: "alice@example.test", savedAt: "x" } }));
  const env = { HOME, AF_SERVER: ORIGIN };
  const created = await publishPage("page.html", "publish", { env, cwd: "/work", ports });
  assert.equal(created.code, 0, created.json.message);
  assert.equal(server.log.at(-1)!.headers.Authorization, `Bearer ${server.token("alice")}`);
  const out = { stdout: "", stderr: "" };
  const io = { stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) };
  assert.equal(await runComments("page.html", { kind: "list" }, false, { env, cwd: "/work", ports, ...io }), 0, out.stderr);

  fs.files.set(FILE, JSON.stringify({ [ORIGIN]: { token: "expired", email: "alice@example.test", savedAt: "x" } }));
  const refused = await publishPage("page.html", "pull", { env, cwd: "/work", ports });
  assert.equal(refused.code, 2);
  assert.equal(refused.json.message, `${ORIGIN} refused the saved token (401). Run node scripts/auth.mjs --email alice@example.test to sign in again.`);
  assert.equal(await runComments("page.html", { kind: "list" }, false, { env, cwd: "/work", ports, ...io }), 2);
  assert.match(out.stderr, /refused the saved token \(401\)\. Run node scripts\/auth\.mjs --email alice@example\.test to sign in again\./);

  const fromEnv = await publishPage("page.html", "pull", { env: { ...env, AF_TOKEN: "bad" }, cwd: "/work", ports });
  assert.equal(fromEnv.code, 2);
  assert.match(fromEnv.json.message, /refused AF_TOKEN \(401\)\. Set AF_TOKEN to a new token, or unset it and run node scripts\/auth\.mjs --email <address> to sign in again\./);
  assert.ok(!fs.under("/work/.af").some((path) => fs.files.get(`/work/.af/${path}`)!.includes(server.token("alice"))), "no token in .af/");
  assert.ok(!fs.files.get("/work/page.html")!.includes(server.token("alice")), "no token in the page");
});

test("the real file port writes credentials 0600 in a 0700 directory, tightening one that exists", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "af-auth-"));
  try {
    const directory = join(root, ".af");
    mkdirSync(directory, { mode: 0o755 });
    const path = join(directory, "credentials.json");
    await files.write(path, '{"a":1}\n', { private: true });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(readFileSync(path, "utf8"), '{"a":1}\n');
    const fresh = join(root, "new", "credentials.json");
    await files.write(fresh, "{}\n", { private: true });
    assert.equal(statSync(fresh).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, "new")).mode & 0o777, 0o700);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
