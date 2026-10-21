import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageModelModule } from "../../../src/page/page-contracts.ts";
import type { AfScriptName, CheckJson } from "../../../src/af-script/af-contracts.ts";
import { load, repositoryPath } from "../support/load.ts";
import { skillExample, skillFile } from "../support/skill.ts";

const SCRIPTS = repositoryPath("skills/pagegi-author/scripts");
const NAMES: AfScriptName[] = ["add", "check", "shot", "publish", "comments", "auth", "secrets"];
const FILES = [...NAMES.map((name) => `${name}.mjs`), "lib/af-lib.mjs"];

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Copies the skill's scripts/ folder into an empty directory and runs them by
 * path from a separate working directory: nothing installed, isolated HOME.
 */
function workspace() {
  for (const file of FILES) assert.ok(existsSync(join(SCRIPTS, file)), `skills/pagegi-author/scripts/${file} exists`);
  const root = mkdtempSync(join(tmpdir(), "af-script-"));
  cpSync(SCRIPTS, join(root, "skill", "scripts"), { recursive: true });
  const dir = join(root, "work");
  mkdirSync(dir);
  // The backend files the tests add: add.mjs refuses a path that is not there.
  mkdirSync(join(dir, "backends"));
  for (const name of ["billing", "crm"]) writeFileSync(join(dir, "backends", `${name}.ts`), `export const typeDefs = "${name}";\n`);
  mkdirSync(join(root, "home"));
  const run = (name: AfScriptName, args: string[], env: Record<string, string> = {}): Promise<Run> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "skill", "scripts", `${name}.mjs`), ...args], {
        cwd: dir,
        env: { PATH: process.env.PATH ?? "", HOME: join(root, "home"), ...env },
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  return { root, dir, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("each script's --help prints exactly its usage in references/scripts.md", async () => {
  const ws = workspace();
  try {
    for (const name of NAMES) {
      const result = await ws.run(name, ["--help"]);
      assert.equal(result.code, 0, name);
      assert.equal(result.stdout.trimEnd(), skillExample("references/scripts.md", `Usage: node scripts/${name}.mjs`).code.trimEnd(), name);
    }
  } finally {
    ws.cleanup();
  }
});

test("the scripts import nothing but Node built-ins and their one shared module", () => {
  for (const file of FILES) {
    assert.ok(existsSync(join(SCRIPTS, file)), `skills/pagegi-author/scripts/${file} exists`);
    const source = readFileSync(join(SCRIPTS, file), "utf8");
    const specifiers = [...source.matchAll(/(?:^|[\s;])(?:import|export)[^'"`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm)].map(
      (match) => match[1] ?? match[2],
    );
    assert.ok(specifiers.length, file);
    for (const specifier of specifiers)
      if (file.startsWith("lib/")) assert.match(specifier!, /^node:/, file);
      else assert.match(specifier!, /^(?:node:.*|\.\/lib\/af-lib\.mjs)$/, file);
  }
});

test("check --write-ids adds the IDs the platform would, prints each one, then checks", async () => {
  const ws = workspace();
  try {
    const todo = skillFile("examples/todo.html");
    const file = join(ws.dir, "page.html");
    writeFileSync(file, todo);
    const plain = await ws.run("check", ["page.html"]);
    assert.equal(plain.code, 0, plain.stdout + plain.stderr);
    assert.equal(plain.stdout, "page.html: no problems found.\n", "without --write-ids nothing about IDs");
    assert.equal(readFileSync(file, "utf8"), todo, "without --write-ids the file is unchanged");

    const { assignNodeIds } = await load<PageModelModule>("src/page/page-model.ts");
    const expected = assignNodeIds(todo);
    assert.ok(expected.changes.length > 0);
    const written = await ws.run("check", ["page.html", "--write-ids"]);
    assert.equal(written.code, 0, written.stdout + written.stderr);
    assert.equal(readFileSync(file, "utf8"), expected.source, "same result as the platform's save");
    assert.equal(
      written.stdout,
      expected.changes.map((c) => `page.html:${c.line}  added <${c.tag} data-af-id="${c.id}">\n`).join("") + "page.html: no problems found.\n",
    );
    assert.match(written.stderr, new RegExp(`wrote ${expected.changes.length} new IDs`));

    const again = await ws.run("check", ["page.html", "--write-ids", "--json"]);
    assert.equal(again.code, 0);
    assert.deepEqual(JSON.parse(again.stdout) as CheckJson, { file: "page.html", problems: [], ids: { written: false, changes: [] } });
    assert.equal(readFileSync(file, "utf8"), expected.source, "existing IDs are kept");

    writeFileSync(file, todo);
    const json = await ws.run("check", ["page.html", "--write-ids", "--json"]);
    assert.deepEqual(JSON.parse(json.stdout) as CheckJson, {
      file: "page.html",
      problems: [],
      ids: { written: true, changes: expected.changes },
    });
  } finally {
    ws.cleanup();
  }
});

test("check --write-ids leaves a page with invalid metadata alone and reports it", async () => {
  const ws = workspace();
  try {
    const broken = skillFile("examples/todo.html").replace('{ "name": "Team todo list" }', '{ "name": ');
    writeFileSync(join(ws.dir, "broken.html"), broken);
    const result = await ws.run("check", ["broken.html", "--write-ids"]);
    assert.equal(result.code, 1);
    assert.equal(readFileSync(join(ws.dir, "broken.html"), "utf8"), broken);
    assert.match(result.stderr, /no IDs added/);
    assert.match(result.stdout, /^broken\.html:5\s+meta-invalid-json\s+\S/m);
  } finally {
    ws.cleanup();
  }
});

test("check reports problems with line numbers and exits 1, or exits 0 for a clean page", async () => {
  const ws = workspace();
  try {
    writeFileSync(join(ws.dir, "todo.html"), skillFile("examples/todo.html"));
    const clean = await ws.run("check", ["todo.html"]);
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);
    writeFileSync(
      join(ws.dir, "bad.html"),
      `<!DOCTYPE html>
<html>
<head>
  <title>No core</title>
</head>
<body>
  <p data-af-id="a">1</p>
  <p data-af-id="a">2</p>
</body>
</html>
`,
    );
    const bad = await ws.run("check", ["bad.html"]);
    assert.equal(bad.code, 1);
    const lines = bad.stdout.trim().split("\n");
    assert.match(lines[0]!, /^bad\.html:\d+\s+core-missing\s+\S/);
    assert.match(lines[1]!, /^bad\.html:8\s+duplicate-node-id\s+\S/);
    const json = await ws.run("check", ["bad.html", "--json"]);
    assert.equal(json.code, 1);
    const output = JSON.parse(json.stdout) as CheckJson;
    assert.deepEqual(
      output.problems.map((p) => p.code),
      ["core-missing", "duplicate-node-id"],
    );
    assert.equal(output.ids, undefined, "no ids field without --write-ids");
  } finally {
    ws.cleanup();
  }
});

test("check warns about an author import map without failing", async () => {
  const ws = workspace();
  try {
    writeFileSync(
      join(ws.dir, "map.html"),
      skillFile("examples/todo.html").replace(
        "</head>",
        `  <script type="importmap">{ "imports": { "lit": "https://cdn.jsdelivr.net/npm/lit@3.2.1/index.js" } }</script>\n</head>`,
      ),
    );
    const result = await ws.run("check", ["map.html"]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^map\.html:\d+\s+warning author-importmap\s+.*Firefox/m);
    const json = JSON.parse((await ws.run("check", ["map.html", "--json"])).stdout) as CheckJson;
    assert.deepEqual(
      json.problems.map((p) => [p.code, p.warning]),
      [["author-importmap", true]],
    );
  } finally {
    ws.cleanup();
  }
});

test("add reserves IDs from AF_SERVER with AF_TOKEN, retrying once with the same Idempotency-Key", async () => {
  const ws = workspace();
  const seen: { auth?: string; key?: string; body: string }[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ auth: req.headers.authorization, key: req.headers["idempotency-key"] as string | undefined, body });
    if (req.method !== "POST" || req.url !== "/api/ids") {
      res.writeHead(404).end();
      return;
    }
    if (seen.length === 1) {
      req.socket.destroy();
      return;
    }
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ids: ["Bk7Qa2", "Cr4mZ9"] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const result = await ws.run("add", ["backends/billing.ts", "backends/crm.ts"], {
      AF_SERVER: `http://127.0.0.1:${port}`,
      AF_TOKEN: "test-token-value",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "backends/billing.ts  Bk7Qa2\nbackends/crm.ts      Cr4mZ9\n");
    assert.equal(seen.length, 2);
    for (const request of seen) {
      assert.equal(request.auth, "Bearer test-token-value");
      assert.deepEqual(JSON.parse(request.body), { count: 2 });
      assert.ok(request.key && request.key.length >= 16);
    }
    assert.equal(seen[0]!.key, seen[1]!.key);
  } finally {
    ws.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("add without a token, and unknown flags, fail with exit code 2", async () => {
  const ws = workspace();
  try {
    const noToken = await ws.run("add", ["backends/billing.ts"]);
    assert.equal(noToken.code, 2);
    assert.match(noToken.stderr, /AF_TOKEN/);
    for (const name of NAMES) {
      const unknown = await ws.run(name, ["page.html", "--deploy"]);
      assert.equal(unknown.code, 2, name);
      assert.match(unknown.stderr, new RegExp(`Usage error: unknown flag "--deploy"\\.\\nRun node scripts/${name}\\.mjs --help`), name);
    }
  } finally {
    ws.cleanup();
  }
});

test("auth signs in with an emailed code, keeps the token in AF_HOME 0600, reports and forgets it, never printing it", { skip: process.platform === "win32" }, async () => {
  const ws = workspace();
  const token = "local-secret-token-0123456789abcdef";
  let valid = true;
  const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    const send = (status: number, value: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/api/auth/email/request") return send(200, { sent: true });
    if (req.url === "/api/auth/email/verify")
      return JSON.parse(body).code === "123456" ? send(200, { token, username: "you@example.test" }) : send(401, { error: "Invalid code" });
    if (req.url === "/api/auth/session") return valid && req.headers.authorization === `Bearer ${token}` ? send(200, { username: "you@example.test" }) : send(401, { error: "Sign in required" });
    return send(404, { error: "Not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const home = join(ws.root, "credentials");
    const env = { AF_SERVER: `${origin}/`, AF_HOME: home };
    const file = join(home, "credentials.json");
    const outputs: string[] = [];
    const auth = async (args: string[]) => {
      const result = await ws.run("auth", args, env);
      outputs.push(result.stdout, result.stderr);
      return result;
    };
    const sent = await auth(["--email", "you@example.test"]);
    assert.equal(sent.code, 0, sent.stderr);
    assert.match(sent.stdout, /^Sent a sign-in code to you@example\.test\./);
    assert.ok(!existsSync(file));
    assert.equal((await auth(["--email", "you@example.test", "--code", "999999"])).code, 1);
    const verified = await auth(["--email", "you@example.test", "--code", "123456", "--json"]);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).status, "signed-in");
    const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, { token: string; email: string; savedAt: string }>;
    assert.deepEqual(Object.keys(saved), [origin]);
    assert.equal(saved[origin]!.token, token);
    assert.equal(saved[origin]!.email, "you@example.test");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(home).mode & 0o777, 0o700);

    const status = await auth([]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(status.stdout, `${origin} (current): signed in as you@example.test.\n`);
    assert.equal(seen.at(-1)!.auth, `Bearer ${token}`);
    valid = false;
    const expired = await auth([]);
    assert.equal(expired.code, 1);
    assert.match(expired.stdout, /signed out \(you@example\.test\): the server refused the token \(401\)/);

    const out = await auth(["--logout"]);
    assert.equal(out.code, 0);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {});
    assert.equal((await auth([])).code, 1);
    for (const text of outputs) assert.ok(!text.includes(token), "the token was printed");
    assert.ok(!existsSync(join(ws.dir, ".af")), "nothing written to the workspace .af/");
  } finally {
    ws.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
