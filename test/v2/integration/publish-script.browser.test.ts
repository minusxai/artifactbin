/**
 * Integration: the todo example published with its backend and then saved by
 * publish.mjs still loads in a browser with the viewer's own local state: the
 * save changes the source, not the viewer's data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Frame, type Page } from "playwright";
import type { PublishJson } from "../../../src/af-script/lifecycle-contracts.ts";
import { repositoryPath } from "../support/load.ts";
import { startServer } from "../support/server.ts";
import { compileOnlyHost, todoExample } from "../support/todo.ts";

function add(root: string, file: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts", "add.mjs"), file], {
      cwd: join(root, "work"),
      env: { PATH: process.env.PATH ?? "", HOME: join(root, "home"), ...env },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(stdout.trim().split(/\s+/).at(-1)!));
  });
}

function publish(root: string, args: string[], env: Record<string, string>): Promise<PublishJson> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts", "publish.mjs"), "page.html", "--json", ...args], {
      cwd: join(root, "work"),
      env: { PATH: process.env.PATH ?? "", HOME: join(root, "home"), ...env },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(JSON.parse(stdout) as PublishJson));
  });
}

async function app(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const frame of page.frames()) if (await frame.$("#list").catch(() => null)) return frame;
    await page.waitForTimeout(100);
  }
  throw Error("todo page did not load");
}
async function eventually<T>(read: () => Promise<T>, expected: T) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (JSON.stringify(await read()) === JSON.stringify(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(await read(), expected);
}

test("chromium: a page saved by publish.mjs loads with the viewer's same state and the new source", async () => {
  // Backends compile but never run here: only viewer-local state persists; shared rows remain unavailable.
  const server = await startServer({ backendHost: compileOnlyHost() });
  const browser = await chromium.launch();
  const root = mkdtempSync(join(tmpdir(), "af-publish-browser-"));
  try {
    cpSync(repositoryPath("skills/pagegi-author/scripts"), join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "work"));
    mkdirSync(join(root, "home"));
    const env = { AF_SERVER: server.origin, AF_TOKEN: await server.token("owner@example.test") };
    const file = join(root, "work", "page.html");
    mkdirSync(join(root, "work", "backends"));
    // The file exists before it gets an ID: add.mjs refuses a path that is not there.
    writeFileSync(join(root, "work", "backends", "todos.ts"), "");
    const backendId = await add(root, "backends/todos.ts", env);
    const example = todoExample(backendId);
    writeFileSync(join(root, "work", "backends", "todos.ts"), example.backend);
    const seeded = `<script type="application/json" data-af="state">{"todos":[{"id":"1","text":"Seeded","done":false}]}</script>\n</head>`;
    writeFileSync(file, example.page.replace("</head>", seeded));
    const created = await publish(root, [], env);
    assert.equal(created.status, "created", created.message);

    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.origin + "/");
    assert.equal(
      await page.evaluate(async () => (await fetch("/api/auth/test-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", browserSession: true }) })).status),
      200,
    );
    await page.goto(created.url!);
    let frame = await app(page);
    await frame.getByText("Shared list unavailable. Connect or check your access.").waitFor();
    assert.deepEqual(await frame.locator("#list li span").allTextContents(), [], "local seed rows never substitute for authoritative shared data");
    await frame.fill("#text", "Alpha");
    await frame.click('#filters button[data-filter="done"]');
    await eventually(() => frame.locator("#list li span").allTextContents(), []);

    writeFileSync(file, readFileSync(file, "utf8").replace(">Team todo list<", ">Saved by the script<"));
    const saved = await publish(root, [], env);
    assert.equal(saved.status, "saved", saved.message);
    assert.equal(saved.version, 2);

    await page.reload();
    frame = await app(page);
    await eventually(() => frame.locator("h1").textContent(), "Saved by the script");
    await eventually(() => frame.locator('#filters button[aria-pressed="true"]').textContent(), "Done");
    assert.equal(await frame.inputValue("#text"), "Alpha");
    await frame.click('#filters button[data-filter="all"]');
    await frame.getByText("Shared list unavailable. Connect or check your access.").waitFor();
    assert.deepEqual(await frame.locator("#list li span").allTextContents(), [], "local seed rows never substitute for authoritative shared data");
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    await browser.close();
    await server.close();
  }
});
