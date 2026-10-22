import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { startServer, page as source } from "./v2/support/server.ts";
test("hosted trusted comment chrome fetches private verified attachment into Blob without changing body or anchor", async () => {
  const root = await mkdtemp(join(tmpdir(), "supplemental-browser-"));
  const bytes = Buffer.from(
      "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
      "base64",
    ),
    sha = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(root, sha), bytes);
  const server = await startServer({ mediaDirectory: root }),
    browser = await chromium.launch();
  try {
    const token = await server.token("owner@example.test");
    const published = await (
      await server.request("/api/publish", {
        token,
        body: {
          source: source('<p id="target">Stable target</p>'),
          requestId: "supplemental-browser",
          visibility: "private",
        },
      })
    ).json();
    const nodeId = /<p id="target" data-af-id="([^"]+)"/.exec(
      published.source,
    )![1];
    const comment = await (
      await server.request(`/api/files/${published.id}/comments`, {
        token,
        body: {
          comment: { nodeId, quote: "Stable target", body: "Original comment" },
        },
      })
    ).json();
    for (const variant of ["original", "preview", "thumbnail"])
      await server.query(
        "INSERT INTO comment_attachment_assets(page_id,comment_id,attachment_id,variant,name,sha256,content_type,byte_length,storage_key,width,height) VALUES($1,$2,'attachment',$3,'Image.webp',$4,'image/webp',$5,$4,1,1)",
        [published.id, comment.id, variant, sha, bytes.length],
      );
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.origin);
    await page.evaluate(async () => {
      await fetch("/api/auth/test-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.test",
          browserSession: true,
        }),
      });
    });
    await page.goto(published.url);
    await page.locator('html[data-pagegi-startup="ready"]').waitFor();
    await page
      .getByRole("button", {
        name: "Open comment: Original comment",
        exact: true,
      })
      .click();
    const thumbnail = page.locator(".pg-comment-attachments img").first();
    await thumbnail.waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector(
        ".pg-comment-attachments img",
      ) as HTMLImageElement;
      return (
        img?.src.startsWith("blob:") && img.complete && img.naturalWidth === 1
      );
    });
    await page
      .getByRole("button", { name: "View attachment: Image.webp", exact: true })
      .click();
    await page.waitForFunction(() => {
      const img = document.querySelector(
        "dialog[open] img",
      ) as HTMLImageElement;
      return (
        img?.src.startsWith("blob:") && img.complete && img.naturalWidth === 1
      );
    });
    const download = await server.request(
      `/af/v1/ids/${published.id}?download=1`,
      { token },
    );
    const html = await download.text();
    assert.equal(html.includes(token), false);
    const file = join(root, "portable.html");
    await writeFile(file, html);
    const portable = await page.context().newPage();
    portable.on("pageerror", (error) => errors.push(error.message));
    await portable.goto(pathToFileURL(file).href);
    const popup = portable.waitForEvent("popup");
    await portable
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    const approval = await popup;
    await approval.waitForURL(server.origin + "/connect?**");
    await approval
      .getByRole("button", { name: "Approve connection", exact: true })
      .click();
    await approval.getByText("Connected.").waitFor();
    await portable
      .getByRole("button", {
        name: "Open comment: Original comment",
        exact: true,
      })
      .click();
    await portable.waitForFunction(() => {
      const img = document.querySelector(
        ".pg-comment-attachments img",
      ) as HTMLImageElement;
      return (
        img?.src.startsWith("blob:") && img.complete && img.naturalWidth === 1
      );
    });
    assert.equal(
      await portable.evaluate(
        () => typeof (globalThis as any)[Symbol.for("afbin.host")]?.image,
      ),
      "function",
      "downloaded connection attaches internal image port",
    );
    assert.deepEqual(errors, []);
    const listed = await (
      await server.request(`/api/files/${published.id}/comments`, { token })
    ).json();
    assert.equal(listed.comments[0].body, "Original comment");
    assert.equal(listed.comments[0].nodeId, nodeId);
  } finally {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
