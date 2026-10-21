/**
 * Comments in a hosted page against the real server: a viewer comments on a
 * `data-af-id` node (from its context menu and in "Add comment" mode),
 * comments on the whole page, replies, resolves and reopens, and opens the
 * comment's saved context, which shows the page styled as the commenter saw
 * it; an agent reads the same comments and context over HTTP, and its own
 * comment shows up in the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, firefox, webkit, type BrowserType, type Frame, type Page } from "playwright";
import type {
  CommentsResponse,
  ContextResponse,
  PublishResponse,
} from "../../../src/server/af-api-contracts.ts";
import { page as pageSource, startServer, type TestServer } from "../support/server.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];
const SOURCE = pageSource(
  `<h1>Groceries</h1>
<p id="milk">Buy oat milk</p>
<p id="bread">Buy bread</p>`,
);

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 100 && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}
async function app(page: Page, marker = "#milk"): Promise<Frame> {
  await page.waitForSelector("html[data-pagegi-startup=ready]", { state: "attached" });
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const frame of page.frames()) if (await frame.$(marker).catch(() => null)) return frame;
    await page.waitForTimeout(100);
  }
  throw Error("page did not load");
}

for (const [name, engine] of engines) {
  test(`${name}: a viewer comments on a node, replies and opens its context; agents see the same over HTTP`, async () => {
    const server: TestServer = await startServer();
    const browser = await engine.launch();
    try {
      const token = await server.token("owner@example.test");
      const published = (await (
        await server.request("/api/publish", {
          token,
          body: { source: SOURCE, requestId: "comments-" + name, visibility: "public", linkRole: "commenter" },
        })
      ).json()) as PublishResponse;
      const nodeId = /<p id="milk" data-af-id="([^"]+)"/.exec(published.source)?.[1];
      assert.ok(nodeId, published.source);
      const comments = async () =>
        (await (await server.request(`/api/files/${published.id}/comments`, { token })).json()) as CommentsResponse;

      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(server.origin + "/");
      const login = await page.evaluate(async () => {
        const response = await fetch("/api/auth/test-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "owner@example.test", browserSession: true }),
        });
        return response.status;
      });
      assert.equal(login, 200);
      await page.goto(published.url);
      const frame = await app(page);

      // Comment on the node from its context menu.
      await frame.click("#milk", { button: "right" });
      await page.getByRole("menuitem", { name: "Add comment", exact: true }).click();
      await page.getByRole("textbox", { name: "Comment text" }).fill("Which brand?");
      await page.getByRole("button", { name: "Post comment", exact: true }).click();
      const posted = await eventually(comments, (value) => value.comments.length === 1);
      assert.equal(posted.comments.length, 1);
      const [comment] = posted.comments;
      assert.equal(comment!.nodeId, nodeId);
      assert.equal(comment!.body, "Which brand?");
      assert.equal(comment!.quote.trim(), "Buy oat milk");
      assert.equal(comment!.version, 1);
      assert.equal(comment!.author, "owner@example.test");

      // The thread stays open as the comment takes the server's ID; reply in it.
      await page.locator('.pg-message[data-sync="saved"]').waitFor();
      assert.equal(await page.getByText("Only in this file until synced").count(), 0);
      const replyBox = page.getByRole("textbox", { name: "Reply to comment" });
      if (!(await replyBox.count()))
        await page.getByRole("button", { name: "Reply", exact: true }).first().click();
      await replyBox.fill("The usual one");
      await page.getByRole("button", { name: "Reply", exact: true }).last().click();
      const replied = await eventually(comments, (value) => value.comments.length === 2);
      const reply = replied.comments.find((c) => c.body === "The usual one");
      assert.ok(reply, JSON.stringify(replied.comments));
      assert.equal(reply.parentId, comment!.id);

      // What the commenter saw, over HTTP.
      const context = (await (
        await server.request(`/api/files/${published.id}/context/${comment!.id}`, { token })
      ).json()) as ContextResponse;
      assert.equal(context.comment.id, comment!.id);
      assert.match(context.source, /Buy oat milk/);

      // And in the page: the saved context opens read-only, then returns.
      await page.getByRole("button", { name: "View context", exact: true }).click();
      const history = page.locator("#pg-history");
      await history.waitFor({ state: "visible" });
      const saved = page.frameLocator("#pg-history");
      await saved.getByText("Buy oat milk").waitFor();
      assert.equal(await saved.locator("script").count(), 0);
      await page.getByRole("button", { name: "Return", exact: true }).click();
      await history.waitFor({ state: "hidden" });

      // An agent's comment over HTTP reaches the open page.
      const agent = await server.token("agent@example.test");
      const shared = await server.request(`/api/files/${published.id}/comments`, {
        token: agent,
        body: { comment: { nodeId, quote: "Buy bread", body: "Agent note" } },
      });
      assert.equal(shared.status, 201);
      await page.getByRole("button", { name: "Open comment: Agent note", exact: true }).waitFor();

      // "Add comment" mode: a left click on a node opens the composer for it.
      const breadId = /<p id="bread" data-af-id="([^"]+)"/.exec(published.source)?.[1];
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("button", { name: "Add comment", exact: true }).click();
      await frame.click("#bread");
      await page.getByRole("textbox", { name: "Comment text" }).fill("Wholemeal");
      await page.getByRole("button", { name: "Post comment", exact: true }).click();
      const picked = await eventually(comments, (value) => value.comments.some((c) => c.body === "Wholemeal"));
      assert.equal(picked.comments.find((c) => c.body === "Wholemeal")!.nodeId, breadId);

      // A comment on the whole page, from the account menu.
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("button", { name: "Comment on page", exact: true }).click();
      await page.getByText("Whole page", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Comment text" }).fill("Reads well overall");
      await page.getByRole("button", { name: "Post comment", exact: true }).click();
      const whole = await eventually(comments, (value) => value.comments.some((c) => c.body === "Reads well overall"));
      assert.equal(whole.comments.find((c) => c.body === "Reads well overall")!.nodeId, null);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Open comment: Reads well overall", exact: true }).waitFor();

      // Resolve a thread, find it among the resolved ones and reopen it.
      await page.getByRole("button", { name: "Open comment: Which brand?", exact: true }).click();
      await page.getByRole("button", { name: "Resolve", exact: true }).click();
      await page.getByRole("button", { name: "Open comment: Which brand?", exact: true }).waitFor({ state: "detached" });
      await eventually(comments, (value) => value.comments.find((c) => c.id === comment!.id)?.resolved === true);
      await page.getByRole("button", { name: "Resolved (1)", exact: true }).click();
      await page.getByRole("button", { name: "Reopen comment: Which brand?", exact: true }).click();
      await page.getByRole("button", { name: "Open comment: Which brand?", exact: true }).waitFor();
      const reopened = await eventually(comments, (value) => value.comments.find((c) => c.id === comment!.id)?.resolved === false);
      assert.equal(reopened.comments.find((c) => c.id === comment!.id)!.resolved, false);
      assert.equal(await page.getByRole("button", { name: /^Resolved \(/ }).count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });
}

const TABS = pageSource(
  `<nav class="tabs"><button id="tab-summary" class="tab" aria-selected="true">Summary</button><button id="tab-notes" class="tab" aria-selected="false">Notes</button></nav>
<section id="summary" class="panel active"><h2 id="summary-heading">Summary</h2><p>All quiet.</p></section>
<section id="notes" class="panel"><h2 id="notes-heading">Field notes</h2><textarea id="draft"></textarea></section>
<script>
  for (const tab of document.querySelectorAll(".tab"))
    tab.onclick = () => {
      for (const other of document.querySelectorAll(".tab")) other.setAttribute("aria-selected", String(other === tab));
      for (const panel of document.querySelectorAll(".panel")) panel.classList.toggle("active", "tab-" + panel.id === tab.id);
    };
</script>`,
  `<style>
  body { background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
  .panel { padding: 12px; background: var(--card); }
  .panel:not(.active) { display: none; }
  .tab[aria-selected="true"] { border-bottom: 3px solid var(--primary); }
  #notes-heading { font-family: var(--font-display); letter-spacing: 0.2em; }
</style>`,
).replace("<html>", '<html data-af-design-system="dossier">');

for (const [name, engine] of engines) {
  test(`${name}: a comment's saved context shows the page styled as the commenter saw it, and hidden nodes get no marker`, async () => {
    const server: TestServer = await startServer();
    const browser = await engine.launch();
    try {
      const token = await server.token("owner@example.test");
      const published = (await (
        await server.request("/api/publish", {
          token,
          body: { source: TABS, requestId: "context-" + name, visibility: "public", linkRole: "commenter" },
        })
      ).json()) as PublishResponse;
      const idOf = (id: string) => new RegExp(`id="${id}"[^>]*data-af-id="([^"]+)"`).exec(published.source)?.[1];
      const agent = await server.token("agent@example.test");
      for (const [node, body] of [["summary-heading", "Visible note"], ["notes-heading", "Hidden note"]] as const)
        assert.equal(
          (
            await server.request(`/api/files/${published.id}/comments`, {
              token: agent,
              body: { comment: { nodeId: idOf(node), quote: "", body } },
            })
          ).status,
          201,
        );

      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /Content Security Policy/i.test(message.text())) errors.push(message.text());
      });
      await page.goto(server.origin + "/");
      await page.evaluate(() =>
        fetch("/api/auth/test-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "owner@example.test", browserSession: true }),
        }),
      );
      await page.goto(published.url);
      const frame = await app(page, "#notes-heading");

      // The Notes panel is hidden: its comment has no marker until the tab opens.
      await page.getByRole("button", { name: "Open comment: Visible note", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open comment: Hidden note", exact: true }).count(), 0);
      await frame.click("#tab-notes");
      await page.getByRole("button", { name: "Open comment: Hidden note", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open comment: Visible note", exact: true }).waitFor({ state: "detached" });

      // Comment on the Notes heading with a draft typed, then open the comment's context.
      await frame.fill("#draft", "context draft");
      await frame.click("#notes-heading", { button: "right" });
      await page.getByRole("menuitem", { name: "Add comment", exact: true }).click();
      await page.getByRole("textbox", { name: "Comment text" }).fill("Notes look right");
      await page.getByRole("button", { name: "Post comment", exact: true }).click();
      await page.locator('.pg-message[data-sync="saved"]').waitFor();
      const style = (el: Element) => {
        const heading = getComputedStyle(el);
        const doc = el.ownerDocument;
        return {
          font: heading.fontFamily,
          spacing: heading.letterSpacing,
          background: getComputedStyle(doc.body).backgroundColor,
          card: getComputedStyle(doc.querySelector("#notes")!).backgroundColor,
          summary: getComputedStyle(doc.querySelector("#summary")!).display,
          notes: getComputedStyle(doc.querySelector("#notes")!).display,
          selected: getComputedStyle(doc.querySelector("#tab-notes")!).borderBottomStyle,
          draft: (doc.querySelector("#draft") as HTMLTextAreaElement).value,
          designSystem: doc.documentElement.getAttribute("data-af-design-system"),
        };
      };
      const live = await frame.locator("#notes-heading").evaluate(style);
      assert.equal(live.summary, "none");
      assert.equal(live.draft, "context draft");
      await page.getByRole("button", { name: "View context", exact: true }).click();
      const history = page.frameLocator("#pg-history");
      await history.locator("#notes-heading").waitFor();
      let saved = await history.locator("#notes-heading").evaluate(style);
      for (const deadline = Date.now() + 5000; saved.background !== live.background && Date.now() < deadline; )
        saved = await history.locator("#notes-heading").evaluate(style);
      assert.deepEqual(saved, live, "the saved view is styled like the live page the commenter saw");
      assert.equal(await history.locator("script").count(), 0);
      await page.getByRole("button", { name: "Return", exact: true }).click();
      await page.locator("#pg-history").waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });
}
