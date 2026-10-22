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
        body: "# Heading\n\n**bold** _emphasis_ `literal` <img src=x onerror=alert(1)>\n\n- first\n- second\n\n> quote\n\n[@saved](/people/known) [@unknown](/people/unknown) [session](/chat?session=0123456789012345678901234567890123456789012345678901234567890123) [safe](https://example.test/path) [bad](javascript:alert(1)) [mail](mailto:reader@example.test)",
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
          target: a.target,
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
        ["mailto:reader@example.test", "mail"],
      ],
    );
    assert.equal(result.links[0]?.target, "");
    assert.equal(result.links[1]?.target, "_blank");
    assert.equal(result.links[1]?.rel, "noopener noreferrer");
    assert.equal(result.links[2]?.target, "");
    assert.equal(result.unsafe, 0);
    assert.equal(result.format, 6);
  } finally {
    await browser.close();
  }
});

test("collapsed comments show one plain preview and expanded Markdown stays readable at narrow and desktop widths", async () => {
  const { readFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const body =
    "# Heading\n\n**bold** and _emphasis_ with `inline code`.\n\n- First item\n- Second item\n\n> Quoted text\n\n```\n" +
    "long_code_".repeat(35) +
    "\n```\n\n[website](https://example.test)";
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
 import {createCommentPanel} from './src/browser/comment-panel.ts';
 const body=${JSON.stringify(body)};
 window.panel=createCommentPanel({layer:document.querySelector('#layer'),read:()=>({comments:[{id:'note',nodeId:'anchor',quote:'',body,sourceRevision:'r',parentId:null,publishedBy:'reader',createdAt:'2026-01-01',appStateId:null},{id:'reply',nodeId:'anchor',quote:'',body:'**Reply**',sourceRevision:'r',parentId:'note',publishedBy:'reader',createdAt:'2026-01-01',appStateId:null}],profiles:{},sourceRevision:'r',actor:'reader',snapshot:null,canComment:false,canResolve:false,notice:'',live:true}),geometry:()=>({targets:[{id:'anchor',quote:'',rect:{x:0,y:10,width:20,height:20}}],inset:44,height:900}),actions:{post(){throw Error('Read only')},resolve:async()=>{},reopen:async()=>{},view(){},finishSelection(){},error(message){throw Error(message)}}});panel.render();`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const styles = await Promise.all(
    ["chrome.css", "style.css"].map((name) =>
      readFile(new URL("../src/browser/" + name, import.meta.url), "utf8"),
    ),
  );
  const browser = await chromium.launch();
  try {
    for (const width of [320, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<div id="layer"></div>');
      await page.addStyleTag({ content: styles.join("\n") });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const marker = page.locator(".pg-pin");
      await marker.hover();
      await page.locator('.pg-bubble[data-expanded="false"]').waitFor();
      assert.equal(await page.locator(".pg-message").count(), 1);
      assert.equal(await page.locator(".pg-comment-body").count(), 0);
      const preview = page.locator(".pg-message > p");
      assert.match(
        (await preview.textContent())!,
        /Heading\nbold and emphasis with inline code/,
      );
      assert.equal(
        await preview.evaluate(
          (element) => getComputedStyle(element).webkitLineClamp,
        ),
        "2",
      );
      assert.equal(
        await page
          .locator(".pg-message strong,.pg-message [role=heading]")
          .count(),
        0,
      );
      await marker.click();
      await page.locator('.pg-bubble[data-expanded="true"]').waitFor();
      const actual = await page
        .locator(".pg-comment-body")
        .first()
        .evaluate((element) => {
          const heading = element.querySelector("[role=heading]")!,
            list = element.querySelector("ul")!,
            quote = element.querySelector("blockquote")!,
            code = element.querySelector("code")!,
            pre = element.querySelector("pre")!;
          return {
            heading: getComputedStyle(heading).fontSize,
            list: getComputedStyle(list).paddingLeft,
            quoteBorder: getComputedStyle(quote).borderLeftWidth,
            quoteMargin: getComputedStyle(quote).marginLeft,
            codeSize: getComputedStyle(code).fontSize,
            codeFont: getComputedStyle(code).fontFamily,
            codeBackground: getComputedStyle(code).backgroundColor,
            preOverflow: getComputedStyle(pre).overflowX,
            preScrolls: pre.scrollWidth > pre.clientWidth,
            fits: element.scrollWidth <= element.clientWidth + 1,
          };
        });
      assert.deepEqual(
        {
          heading: actual.heading,
          list: actual.list,
          quoteBorder: actual.quoteBorder,
          quoteMargin: actual.quoteMargin,
          codeSize: actual.codeSize,
          preOverflow: actual.preOverflow,
        },
        {
          heading: "18px",
          list: "20px",
          quoteBorder: "2px",
          quoteMargin: "0px",
          codeSize: "12px",
          preOverflow: "auto",
        },
      );
      assert.match(actual.codeFont, /monospace/);
      assert.notEqual(actual.codeBackground, "rgba(0, 0, 0, 0)");
      assert.equal(actual.preScrolls, true);
      assert.equal(actual.fits, true);
      assert.equal(
        await page.locator(".pg-comment-body strong").first().textContent(),
        "bold",
      );
      if (process.env.COMMENT_MARKDOWN_SCREENSHOT_DIR) {
        await mkdir(process.env.COMMENT_MARKDOWN_SCREENSHOT_DIR, {
          recursive: true,
        });
        await page.screenshot({
          path: join(
            process.env.COMMENT_MARKDOWN_SCREENSHOT_DIR,
            `comment-markdown-${width}.png`,
          ),
        });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
