import { test } from "node:test";
import assert from "node:assert/strict";
import type { AfFetch, AfScriptModule } from "../../../src/af-script/af-contracts.ts";
import { load } from "../support/load.ts";
import { MemoryFs } from "../support/lifecycle-fakes.ts";

const script = () => load<AfScriptModule>("src/af-script/af.ts");

function io(fetch?: AfFetch, env: Record<string, string> = {}) {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: { env, cwd: "/nonexistent", stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t), fetch },
  };
}

test("each script parses its own flags, and another script's flags are usage errors", async () => {
  const { parseArguments } = await script();
  assert.deepEqual(parseArguments("shot", ["p.html", "--width", "390", "--dark"]), {
    kind: "shot",
    file: "p.html",
    width: 390,
    dark: true,
    designSystem: null,
    out: "shot.png",
    state: null,
  });
  assert.deepEqual(parseArguments("check", ["p.html", "--json", "--write-ids"]), { kind: "check", file: "p.html", writeIds: true, json: true });
  assert.deepEqual(parseArguments("check", ["p.html"]), { kind: "check", file: "p.html", writeIds: false, json: false });
  assert.deepEqual(parseArguments("add", ["a.ts", "b.ts", "--json"]), { kind: "add", paths: ["a.ts", "b.ts"], json: true });
  assert.deepEqual(parseArguments("check", ["p.html", "--help"]), { kind: "help" });
  for (const [name, argv] of [
    ["check", ["p.html", "--write"]],
    ["check", ["p.html", "--dark"]],
    ["check", ["a.html", "b.html"]],
    ["check", []],
    ["add", ["a.ts", "--write-ids"]],
    ["add", []],
    ["shot", ["p.html", "--json"]],
    ["shot", ["p.html", "--design-system", "nope"]],
  ] as const)
    assert.throws(() => parseArguments(name, argv), /^Error: Usage.*\n.*node scripts\/\w+\.mjs --help/, `${name} ${argv.join(" ")}`);
});

/** A working directory holding the backend files a test adds. */
function workdir(...paths: string[]) {
  const fs = new MemoryFs();
  for (const path of paths) fs.files.set(`/nonexistent/${path.replace(/^\.\//, "")}`, `// ${path}\n`);
  return fs;
}

test("add exits 3 on a server error and on an unreachable server, after the shared transport's 3 tries", async () => {
  const { run } = await script();
  const env = { AF_TOKEN: "t", AF_SERVER: "http://server.test/" };
  const fs = workdir("a.ts");
  const urls: string[] = [];
  const refused = io(async (url) => {
    urls.push(url);
    return { status: 403, json: async () => ({ error: "Forbidden" }) };
  }, env);
  assert.equal(await run("add", ["a.ts"], { ...refused.io, ports: { fs } }), 3);
  assert.match(refused.out.stderr, /answered 403: Forbidden/);
  assert.deepEqual(urls, ["http://server.test/api/ids", "http://server.test/api/auth/session"], "one session probe tells a dead token from revoked access");

  const sleeps: number[] = [];
  let attempts = 0;
  const down = io(async () => {
    attempts++;
    throw TypeError("fetch failed");
  }, env);
  assert.equal(await run("add", ["a.ts"], { ...down.io, ports: { fs, sleep: async (ms: number) => void sleeps.push(ms) } }), 3);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [1000, 3000]);
  assert.match(down.out.stderr, /Could not reach http:\/\/server\.test\/api\/ids after 3 tries/);

  const expired = io(async (url) => ({ status: url.endsWith("/api/auth/session") ? 401 : 403, json: async () => ({ error: "Forbidden" }) }), env);
  assert.equal(await run("add", ["a.ts"], { ...expired.io, ports: { fs } }), 2, "an expired sign-in is told apart from revoked access");
  assert.match(expired.out.stderr, /401.*[Ss]ign in again/);

  const foreign = io(async () => ({ status: 404, json: async () => ({ error: "not_found" }) }), env);
  assert.equal(await run("add", ["a.ts"], { ...foreign.io, ports: { fs } }), 2, "a server without the API is an environment error, like a bad token");
  assert.match(foreign.out.stderr, /http:\/\/server\.test does not look like an Artifactbin server/);
  assert.match(foreign.out.stderr, /AF_SERVER/);
});

