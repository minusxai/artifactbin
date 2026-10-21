/**
 * The skill's todo example, published with its backend and opened by three
 * signed-in viewers and an anonymous one, none of whom approves anything: the
 * list is shared through the backend's store (concurrent adds both survive),
 * while each viewer's filter
 * and draft stay their own. Needs Postgres, Chromium and the Docker backend
 * image (`npm run build:backend`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import type { BackendsResponse } from "../../../src/backend/af-backend-contracts.ts";
import { publishTodo } from "../support/todo.ts";
import { startServer, type TestServer } from "../support/server.ts";

async function open(browser: Browser, server: TestServer, url: string, email: string | null): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  if (email) {
    await page.goto(server.origin + "/");
    const status = await page.evaluate(async (address) => {
      const response = await fetch("/api/auth/test-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, browserSession: true }),
      });
      return response.status;
    }, email);
    assert.equal(status, 200);
  }
  await page.goto(url);
  return page;
}

/** The frame the page's own HTML runs in (never the platform origin). */
async function app(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 200; attempt++) {
    for (const frame of page.frames()) if (await frame.$("#list").catch(() => null)) return frame;
    await page.waitForTimeout(100);
  }
  throw Error("todo page did not load");
}
const items = (frame: Frame) => frame.locator("#list li span").allTextContents();
async function eventually(read: () => Promise<string[]>, expected: string[]) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (JSON.stringify((await read()).sort()) === JSON.stringify([...expected].sort())) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual((await read()).sort(), [...expected].sort());
}
const submit = (frame: Frame, text: string) =>
  frame.evaluate((value) => {
    const input = document.querySelector("#text") as HTMLInputElement;
    input.value = value;
    (document.querySelector("#new") as HTMLFormElement).requestSubmit();
  }, text);

test("viewers share the todo list through its backend's store and keep their own filters", async () => {
  const server = await startServer({ backendHost: createBackendHost({}) });
  const browser = await chromium.launch();
  try {
    const owner = await server.token("owner@example.test");
    const published = await publishTodo(server, owner, { requestId: "shared-todo", visibility: "unlisted", linkRole: "viewer" });
    const sharing = (await (await server.request(`/api/files/${published.id}/sharing`, { token: owner })).json()) as {
      policy: { version: number };
    };
    const shared = await server.request(`/api/files/${published.id}/sharing`, {
      method: "PUT",
      token: owner,
      body: { email: "editor@example.test", role: "editor" },
      headers: { "If-Match": String(sharing.policy.version) },
    });
    assert.equal(shared.status, 200);
    // Signed-in viewers approve nothing: the page's backends run for everyone who can open it.
    const editor = await server.token("editor@example.test");
    const listed = (await (await server.request(`/api/files/${published.id}/backends`, { token: editor })).json()) as BackendsResponse;
    assert.deepEqual(Object.keys(listed.backends[0]!).sort(), ["id", "name", "typeDefs", "version"]);
    const approve = await server.request(`/api/files/${published.id}/backends/approve`, { token: editor, body: { versions: [] } });
    assert.equal(approve.status, 404, "there is no approval route");

    const first = await open(browser, server, published.url, "owner@example.test");
    const second = await open(browser, server, published.url, "editor@example.test");
    const errors: string[] = [];
    for (const page of [first, second]) page.on("pageerror", (error) => errors.push(error.message));
    const a = await app(first);
    const b = await app(second);
    assert.notEqual(await a.evaluate(() => location.origin), server.origin, "page scripts never run on the platform origin");

    // Shared data: one viewer's add reaches the other, and concurrent adds both survive.
    await submit(a, "Alpha");
    await eventually(() => items(b), ["Alpha"]);
    await Promise.all([submit(a, "From A"), submit(b, "From B")]);
    await eventually(() => items(a), ["Alpha", "From A", "From B"]);
    await eventually(() => items(b), ["Alpha", "From A", "From B"]);

    // A signed-in link viewer, never shared with by email, sees and adds to the list at once,
    // and Page settings offers no backend access to request.
    const reader = await open(browser, server, published.url, "reader@example.test");
    reader.on("pageerror", (error) => errors.push(error.message));
    const r = await app(reader);
    await eventually(() => items(r), ["Alpha", "From A", "From B"]);
    await reader.locator("#pg-settings").click();
    await reader.getByRole("button", { name: "Download HTML" }).waitFor();
    assert.equal(await reader.getByRole("button", { name: "Request backend access" }).count(), 0);
    assert.doesNotMatch((await reader.locator("#pg-status").textContent()) ?? "", /approval/i);
    await reader.keyboard.press("Escape");
    await submit(r, "Reader task");
    await eventually(() => items(a), ["Alpha", "From A", "From B", "Reader task"]);
    await r.locator("#list li", { hasText: "Reader task" }).getByRole("button", { name: "Remove" }).click();
    await r.getByText("Only editors can do that.").waitFor();
    await b.locator("#list li", { hasText: "Reader task" }).getByRole("button", { name: "Remove" }).click();
    await eventually(() => items(b), ["Alpha", "From A", "From B"]);
    await reader.close();

    // Local state: a filter is one viewer's own and survives a reload.
    await a.locator("#list li", { hasText: "Alpha" }).locator("input[type=checkbox]").check();
    await a.click('#filters button[data-filter="done"]');
    await eventually(() => items(a), ["Alpha"]);
    await eventually(() => items(b), ["Alpha", "From A", "From B"]);
    await first.reload();
    const again = await app(first);
    await again.locator('#filters button[data-filter="done"][aria-pressed="true"]').waitFor();
    await eventually(() => items(again), ["Alpha"]);

    // An anonymous viewer with the link reads and adds through the same store; removing needs an editor.
    const guest = await open(browser, server, published.url, null);
    const g = await app(guest);
    await eventually(() => items(g), ["Alpha", "From A", "From B"]);
    await submit(g, "Guest task");
    await eventually(() => items(b), ["Alpha", "From A", "From B", "Guest task"]);
    await g.locator("#list li", { hasText: "From A" }).getByRole("button", { name: "Remove" }).click();
    await g.getByText("Only editors can do that.").waitFor();
    await b.locator("#list li", { hasText: "From A" }).getByRole("button", { name: "Remove" }).click();
    await eventually(() => items(b), ["Alpha", "From B", "Guest task"]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
