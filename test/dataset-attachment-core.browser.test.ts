import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
test("imported client exposes a revocable attachment adapter in hosted and late-attached pages", async () => {
  const core = (
    await build({
      entryPoints: ["src/browser/core/core.ts"],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    })
  ).outputFiles[0]!.text;
  const fixture = `let access={epoch:1,state:'pending',context:null};const listeners=new Set();let calls=0;const remote={online:()=>true,access:()=>access,subscribeAccess:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},subscribe:()=>()=>{},execute:async()=>({data:{}})};const host={viewer:()=>({dark:null,designSystem:null}),subscribeViewer:()=>()=>{},state:()=>null,remote:()=>remote,datasetAttachment:{availability:async()=>({canAttempt:true}),read:async()=>new Blob(['image']),upload:async request=>{calls++;return {ref:'opaque',url:'fixed',name:request.filename,contentType:request.blob.type,size:request.blob.size};}}};window.setAccess=value=>{access=value;for(const fn of [...listeners])fn();};window.fixture={host,listeners,get calls(){return calls;}};`;
  const server = createServer((req, res) => {
    if (req.url === "/core.js") {
      res.writeHead(200, { "content-type": "text/javascript" }).end(core);
      return;
    }
    const late = req.url === "/late";
    res
      .writeHead(200, { "content-type": "text/html" })
      .end(
        `<!doctype html><html><head><script>${fixture}${late ? "" : "globalThis[Symbol.for('afbin.host')]=host;"}</script><script src="/core.js" ${late ? 'data-af="core" data-af-server="http://127.0.0.1:1"' : ""}></script><script type="module">import {client} from '@afbin/apollo';window.client=client;window.adapter=client[Symbol.for('afbin.internal.datasetAttachment')]();window.ready=true;</script></head><body></body></html>`,
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const route of ["/hosted", "/late"]) {
      const page = await browser.newPage();
      await page.goto(
        `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}${route}`,
      );
      await page.waitForFunction(() => (window as any).ready);
      assert.equal(
        await page.evaluate(() => (window as any).adapter.transport()),
        null,
      );
      if (route === "/late")
        await page.evaluate(() =>
          (globalThis as any)[Symbol.for("afbin.core")].attach(
            (window as any).fixture.host,
          ),
        );
      const result = await page.evaluate(async () => {
        const w = window as any;
        let changes = 0;
        w.adapter.subscribe(() => changes++);
        w.setAccess({ epoch: 2, state: "allowed", context: "opaque-context" });
        const port = w.adapter.transport();
        const receipt = await port.upload({
          backendNamespace: "data",
          bindingName: "image",
          requestId: "request",
          filename: "a.png",
          contentType: "image/png",
          blob: new Blob(["bytes"], { type: "image/png" }),
        });
        w.setAccess({ epoch: 3, state: "denied", context: null });
        let rejected = false;
        try {
          await port.read({
            backendNamespace: "data",
            bindingName: "image",
            ref: "opaque",
          });
        } catch {
          rejected = true;
        }
        w.client.dispose();
        return {
          receipt,
          calls: w.fixture.calls,
          rejected,
          transport: w.adapter.transport(),
          listeners: w.fixture.listeners.size,
          changes,
        };
      });
      assert.equal(result.receipt.size, 5);
      assert.equal(result.calls, 1);
      assert.equal(result.rejected, true);
      assert.equal(result.transport, null);
      assert.equal(result.listeners, 0);
      assert.ok(result.changes >= 3);
      await page.close();
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
