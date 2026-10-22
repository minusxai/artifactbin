import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

test("comment Markdown builds safe DOM and preserves saved mention labels", async () => {
  const bundle = await build({
    entryPoints: ["src/comments/presentation.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "CommentBody",
    platform: "browser",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="body"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const result = await page.evaluate(() => {
      const module = (
        window as unknown as {
          CommentBody: {
            renderCommentBody(parent: HTMLElement, value: unknown): void;
          };
        }
      ).CommentBody;
      module.renderCommentBody(document.querySelector<HTMLElement>("#body")!, {
        body: "# Heading\n\n**bold** _emphasis_ `literal` <img src=x onerror=alert(1)>\n\n- first\n- second\n\n> quote\n\n[@saved](/people/known) [@unknown](/people/unknown) [session](/chat?session=0123456789012345678901234567890123456789012345678901234567890123) [safe](https://example.test/path) [bad](javascript:alert(1))",
        personLinks: [
          { legacyUserId: "known", href: "/@current_public" },
          { legacyUserId: "unknown", href: "https://wrong.test/private" },
        ],
      });
      return {
        text: document.querySelector("#body")!.textContent,
        links: [...document.querySelectorAll("a")].map((a) => ({
          href: a.getAttribute("href"),
          label: a.textContent,
          rel: a.rel,
        })),
        unsafe: document.querySelectorAll("#body img,#body script,#body iframe")
          .length,
        format: document.querySelectorAll(
          "strong,em,code,ul,blockquote,[role=heading]",
        ).length,
      };
    });
    assert.match(result.text!, /<img src=x onerror=alert\(1\)>/);
    assert.deepEqual(
      result.links.map((a) => [a.href, a.label]),
      [
        ["/@current_public", "@saved"],
        ["https://example.test/path", "safe"],
      ],
    );
    assert.ok(result.links.every((a) => a.rel === "noopener noreferrer"));
    assert.equal(result.unsafe, 0);
    assert.equal(result.format, 6);
  } finally {
    await browser.close();
  }
});