test("add refuses a path that does not exist before any request, and keeps the first ID of a path already in .af/ids.json", async () => {
  const { run } = await script();
  const fs = workdir("a.ts", "b.ts");
  const requests: Record<string, unknown>[] = [];
  const server = async (_url: string, init: { body?: string }) => {
    requests.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
    return { status: 201, json: async () => ({ ids: ["Cr4mZ9"] }) };
  };
  const missing = io(server, { AF_TOKEN: "t" });
  assert.equal(await run("add", ["a.ts", "backends/missing.ts"], { ...missing.io, ports: { fs } }), 2);
  assert.match(missing.out.stderr, /Cannot read backends\/missing\.ts: no such file\./);
  assert.equal(requests.length, 0, "nothing is reserved for a file that is not there");
  assert.equal(fs.files.has("/nonexistent/.af/ids.json"), false);

  fs.files.set("/nonexistent/.af/ids.json", JSON.stringify({ Bk7Qa2: "a.ts" }));
  const again = io(server, { AF_TOKEN: "t" });
  assert.equal(await run("add", ["a.ts", "b.ts"], { ...again.io, ports: { fs } }), 0, again.out.stderr);
  assert.equal(again.out.stdout, "a.ts  Bk7Qa2\nb.ts  Cr4mZ9\n", "the first ID is printed again, the new path gets a fresh one");
  assert.match(again.out.stderr, /a\.ts already has ID Bk7Qa2; keeping it/);
  assert.deepEqual(requests, [{ count: 1 }], "only the new path is reserved");
  assert.deepEqual(JSON.parse(fs.files.get("/nonexistent/.af/ids.json")!), { Bk7Qa2: "a.ts", Cr4mZ9: "b.ts" });

  const same = io(server, { AF_TOKEN: "t" });
  assert.equal(await run("add", ["a.ts", "--json"], { ...same.io, ports: { fs } }), 0);
  assert.deepEqual(JSON.parse(same.out.stdout), { files: [{ path: "a.ts", id: "Bk7Qa2" }] });
  assert.equal(requests.length, 1, "no request when every path already has an ID");

  // One path spelled twice in one run is one file: one ID, reserved once.
  fs.files.set("/nonexistent/c.ts", "// c\n");
  const twice = io(async (_url: string, init: { body?: string }) => {
    requests.push(JSON.parse(init.body ?? "{}") as { count: number });
    return { status: 201, json: async () => ({ ids: ["Dd5nX1"] }) };
  }, { AF_TOKEN: "t" });
  assert.equal(await run("add", ["c.ts", "./c.ts"], { ...twice.io, ports: { fs } }), 0, twice.out.stderr);
  assert.equal(twice.out.stdout, "c.ts    Dd5nX1\n./c.ts  Dd5nX1\n");
  assert.deepEqual(requests.at(-1), { count: 1 });
  assert.deepEqual(JSON.parse(fs.files.get("/nonexistent/.af/ids.json")!), { Bk7Qa2: "a.ts", Cr4mZ9: "b.ts", Dd5nX1: "c.ts" });
});

test("add --json prints each path with its reserved ID and records them in .af/ids.json", async () => {
  const { run } = await script();
  const fs = workdir("a.ts", "b/c.ts");
  fs.files.set("/nonexistent/.af/ids.json", JSON.stringify({ Pg4mQ2: "page.html" }));
  const ok = io(async () => ({ status: 201, json: async () => ({ ids: ["Bk7Qa2", "Cr4mZ9"] }) }), { AF_TOKEN: "t" });
  assert.equal(await run("add", ["a.ts", "./b/c.ts", "--json"], { ...ok.io, ports: { fs } }), 0, ok.out.stderr);
  assert.deepEqual(JSON.parse(ok.out.stdout), {
    files: [
      { path: "a.ts", id: "Bk7Qa2" },
      { path: "./b/c.ts", id: "Cr4mZ9" },
    ],
  });
  assert.deepEqual(JSON.parse(fs.files.get("/nonexistent/.af/ids.json")!), { Pg4mQ2: "page.html", Bk7Qa2: "a.ts", Cr4mZ9: "b/c.ts" });
});

test("publish and comments parse their own flags; conflicting or incomplete flags are usage errors", async () => {
  const { parseArguments } = await script();
  const action = (argv: string[]) => {
    const command = parseArguments("comments", argv);
    return command.kind === "comments" ? command.action : null;
  };
  assert.deepEqual(parseArguments("publish", ["p.html"]), { kind: "publish", file: "p.html", mode: "publish", json: false });
  assert.deepEqual(parseArguments("publish", ["p.html", "--pull", "--json"]), { kind: "publish", file: "p.html", mode: "pull", json: true });
  assert.deepEqual(parseArguments("publish", ["p.html", "--delete", "--yes"]), { kind: "publish", file: "p.html", mode: "delete", json: false });
  assert.deepEqual(parseArguments("comments", ["p.html"]), { kind: "comments", target: "p.html", action: { kind: "list" }, json: false });
  assert.deepEqual(parseArguments("comments", ["Pg4mQ2", "--reply", "c1", "--body", "Done"]), {
    kind: "comments",
    target: "Pg4mQ2",
    action: { kind: "reply", commentId: "c1", body: "Done" },
    json: false,
  });
  assert.deepEqual(action(["p.html", "--on", "n3", "--body", "Why?", "--quote", "Total"]), {
    kind: "comment",
    nodeId: "n3",
    body: "Why?",
    quote: "Total",
  });
  assert.deepEqual(action(["p.html", "--reopen", "c1"]), { kind: "resolve", commentId: "c1", resolved: false });
  assert.deepEqual(parseArguments("comments", ["p.html", "--watch", "--json"]), { kind: "comments", target: "p.html", action: { kind: "watch" }, json: true });
  for (const [name, argv] of [
    ["publish", ["p.html", "--delete"]],
    ["publish", ["p.html", "--yes"]],
    ["publish", ["p.html", "--pull", "--force"]],
    ["publish", ["p.html", "--watch"]],
    ["comments", ["p.html", "--reply", "c1"]],
    ["comments", ["p.html", "--resolve", "c1", "--body", "x"]],
    ["comments", ["p.html", "--watch", "--context", "c1"]],
    ["comments", ["p.html", "--quote", "x"]],
    ["comments", []],
  ] as const)
    assert.throws(() => parseArguments(name, argv), /^Error: Usage.*\n.*node scripts\/\w+\.mjs --help/, `${name} ${argv.join(" ")}`);
});

