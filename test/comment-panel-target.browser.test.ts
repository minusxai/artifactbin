import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { Comment } from "../src/contracts.ts";
import type { CommentSelection } from "../src/browser/comment-panel-contracts.ts";

const warning = "Target is unavailable in this view. Open the saved context.";

test("comment target warning distinguishes whole-page selection from a missing node", async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { createCommentPanel } from './src/browser/comment-panel.ts';
        const comments = [];
        window.panel = createCommentPanel({
          layer: document.querySelector('#layer'),
          read: () => ({ comments, profiles: {}, sourceRevision: 'r', actor: 'viewer',
            snapshot: null, canComment: true, notice: '', canResolve: true, live: true }),
          geometry: () => ({ targets: [{ id: 'present', quote: '',
            rect: { x: 10, y: 10, width: 40, height: 30 } }], inset: 44, height: 800 }),
          actions: {
            post(body, selection, parentId) {
              comments.push({ id: 'posted', ...selection, body, parentId,
                publishedBy: 'viewer', createdAt: '2026-01-01', sourceRevision: 'r', appStateId: null });
              return 'posted';
            },
            resolve: async () => {}, reopen: async () => {},
            view: () => {}, finishSelection: () => {}, error: message => { throw Error(message); }
          }
        });
        window.sync = context => { if(context) comments[0].context = context; panel.render(); };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const cases: {
    label: string;
    selection: CommentSelection;
    context?: Comment["context"];
    warning: boolean;
  }[] = [
    {
      label: "whole page",
      selection: { nodeId: null, quote: "", snapshot: null },
      warning: false,
    },
    {
      label: "missing node",
      selection: { nodeId: "missing", quote: "Removed target", snapshot: null },
      warning: true,
    },
    {
      label: "present node",
      selection: { nodeId: "present", quote: "Target", snapshot: null },
      warning: false,
    },
    {
      label: "unavailable context",
      selection: { nodeId: "missing", quote: "Removed target", snapshot: null },
      context: {
        status: "unavailable",
        originalRevision: "r",
        reason: "not-retained",
      },
      warning: false,
    },
  ];
  const browser = await chromium.launch();
  try {
    for (const entry of cases) {
      const page = await browser.newPage();
      await page.setContent('<div id="layer"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate((selectionJson) => {
        (
          window as unknown as {
            panel: { open(selection: CommentSelection): void };
          }
        ).panel.open(JSON.parse(selectionJson) as CommentSelection);
      }, JSON.stringify(entry.selection));
      if (entry.selection.nodeId === null)
        assert.equal(
          await page.getByText("Whole page", { exact: true }).count(),
          1,
        );
      await page
        .getByRole("textbox", { name: "Comment text" })
        .fill("A page comment");
      await page.getByRole("button", { name: "Post comment" }).click();
      await page.getByRole("dialog", { name: "Comment thread" }).waitFor();
      await page.evaluate((context) => {
        (window as unknown as { sync(context: Comment["context"]): void }).sync(
          context,
        );
      }, entry.context);
      assert.equal(
        await page.getByText(warning, { exact: true }).count(),
        entry.warning ? 1 : 0,
        entry.label,
      );
      assert.equal(
        await page.getByRole("button", { name: "View context" }).count(),
        entry.context ? 0 : 1,
        entry.label,
      );
      assert.equal(
        await page.getByText("A page comment", { exact: true }).count(),
        1,
        entry.label,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
