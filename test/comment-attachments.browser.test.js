import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

test("comment images use authenticated bytes and keyboard-accessible Blob views; authority loss removes every image", async () => {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmWQAAAAASUVORK5CYII=",
    "base64",
  );
  const requests = [];
  const server = createServer((req, res) => {
    if (req.url === "/")
      return res
        .writeHead(200, { "content-type": "text/html" })
        .end('<div id="layer"></div>');
    requests.push({ url: req.url, authorization: req.headers.authorization });
    if (req.headers.authorization !== "Bearer synthetic-page-grant")
      return res.writeHead(403).end();
    res.writeHead(200, { "content-type": "image/png" }).end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {createCommentAttachmentResources} from './src/browser/comment-attachment-resources.ts';
    import {createCommentPanel} from './src/browser/comment-panel.ts';
    window.created=[]; window.revoked=[]; window.errors=[];
    const attachments=[{id:'image-1',name:'Screenshot <plain>',variants:['thumbnail','preview','original'].map(variant=>({variant,mimeType:'image/png',width:1,height:1,bytes:${bytes.length},sha256:'a'.repeat(64)}))}];
    window.resources=createCommentAttachmentResources({
      async load(commentId,id,variant,signal){const response=await fetch('/image/'+commentId+'/'+id+'/'+variant,{signal,headers:{Authorization:'Bearer synthetic-page-grant'}});if(!response.ok)throw Object.assign(Error('Denied'),{status:response.status});return response.blob();},
      createURL(blob){const url=URL.createObjectURL(blob);created.push(url);return url;},
      revokeURL(url){revoked.push(url);URL.revokeObjectURL(url);}
    });
    resources.setAuthority('caller-a');
    window.state={comments:[{id:'comment-1',nodeId:'anchor',quote:'Original quote',body:'Original body <b>plain</b>',sourceRevision:'recorded-source',parentId:null,publishedBy:'reader',createdAt:'2026-01-01T00:00:00Z',appStateId:null,attachments}],profiles:{},sourceRevision:'current-source',actor:'reader',snapshot:null,canComment:false,canResolve:false,notice:'Read only',live:true};
    window.panel=createCommentPanel({layer:document.querySelector('#layer'),attachmentResources:resources,read:()=>state,geometry:()=>({targets:[{id:'anchor',quote:'',rect:{x:0,y:0,width:20,height:20}}],inset:0,height:800}),actions:{post(){throw Error('No upload');},resolve:async()=>{},reopen:async()=>{},view(){},finishSelection(){},error(message){errors.push(message);}}});
    panel.render();
  `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addStyleTag({
      content: await readFile(
        new URL("../src/browser/style.css", import.meta.url),
        "utf8",
      ),
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page
      .getByRole("button", { name: "Open comment: Original body <b>plain</b>" })
      .click();
    const thumbnail = page.getByRole("button", {
      name: "View attachment: Screenshot <plain>",
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".pg-attachment-thumbnail img")?.naturalWidth ===
        1,
    );
    assert.match(await thumbnail.locator("img").getAttribute("src"), /^blob:/);
    assert.equal(
      await page.locator(".pg-comment-body").first().textContent(),
      "Original body <b>plain</b>",
    );
    assert.equal(await page.locator(".pg-message b").count(), 0);
    await thumbnail.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Comment image",
      exact: true,
    });
    await dialog.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".pg-attachment-dialog img")?.naturalWidth === 1,
    );
    assert.equal(
      await dialog.locator("img").getAttribute("alt"),
      "Screenshot <plain>",
    );
    assert.match(await dialog.locator("img").getAttribute("src"), /^blob:/);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await thumbnail.evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        document.querySelector(".pg-attachment-dialog img")?.naturalWidth === 1,
    );
    await page.evaluate(() => resources.setAuthority(null));
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await page.locator(".pg-comment-attachments img[src]").count(),
      0,
    );
    assert.equal(await thumbnail.isDisabled(), true);
    const state = await page.evaluate(() => ({
      created,
      revoked,
      comment: window.state.comments[0],
    }));
    assert.deepEqual(new Set(state.created), new Set(state.revoked));
    assert.equal(state.comment.body, "Original body <b>plain</b>");
    assert.equal(state.comment.nodeId, "anchor");
    assert.equal(state.comment.sourceRevision, "recorded-source");
    await page.evaluate(() => {
      resources.setAuthority("caller-b");
      panel.render();
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".pg-attachment-thumbnail img")?.naturalWidth ===
        1,
    );
    assert.equal(await thumbnail.isDisabled(), false);
    await page.evaluate(() => {
      panel.dispose();
      resources.dispose();
    });
    assert.deepEqual(pageErrors, []);
    assert.ok(requests.length >= 3);
    assert.ok(
      requests.every(
        (req) =>
          req.authorization === "Bearer synthetic-page-grant" &&
          !req.url.includes("grant"),
      ),
    );
    assert.ok(requests.some((req) => req.url.endsWith("/thumbnail")));
    assert.ok(requests.some((req) => req.url.endsWith("/preview")));
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
