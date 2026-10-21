/**
 * secrets.mjs (src/af-script/secrets-command.ts) over an injected fetch and
 * standard input: names and times in, values only ever out to the server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AfFetch, AfScriptModule } from "../../../src/af-script/af-contracts.ts";
import { load } from "../support/load.ts";

const script = () => load<AfScriptModule>("src/af-script/af.ts");
const env = { AF_TOKEN: "tok-1", AF_SERVER: "http://server.test" };

interface Seen {
  method: string;
  url: string;
  body: string | undefined;
  authorization: string | undefined;
}

function harness(answer: (seen: Seen) => { status: number; body: unknown }, stdin?: string) {
  const seen: Seen[] = [];
  const out = { stdout: "", stderr: "" };
  const fetch: AfFetch = async (url, init) => {
    const request = { method: init.method, url, body: init.body, authorization: init.headers.Authorization };
    seen.push(request);
    const reply = answer(request);
    return { status: reply.status, json: async () => reply.body };
  };
  return {
    seen,
    out,
    io: {
      env,
      cwd: "/nonexistent",
      stdout: (t: string) => (out.stdout += t),
      stderr: (t: string) => (out.stderr += t),
      fetch,
      ...(stdin === undefined ? {} : { stdin: async () => stdin }),
    },
  };
}

test("secrets parses list, set and remove; a bad name or an extra argument is a usage error", async () => {
  const { parseArguments } = await script();
  assert.deepEqual(parseArguments("secrets", []), { kind: "secrets", action: { kind: "list" }, json: false });
  assert.deepEqual(parseArguments("secrets", ["--json"]), { kind: "secrets", action: { kind: "list" }, json: true });
  assert.deepEqual(parseArguments("secrets", ["set", "STRIPE_KEY"]), { kind: "secrets", action: { kind: "set", name: "STRIPE_KEY" }, json: false });
  assert.deepEqual(parseArguments("secrets", ["remove", "A_1", "--json"]), { kind: "secrets", action: { kind: "remove", name: "A_1" }, json: true });
  assert.deepEqual(parseArguments("secrets", ["set", "X", "--help"]), { kind: "help" });
  for (const argv of [["set"], ["remove"], ["set", "stripe_key"], ["set", "1KEY"], ["set", "KEY", "value"], ["list"], ["get", "KEY"], ["set", "KEY", "--watch"]])
    assert.throws(() => parseArguments("secrets", argv), /^Error: Usage.*\n.*node scripts\/secrets\.mjs --help/, argv.join(" "));
});

test("with no command it lists each secret's name and time, never a value; --json prints the server's list", async () => {
  const { run } = await script();
  const listing = { secrets: [{ name: "DB_URL", updatedAt: "2026-10-21T10:01:00.000Z" }, { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:00:00.000Z" }] };
  const h = harness(() => ({ status: 200, body: listing }));
  assert.equal(await run("secrets", [], h.io), 0, h.out.stderr);
  assert.deepEqual(h.seen, [{ method: "GET", url: "http://server.test/api/secrets", body: undefined, authorization: "Bearer tok-1" }]);
  assert.equal(h.out.stdout, "DB_URL      set 2026-10-21T10:01:00.000Z\nSTRIPE_KEY  set 2026-10-21T10:00:00.000Z\n");
  const json = harness(() => ({ status: 200, body: listing }));
  assert.equal(await run("secrets", ["--json"], json.io), 0);
  assert.deepEqual(JSON.parse(json.out.stdout), listing);
  const none = harness(() => ({ status: 200, body: { secrets: [] } }));
  assert.equal(await run("secrets", [], none.io), 0);
  assert.match(none.out.stdout, /no secrets/i);
});

test("set reads the value from standard input, drops one trailing newline, sends it once and never prints it", async () => {
  const { run } = await script();
  const h = harness(() => ({ status: 200, body: { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:00:00.000Z" } }), "sk_live_secret\n");
  assert.equal(await run("secrets", ["set", "STRIPE_KEY"], h.io), 0, h.out.stderr);
  assert.deepEqual(h.seen, [{ method: "PUT", url: "http://server.test/api/secrets/STRIPE_KEY", body: JSON.stringify({ value: "sk_live_secret" }), authorization: "Bearer tok-1" }]);
  assert.ok(!h.out.stdout.includes("sk_live_secret") && !h.out.stderr.includes("sk_live_secret"));
  assert.match(h.out.stdout, /STRIPE_KEY/);
  const json = harness(() => ({ status: 200, body: { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:00:00.000Z" } }), "multi\nline\n\n");
  assert.equal(await run("secrets", ["set", "STRIPE_KEY", "--json"], json.io), 0);
  assert.equal(JSON.parse(json.seen[0]!.body!).value, "multi\nline\n", "only one newline is dropped");
  assert.deepEqual(JSON.parse(json.out.stdout), { secret: { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:00:00.000Z" } });
  for (const stdin of ["", "\n"]) {
    const empty = harness(() => ({ status: 200, body: {} }), stdin);
    assert.equal(await run("secrets", ["set", "STRIPE_KEY"], empty.io), 2, "an empty value is a usage error");
    assert.equal(empty.seen.length, 0, "nothing is sent");
    assert.match(empty.out.stderr, /standard input/);
  }
  const big = harness(() => ({ status: 200, body: {} }), "x".repeat(4097));
  assert.equal(await run("secrets", ["set", "STRIPE_KEY"], big.io), 2);
  assert.equal(big.seen.length, 0);
  assert.match(big.out.stderr, /4096/);
});

test("remove sends DELETE; a refusal exits 1 with the server's reason, a dead token exits 2, no answer exits 3", async () => {
  const { run } = await script();
  const ok = harness(() => ({ status: 200, body: { name: "OLD_KEY", deleted: true } }));
  assert.equal(await run("secrets", ["remove", "OLD_KEY"], ok.io), 0, ok.out.stderr);
  assert.deepEqual(ok.seen.map((s) => [s.method, s.url]), [["DELETE", "http://server.test/api/secrets/OLD_KEY"]]);
  assert.match(ok.out.stdout, /Removed OLD_KEY/);
  const json = harness(() => ({ status: 200, body: { name: "OLD_KEY", deleted: true } }));
  assert.equal(await run("secrets", ["remove", "OLD_KEY", "--json"], json.io), 0);
  assert.deepEqual(JSON.parse(json.out.stdout), { name: "OLD_KEY", deleted: true });

  // A 404 makes the shared transport probe the session route once; a Pagegi server answers it 200.
  const missing = harness((seen) => (seen.url.endsWith("/api/auth/session") ? { status: 200, body: { username: "me" } } : { status: 404, body: { error: "No secret named OLD_KEY" } }));
  assert.equal(await run("secrets", ["remove", "OLD_KEY"], missing.io), 1);
  assert.match(missing.out.stderr, /No secret named OLD_KEY/);
  const full = harness(() => ({ status: 422, body: { error: "An account keeps at most 64 secrets" } }), "v");
  assert.equal(await run("secrets", ["set", "ONE_MORE"], full.io), 1);
  assert.match(full.out.stderr, /at most 64 secrets/);
  const unconfigured = harness(() => ({ status: 503, body: { error: "Secrets are not configured" } }));
  assert.equal(await run("secrets", [], unconfigured.io), 3);
  assert.match(unconfigured.out.stderr, /Secrets are not configured/);

  const dead = harness(() => ({ status: 401, body: { error: "Sign in required" } }));
  assert.equal(await run("secrets", [], dead.io), 2);
  assert.match(dead.out.stderr, /refused AF_TOKEN/);
  const signedOut = harness(() => ({ status: 200, body: { secrets: [] } }));
  assert.equal(await run("secrets", [], { ...signedOut.io, env: { AF_SERVER: "http://server.test", AF_HOME: "/nonexistent" } }), 2);
  assert.equal(signedOut.seen.length, 0);
  assert.match(signedOut.out.stderr, /auth\.mjs/);

  const sleeps: number[] = [];
  const down = harness(() => {
    throw TypeError("fetch failed");
  });
  assert.equal(await run("secrets", [], { ...down.io, ports: { sleep: async (ms: number) => void sleeps.push(ms) } }), 3);
  assert.equal(down.seen.length, 3, "the shared transport's three tries");
  assert.match(down.out.stderr, /after 3 tries/);
});
