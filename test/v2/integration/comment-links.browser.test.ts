import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer, page as sourcePage } from "../support/server.ts";

test("a comment link reads an older resolved reply and opens its saved context", async () => {
  const server = await startServer(),
    browser = await chromium.launch();
  try {
    const token = await server.token();
    const published = await (
      await server.request("/api/publish", {
        token,
        body: {
          source: sourcePage('<h1 id="marker">Original context</h1>'),
          requestId: "comment-link-browser",
          visibility: "public",
        },
      })
    ).json();
    const base = `/api/files/${published.id}`;
    const root = await (
      await server.request(base + "/comments", {
        token,
        body: {
          comment: {
            body: "Old resolved root",
            nodeId: null,
            quote: "",
            version: 1,
          },
        },
      })
    ).json();
    const reply = await (
      await server.request(base + "/comments", {
        token,
        body: {
          comment: {
            body: "Linked reply",
            nodeId: null,
            quote: "",
            parentId: root.id,
            version: 1,
          },
        },
      })
    ).json();
    await server.request(base + "/comments/" + root.id, {
      method: "PUT",
      token,
      headers: { "If-Match": "1" },
      body: { resolved: true },
    });
    for (let i = 0; i < 51; i++)
      await server.request(base + "/comments", {
        token,
        body: {
          comment: { body: "Recent " + i, nodeId: null, quote: "", version: 1 },
        },
      });
    await server.request(base + "/source", {
      method: "PUT",
      token,
      headers: { "If-Match": "1" },
      body: {
        source: published.source.replace("Original context", "Current head"),
      },
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const reads: string[] = [],
      errors: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/thread")) reads.push(r.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(published.url + "?comment=" + encodeURIComponent(reply.id));
    await page
      .locator(".pg-message")
      .filter({ hasText: "Linked reply" })
      .waitFor();
    await page
      .frameLocator("#pg-history")
      .locator("#marker")
      .filter({ hasText: "Original context" })
      .waitFor();
    assert.equal(
      await page
        .locator(".pg-message")
        .filter({ hasText: "Old resolved root" })
        .count(),
      1,
    );
    assert.equal(reads.length, 1);
    assert.ok(reads[0]!.includes(encodeURIComponent(reply.id)));
    assert.deepEqual(errors, []);
    await page.goto(published.url + "?thread=" + encodeURIComponent(root.id));
    await page
      .locator(".pg-message")
      .filter({ hasText: "Linked reply" })
      .waitFor();
    assert.equal(reads.length, 2);
  } finally {
    await browser.close();
    await server.close();
  }
});
