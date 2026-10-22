import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// DOM adapter test against the module itself: no platform, HTTP server or app runtime.
test("comment panel owns composition, permission refresh, thread lifecycle and safe rendering", async (t) => {
  const bundle = await build({
    stdin: {
      contents: `
    import { createCommentPanel } from './src/browser/comment-panel.ts';
    import { drawCursorLayer } from './src/browser/cursor-layer.ts';
    window.drawCursorLayer = drawCursorLayer;
    const state = window.state = { comments: [], profiles: {}, sourceRevision: 'r', actor: 'alice', snapshot: null, canComment: true, notice: 'Read only', canResolve: true };
    window.calls = []; window.rejectPost = false; window.rejectResolve = false;
    window.panel = createCommentPanel({ layer: document.querySelector('#layer'), read: () => state,
      geometry: () => ({ targets: [{ id: 'a', quote: '', rect: { x: 10, y: 10, width: 40, height: 30 } }], inset: 44, height: 800 }),
      actions: {
        post(body, selection, parentId) {
          if (window.rejectPost) throw Error('Post failed');
          const id = String(state.comments.length + 1);
          state.comments.push({ id, ...selection, body, parentId, publishedBy: 'alice', createdAt: '2026-01-01T12:00:00Z', sourceRevision: 'r', appStateId: null });
          window.calls.push({ kind: 'post', body, selection, parentId }); return id;
        },
        async resolve(comment) { if (window.rejectResolve) throw Error('Resolve failed'); window.calls.push({kind: 'resolve', id: comment.id}); comment.resolved = true; },
        view(comment) { window.calls.push({kind:'view', id: comment.id}); },
        finishSelection() {}, error(message) { window.calls.push({kind:'error', message}); }
      }
    });
    window.openComposer = () => panel.open({nodeId:'a', quote:'<b>quote</b>', snapshot: null});
  `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="layer"></div><button id="outside">Outside</button>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await t.test(
      "blank submission disabled; draft survives close/reopen and failed post",
      async () => {
        await page.evaluate(() => openComposer());
        const input = page.getByRole("textbox", { name: "Comment text" }),
          post = page.getByRole("button", { name: "Post comment" });
        assert.equal(await post.isDisabled(), true);
        assert.equal(
          await page.locator(".pg-quote").textContent(),
          "<b>quote</b>",
        );
        assert.equal(await page.locator(".pg-quote b").count(), 0);
        await input.fill("  ");
        assert.equal(await post.isDisabled(), true);
        await input.fill("Keep this draft");
        await page.evaluate(() => {
          panel.close();
          openComposer();
          rejectPost = true;
        });
        assert.equal(await input.inputValue(), "Keep this draft");
        await post.click();
        await page.waitForFunction(() =>
          calls.some((c) => c.message === "Post failed"),
        );
        assert.equal(await input.inputValue(), "Keep this draft");
        await page.evaluate(() => {
          rejectPost = false;
        });
      },
    );
    await t.test(
      "permissions refresh an existing bubble and denied submission retains draft",
      async () => {
        await page.evaluate(() => {
          state.canComment = false;
          panel.render();
        });
        assert.equal(
          await page.getByRole("button", { name: "Post comment" }).isDisabled(),
          true,
        );
        await page.evaluate(() => {
          state.canComment = true;
          panel.render();
        });
        assert.equal(
          await page.getByRole("textbox").inputValue(),
          "Keep this draft",
        );
        await page.getByRole("button", { name: "Post comment" }).click();
        await page.waitForFunction(() => calls.some((c) => c.kind === "post"));
        assert.equal(
          await page.evaluate(() => Object.keys(panel.drafts).length),
          0,
        );
        assert.equal(
          await page.getByRole("dialog", { name: "Comment thread" }).count(),
          1,
        );
      },
    );
    await t.test(
      "reply drafts survive outside dismissal; errors retain thread; successful resolve closes",
      async () => {
        const reply = page.getByRole("textbox", { name: "Reply to comment" });
        await reply.fill("reply draft");
        await page.evaluate(() =>
          panel.dismissOutside(document.querySelector("#outside")),
        );
        assert.equal(await reply.inputValue(), "reply draft");
        await page.getByRole("button", { name: "View context" }).click();
        await page.waitForFunction(() => calls.some((c) => c.kind === "view"));
        await page.getByRole("button", { name: "Reply", exact: true }).click();
        await page.waitForFunction(
          () => calls.filter((c) => c.kind === "post").length === 2,
        );
        assert.equal(
          await page.evaluate(
            () => calls.filter((c) => c.kind === "post")[1].parentId,
          ),
          "1",
        );
        assert.equal(
          await page
            .getByLabel("Thread replies")
            .textContent()
            .then((v) => v.includes("reply draft")),
          true,
        );
        await page.evaluate(() => {
          rejectResolve = true;
        });
        await page
          .getByRole("button", { name: "Resolve", exact: true })
          .click();
        await page.waitForFunction(() =>
          calls.some((c) => c.message === "Resolve failed"),
        );
        assert.equal(await page.getByRole("dialog").count(), 1);
        await page.evaluate(() => {
          rejectResolve = false;
        });
        await page
          .getByRole("button", { name: "Resolve", exact: true })
          .click();
        await page.waitForFunction(() =>
          calls.some((c) => c.kind === "resolve"),
        );
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(await page.locator(".pg-pin").count(), 0);
        await page.evaluate(() => panel.dispose());
        assert.equal(await page.locator("#layer").textContent(), "");
        await page.evaluate(() => {
          openComposer();
          panel.render();
        });
        assert.equal(
          await page.locator("#layer").textContent(),
          "",
          "disposed panels remain inert",
        );
      },
    );
    await t.test(
      "cursor adapter replaces paint and hides disabled presence without interpreting actor HTML",
      async () => {
        const result = await page.evaluate(() => {
          const layer = document.createElement("div");
          document.body.append(layer);
          drawCursorLayer(layer, {
            viewers: [
              {
                actor: "<b>other</b>",
                sessionId: "other",
                sourceRevision: "r",
                shareView: false,
                cursor: { nodeId: "a", x: 0, y: 0 },
              },
            ],
            actor: null,
            sessionId: "own",
            sourceRevision: "r",
            targets: [
              {
                id: "a",
                quote: "",
                rect: { x: 12, y: 15, width: 20, height: 20 },
              },
            ],
            width: 800,
            inset: 44,
          });
          const painted = {
            text: layer.textContent,
            htmlNodes: layer.querySelectorAll("b").length,
            left: layer.firstElementChild.style.left,
            top: layer.firstElementChild.style.top,
          };
          drawCursorLayer(layer, null);
          return { ...painted, cleared: layer.childElementCount };
        });
        assert.deepEqual(result, {
          text: "↖ <b>other</b>",
          htmlNodes: 0,
          left: "12px",
          top: "59px",
          cleared: 0,
        });
      },
    );
    await t.test("unavailable historical context is labeled without a replay action or node highlight", async () => {
      const historical = await browser.newPage();
      await historical.setContent('<div id="layer"></div>');
      await historical.addScriptTag({ content: bundle.outputFiles[0].text });
      await historical.evaluate(() => {
        state.comments.push({ id: "legacy", nodeId: null, quote: "Original quote", body: "Original body", parentId: null,
          publishedBy: "alice", createdAt: "2025-01-01", sourceRevision: null, appStateId: null,
          context: { status: "unavailable", originalRevision: "17", reason: "not-retained" } });
        panel.render();
      });
      await historical.locator(".pg-pin").click();
      await historical.getByText("Original context unavailable", { exact: true }).waitFor();
      assert.equal(await historical.getByRole("button", { name: "View context" }).count(), 0);
      assert.equal(await historical.locator(".pg-comment-target").count(), 0);
      assert.equal(await historical.getByText("Original body", { exact: true }).count(), 1);
      await historical.close();
    });
  } finally {
    await browser.close();
  }
});
