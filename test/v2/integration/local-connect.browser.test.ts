/**
 * A downloaded page opened from disk while its server is reachable: it shows
 * the platform bar like the hosted view, reads the page's comments, connects
 * through the viewer's website sign-in (in a window on the server, never in
 * the file), and then comments, shares presence and calls backends as the
 * hosted view does. The file carries no credential and says when the server
 * has a newer version.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type BrowserContext, type BrowserType } from "playwright";
import type { CommentsResponse, PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { compileOnlyHost, publishTodo } from "../support/todo.ts";
import { startServer, type TestServer } from "../support/server.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 100 && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}
/** Sign this browser context in on the website, the way a person who uses the server already is. */
async function signIn(context: BrowserContext, server: TestServer, email: string): Promise<void> {
  const page = await context.newPage();
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
  await page.close();
}

for (const [name, engine] of engines) {
  test(`${name}: a downloaded file shows the platform bar, connects with the website sign-in and works like the hosted view`, async () => {
    const server = await startServer({ backendHost: compileOnlyHost() });
    const browser = await engine.launch();
    const dir = mkdtempSync(join(tmpdir(), "af-connect-"));
    try {
      const owner = await server.token("owner@example.test");
      const published: PublishResponse = await publishTodo(server, owner, { requestId: "connect-" + name, linkRole: "commenter" });
      const nodeId = /<h1 data-af-id="([^"]+)">/.exec(published.source)?.[1];
      assert.ok(nodeId, published.source);
      const comments = async () =>
        (await (await server.request(`/api/files/${published.id}/comments`, { token: owner })).json()) as CommentsResponse;
      // An agent comments before anyone opens the file.
      const agent = await server.token("agent@example.test");
      const noted = await server.request(`/api/files/${published.id}/comments`, {
        token: agent,
        body: { comment: { nodeId, quote: "Team todo list", body: "Agent note" } },
      });
      assert.equal(noted.status, 201);

      const download = await server.request(`/af/v1/ids/${published.id}?download=1`, { token: owner });
      assert.equal(download.status, 200);
      const html = await download.text();
      assert.ok(!html.includes(owner) && !html.includes(agent), "no account token enters the file");
      assert.match(html, new RegExp(`<script data-af="core" data-af-server="${server.origin}" data-af-revision="[0-9a-f]{64}">`));
      assert.match(html, /"version": 1|"version":1/);
      const file = join(dir, "todo.html");
      writeFileSync(file, html);

      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await signIn(context, server, "owner@example.test");
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(file).href);

      // The platform bar, as in the hosted view: brand, Documents, status, settings, account menu, Connect.
      const bar = page.locator("nav#pg-bar");
      await bar.waitFor();
      await bar.getByText("Pagegi", { exact: true }).waitFor();
      await bar.getByRole("button", { name: "Documents", exact: true }).waitFor();
      await bar.getByRole("button", { name: "Connect", exact: true }).waitFor();
      await page.locator("#pg-status").filter({ hasText: "Local file" }).waitFor();
      assert.equal(await page.locator("af-download").count(), 0, "the bar replaces the file's own download control");
      await page.locator("#list li span", { hasText: "Milk" }).waitFor().catch(() => {});

      // Page settings: light/dark and the design-system picker drive the page's appearance.
      await page.getByRole("button", { name: "Page settings" }).click();
      await page.getByRole("button", { name: "Dark mode" }).click();
      await page.locator('html[data-af-dark="true"]').waitFor({ state: "attached" });
      await page.getByLabel("Design system").selectOption("riso");
      await page.locator('html[data-af-design-system="riso"]').waitFor({ state: "attached" });
      assert.equal(
        await page.locator('link[data-af="design-system"]').getAttribute("href"),
        `${server.origin}/af/v1/design-systems/riso.css`,
        "a switched design system loads from the file's own server",
      );
      await page.getByRole("button", { name: "Light mode" }).click();
      await page.locator("html:not([data-af-dark])").waitFor({ state: "attached" });
      await page.keyboard.press("Escape");

      // Comments are read before signing in, as a visitor of the hosted view reads them.
      await page.getByRole("button", { name: "Open comment: Agent note", exact: true }).waitFor();

      // Connect: the approval opens in a window on the server, which already knows this browser.
      const popup = page.waitForEvent("popup");
      await bar.getByRole("button", { name: "Connect", exact: true }).click();
      const approval = await popup;
      await approval.waitForURL(server.origin + "/connect?**");
      await approval.getByText("Signed in as owner@example.test").waitFor();
      await approval.getByRole("button", { name: "Approve connection", exact: true }).click();
      await approval.getByText("Connected.").waitFor();
      await bar.getByRole("button", { name: "Connect", exact: true }).waitFor({ state: "hidden" });
      await page.locator("#pg-status").filter({ hasText: "Connected" }).waitFor();
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByText("Connected as owner@example.test").waitFor();
      await page.keyboard.press("Escape");

      // A comment from the file lands on the server as the owner, on the file's version.
      const addComment = page.getByRole("menuitem", { name: "Add comment", exact: true });
      for (let attempt = 0; attempt < 3 && !(await addComment.isVisible()); attempt++) {
        await page.locator("h1").click({ button: "right" });
        await addComment.waitFor({ timeout: 5000 }).catch(() => {});
      }
      await addComment.click();
      await page.getByRole("textbox", { name: "Comment text" }).fill("From my copy");
      await page.getByRole("button", { name: "Post comment", exact: true }).click();
      const posted = await eventually(comments, (value) => value.comments.length === 2);
      const mine = posted.comments.find((c) => c.body === "From my copy");
      assert.ok(mine, JSON.stringify(posted.comments));
      assert.equal(mine.author, "owner@example.test");
      assert.equal(mine.nodeId, nodeId);
      assert.equal(mine.version, 1);

      // A hosted viewer sees the local viewer here.
      const other = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await signIn(other, server, "bob@example.test");
      const hosted = await other.newPage();
      hosted.setDefaultTimeout(15000);
      await hosted.goto(published.url);
      await hosted.waitForSelector("html[data-pagegi-startup=ready]", { state: "attached" });
      await hosted.getByRole("button", { name: "View owner@example.test's snapshot" }).waitFor();
      await page.getByRole("button", { name: "View bob@example.test's snapshot" }).waitFor();
      await other.close();

      // A backend call from the connected file reaches the server with the viewer's grant.
      const called = page.waitForRequest((request) => request.url().includes(`/api/files/${published.id}/graphql`));
      const outcome = await page.evaluate(async () => {
        // The page's own import map resolves the module, as the page's scripts do.
        const { gql, client } = await import(/* @vite-ignore */ "@afbin/apollo" as string);
        const result = await client.mutate({ mutation: gql`mutation { team { add(text: "x") { id } } }` });
        return result.extensions?.outcomes?.["team.add"] ?? "none";
      });
      const request = await called;
      assert.equal(request.method(), "POST");
      assert.notEqual(outcome, "offline");

      // The server moves on: the file says so when it is opened again.
      const saved = await server.request(`/api/files/${published.id}/source`, {
        method: "PUT",
        token: owner,
        body: { source: published.source.replace("Team todo list</h1>", "Team list</h1>") },
        headers: { "If-Match": "1" },
      });
      assert.equal(saved.status, 200);
      // Live: the open file hears about the save and names both versions.
      await page.locator("#pg-status").filter({ hasText: /newer version/i }).waitFor();
      await page.locator("#pg-status").filter({ hasText: "2" }).waitFor();
      await page.reload();
      await page.locator("nav#pg-bar").waitFor();
      await page.locator("#pg-status").filter({ hasText: /newer version/i }).waitFor();
      await page.locator("#pg-status").filter({ hasText: "2" }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
