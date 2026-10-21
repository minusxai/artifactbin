/**
 * Integration (briefs B + D): the agent workflow the skill describes, with
 * AF_SERVER and AF_TOKEN from a test harness. Green after B and D merge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishResponse, SaveResponse } from "../../../src/server/af-api-contracts.ts";
import { repositoryPath } from "../support/load.ts";
import { startServer } from "../support/server.ts";
import { compileOnlyHost, todoExample } from "../support/todo.ts";

function af(script: "add" | "check", args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [repositoryPath(`skills/pagegi-author/scripts/${script}.mjs`), ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: cwd, ...env },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("an agent reserves an ID, checks, publishes, adopts the saved source and resolves a conflict", async () => {
  const server = await startServer({ backendHost: compileOnlyHost() });
  const dir = mkdtempSync(join(tmpdir(), "af-agent-"));
  try {
    const env = { AF_SERVER: server.origin, AF_TOKEN: await server.token("agent@example.test") };
    // The files exist before they get IDs: add.mjs refuses a path that is not there.
    const file = join(dir, "page.html");
    writeFileSync(file, "<!DOCTYPE html>\n");
    writeFileSync(join(dir, "todos.ts"), "");
    const added = await af("add", ["page.html", "todos.ts"], dir, env);
    assert.equal(added.code, 0, added.stderr);
    const [id, backendId] = added.stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).at(-1)!);
    const example = todoExample(backendId!);
    writeFileSync(
      file,
      example.page.replace('{ "name": "Team todo list" }', `{ "name": "Team todo list", "id": "${id}" }`),
    );
    writeFileSync(join(dir, "todos.ts"), example.backend);
    assert.equal((await af("check", ["page.html"], dir, env)).code, 0);

    const published = (await (
      await server.request("/api/publish", {
        token: env.AF_TOKEN,
        body: { source: readFileSync(file, "utf8"), files: { [backendId!]: example.backend }, requestId: "agent-loop" },
      })
    ).json()) as PublishResponse;
    assert.equal(published.id, id);
    writeFileSync(file, published.source);
    const ids = await af("check", ["page.html", "--write-ids", "--json"], dir, env);
    assert.deepEqual(JSON.parse(ids.stdout).ids.changes, [], "local IDs match the platform's");
    assert.equal((await af("check", ["page.html"], dir, env)).code, 0);

    // Someone else saves first; the agent's save is refused, it refetches and re-applies.
    const other = await server.request(`/api/files/${id}/source`, {
      method: "PUT",
      token: env.AF_TOKEN,
      body: { source: published.source.replace("<h1", '<p class="note">Edited elsewhere</p>\n  <h1') },
      headers: { "If-Match": "1" },
    });
    assert.equal(other.status, 200);
    const mine = readFileSync(file, "utf8").replace("Team todo list</h1>", "Team todos</h1>");
    const refused = await server.request(`/api/files/${id}/source`, {
      method: "PUT",
      token: env.AF_TOKEN,
      body: { source: mine },
      headers: { "If-Match": "1" },
    });
    assert.equal(refused.status, 409);
    const latest = (await (await server.request(`/api/files/${id}/source`, { token: env.AF_TOKEN })).json()) as { source: string; version: number };
    const retried = await server.request(`/api/files/${id}/source`, {
      method: "PUT",
      token: env.AF_TOKEN,
      body: { source: latest.source.replace("Team todo list</h1>", "Team todos</h1>") },
      headers: { "If-Match": String(latest.version) },
    });
    assert.equal(retried.status, 200);
    const saved = (await retried.json()) as SaveResponse;
    assert.match(saved.source, /Edited elsewhere/);
    assert.match(saved.source, /Team todos<\/h1>/);
    assert.equal(saved.version, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await server.close();
  }
});
