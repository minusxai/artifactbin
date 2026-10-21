/**
 * Integration: auth.mjs, run as built, against a real server and database
 * (test login on, email codes captured by the server's sendCode port), with
 * AF_HOME in a temporary folder. Then publish.mjs and add.mjs with no AF_TOKEN.
 * This needs Postgres, so it is a .database test rather than a .local one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthJson, CredentialFile } from "../../../src/af-script/auth-contracts.ts";
import type { PublishJson } from "../../../src/af-script/lifecycle-contracts.ts";
import { repositoryPath } from "../support/load.ts";
import { page, startServer } from "../support/server.ts";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function workspace(origin: string) {
  const root = mkdtempSync(join(tmpdir(), "af-auth-"));
  cpSync(repositoryPath("skills/pagegi-author/scripts"), join(root, "scripts"), { recursive: true });
  const dir = join(root, "work");
  mkdirSync(dir);
  mkdirSync(join(root, "home"));
  const credentials = join(root, "credentials");
  const outputs: string[] = [];
  const run = (script: "auth" | "publish" | "add", args: string[], env: Record<string, string> = {}): Promise<Run> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "scripts", `${script}.mjs`), ...args], {
        cwd: dir,
        env: { PATH: process.env.PATH ?? "", HOME: join(root, "home"), AF_HOME: credentials, AF_SERVER: origin, ...env },
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        outputs.push(stdout, stderr);
        resolve({ code, stdout, stderr });
      });
    });
  const saved = () => JSON.parse(readFileSync(join(credentials, "credentials.json"), "utf8")) as CredentialFile;
  return { root, dir, credentials, outputs, run, saved, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Every file under `path`, recursively. */
function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

test("email-code sign-in saves a token that status confirms, publish.mjs and add.mjs use without AF_TOKEN, and logout forgets", async () => {
  const codes: { to: string; code: string }[] = [];
  const server = await startServer({ sendCode: async (message) => void codes.push(message) });
  const ws = workspace(server.origin);
  try {
    const before = await ws.run("auth", []);
    assert.equal(before.code, 1, "not signed in yet");
    assert.match(before.stdout, /\(current\): not signed in\./);

    const sent = await ws.run("auth", ["--email", "Author@Example.test"]);
    assert.equal(sent.code, 0, sent.stderr);
    assert.equal(codes.length, 1);
    assert.equal(codes[0]!.to, "author@example.test");
    assert.equal((await ws.run("auth", ["--email", "author@example.test", "--code", "000000"])).code, 1, "a wrong code is refused");
    const verified = await ws.run("auth", ["--email", "author@example.test", "--code", codes[0]!.code, "--json"]);
    assert.equal(verified.code, 0, verified.stderr);
    const result = JSON.parse(verified.stdout) as AuthJson;
    assert.equal(result.status, "signed-in");
    assert.equal(result.email, "author@example.test");
    const entry = ws.saved()[server.origin]!;
    assert.equal(entry.email, "author@example.test");
    assert.ok(entry.token.length >= 32);
    assert.equal(statSync(join(ws.credentials, "credentials.json")).mode & 0o777, 0o600);
    assert.equal(statSync(ws.credentials).mode & 0o777, 0o700);
    const paths = await server.request("/api/paths", { token: entry.token });
    assert.equal(paths.status, 200, "the saved token works on the API");

    const status = await ws.run("auth", ["--json"]);
    assert.equal(status.code, 0, status.stdout + status.stderr);
    assert.deepEqual((JSON.parse(status.stdout) as AuthJson).servers, [
      { server: server.origin, current: true, source: "credentials", email: "author@example.test", state: "signed-in", detail: null },
    ]);

    // publish.mjs and add.mjs with no AF_TOKEN in their environment.
    writeFileSync(join(ws.dir, "page.html"), page("<h1>Plan</h1>"));
    const published = await ws.run("publish", ["page.html", "--json"]);
    assert.equal(published.code, 0, published.stdout + published.stderr);
    const created = JSON.parse(published.stdout) as PublishJson;
    assert.equal(created.status, "created", created.message);
    const head = await server.request(`/api/files/${created.id}/source`, { token: entry.token });
    assert.equal(head.status, 200, "published under the signed-in account");
    // The files exist before they get IDs: add.mjs refuses a path that is not there.
    mkdirSync(join(ws.dir, "backends"));
    for (const name of ["billing", "stats"]) writeFileSync(join(ws.dir, "backends", `${name}.ts`), "");
    const added = await ws.run("add", ["backends/billing.ts"]);
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stdout, /^backends\/billing\.ts {2}[A-Za-z0-9]{6}\n$/);

    // The session ends on the server: the scripts say to sign in again, and status shows it signed out.
    await server.query("DELETE FROM sessions");
    for (const [script, args] of [
      ["publish", ["page.html", "--new"]],
      ["add", ["backends/stats.ts"]],
    ] as const) {
      const refused = await ws.run(script, [...args]);
      assert.equal(refused.code, 2, `${script}: ${refused.stdout}${refused.stderr}`);
      assert.match(refused.stderr, /refused the saved token \(401\)\. Run node scripts\/auth\.mjs --email author@example\.test to sign in again\./, script);
    }
    const expired = await ws.run("auth", []);
    assert.equal(expired.code, 1);
    assert.match(expired.stdout, /\(current\): signed out \(author@example\.test\): the server refused the token \(401\)/);

    const out = await ws.run("auth", ["--logout"]);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(ws.saved(), {});
    const missing = await ws.run("publish", ["page.html"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Not signed in to .*node scripts\/auth\.mjs --email <address>.*AF_TOKEN/);

    for (const text of ws.outputs) assert.ok(!text.includes(entry.token), "a token was printed");
    for (const file of [join(ws.dir, "page.html"), ...filesUnder(join(ws.dir, ".af"))])
      assert.ok(!readFileSync(file, "utf8").includes(entry.token), `${file} holds a token`);
  } finally {
    ws.cleanup();
    await server.close();
  }
});