test("check and shot on a missing file exit 2", async () => {
  const { run } = await script();
  for (const name of ["check", "shot"] as const) {
    const missing = io();
    assert.equal(await run(name, ["missing.html"], missing.io), 2);
    assert.match(missing.out.stderr, /missing\.html/);
  }
});

test("auth parses its flags into one action; incomplete or mixed flags are usage errors", async () => {
  const { parseArguments } = await script();
  assert.deepEqual(parseArguments("auth", []), { kind: "auth", action: { kind: "status" }, json: false });
  assert.deepEqual(parseArguments("auth", ["--json"]), { kind: "auth", action: { kind: "status" }, json: true });
  assert.deepEqual(parseArguments("auth", ["--email", "you@example.test"]), { kind: "auth", action: { kind: "request", email: "you@example.test" }, json: false });
  assert.deepEqual(parseArguments("auth", ["--email", "you@example.test", "--code", "123456", "--json"]), {
    kind: "auth",
    action: { kind: "verify", email: "you@example.test", code: "123456" },
    json: true,
  });
  assert.deepEqual(parseArguments("auth", ["--test-token", "--email=dev@example.test"]), { kind: "auth", action: { kind: "test-token", email: "dev@example.test" }, json: false });
  assert.deepEqual(parseArguments("auth", ["--logout"]), { kind: "auth", action: { kind: "logout" }, json: false });
  for (const argv of [
    ["--code", "123456"],
    ["--test-token"],
    ["--test-token", "--email", "a@b.test", "--code", "1"],
    ["--logout", "--email", "a@b.test"],
    ["--email"],
    ["page.html"],
    ["--token", "x"],
  ])
    assert.throws(() => parseArguments("auth", argv), /^Error: Usage.*\n.*node scripts\/auth\.mjs --help/, argv.join(" "));
  assert.throws(() => parseArguments("publish", ["p.html", "--logout"]), /unknown flag "--logout"/);
});

test("add sends the saved token for AF_SERVER when AF_TOKEN is unset, and a 401 exits 2 asking to sign in again", async () => {
  const { run } = await script();
  const fs = workdir("a.ts", "b.ts", "c.ts");
  const home = "/home/agent";
  fs.files.set(`${home}/.af/credentials.json`, JSON.stringify({ "http://server.test": { token: "saved-token", email: "you@example.test", savedAt: "x" } }));
  const env = { HOME: home, AF_SERVER: "http://server.test/" };
  const seen: (string | undefined)[] = [];
  const ok = io(async (_url, init) => {
    seen.push(init.headers.Authorization);
    return { status: 201, json: async () => ({ ids: ["Bk7Qa2"] }) };
  }, env);
  assert.equal(await run("add", ["a.ts"], { ...ok.io, ports: { fs } }), 0, ok.out.stderr);
  assert.deepEqual(seen, ["Bearer saved-token"]);
  assert.ok(![...fs.files].some(([path, text]) => path.startsWith("/nonexistent/.af") && text.includes("saved-token")), "no token in .af/");

  const refused = io(async () => ({ status: 401, json: async () => ({ error: "Sign in required" }) }), env);
  assert.equal(await run("add", ["b.ts"], { ...refused.io, ports: { fs } }), 2);
  assert.equal(refused.out.stderr, "http://server.test refused the saved token (401). Run node scripts/auth.mjs --email you@example.test to sign in again.\n");

  const none = io(async () => assert.fail("no request without a token"), { HOME: home, AF_SERVER: "http://new.test" });
  assert.equal(await run("add", ["c.ts"], { ...none.io, ports: { fs } }), 2);
  assert.match(none.out.stderr, /^Not signed in to http:\/\/new\.test\. To reserve IDs, run node scripts\/auth\.mjs --email <address> to sign in, or set AF_TOKEN/);
});

test("publish accepts only an initial visibility and rejects invalid values or noncreation modes", async () => {
  const { parseArguments } = await script();
  assert.deepEqual(parseArguments("publish", ["p.html", "--visibility", "private"]), {kind:"publish",file:"p.html",mode:"publish",json:false,visibility:"private"});
  for (const args of [["p.html","--visibility","secret"], ["p.html","--pull","--visibility","private"], ["p.html","--force","--visibility","public"], ["p.html","--delete","--yes","--visibility","private"]])
    assert.throws(() => parseArguments("publish", args), /Usage/);
});