test("--test-token signs in on a server with test login, and is refused (404) on one without", async () => {
  const server = await startServer();
  const closed = await startServer({ testLogin: false });
  const ws = workspace(server.origin);
  try {
    const signed = await ws.run("auth", ["--test-token", "--email", "dev@example.test"]);
    assert.equal(signed.code, 0, signed.stderr);
    assert.match(signed.stderr, /^Note: --test-token only works on development servers/);
    assert.match(signed.stdout, /^Signed in to http:\/\/127\.0\.0\.1:\d+ as dev@example\.test\./);
    assert.equal((await ws.run("auth", [])).code, 0);
    const refused = await ws.run("auth", ["--test-token", "--email", "dev@example.test"], { AF_SERVER: closed.origin });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /does not issue test tokens \(404\)/);
    assert.deepEqual(Object.keys(ws.saved()), [server.origin]);

    // Status from the other server lists both: that one not signed in (exit 1), this one still signed in.
    const both = await ws.run("auth", [], { AF_SERVER: closed.origin });
    assert.equal(both.code, 1);
    const lines = both.stdout.trimEnd().split("\n");
    assert.match(lines[0]!, /^http:\/\/127\.0\.0\.1:\d+ \(current\): not signed in\./);
    assert.equal(lines[1], `${server.origin}: signed in as dev@example.test.`);

    // AF_TOKEN wins over the saved token.
    writeFileSync(join(ws.dir, "page.html"), page("<h1>Plan</h1>"));
    const withEnv = await ws.run("publish", ["page.html"], { AF_TOKEN: "not-a-token" });
    assert.equal(withEnv.code, 2);
    assert.match(withEnv.stderr, /refused AF_TOKEN \(401\)/);
  } finally {
    ws.cleanup();
    await server.close();
    await closed.close();
  }
});

test("GET /api/auth/session names the token's account, and is 401 without a valid one", async () => {
  const server = await startServer();
  try {
    const token = await server.token("whoami@example.test");
    const ok = await server.request("/api/auth/session", { token });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { username: "whoami@example.test", handle: null });
    assert.equal((await server.request("/api/auth/session", { token: "nope" })).status, 401);
    assert.equal((await server.request("/api/auth/session")).status, 401);
  } finally {
    await server.close();
  }
});
