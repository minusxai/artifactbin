import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { browserEngines } from "./browser-engines.js";

// Exercises native WindowProxy identity and structured-clone delivery: the
// bridge's CoreHost only accepts replies from its parent on its own channel.
test("app bridge accepts only its parent and channel; backend replies correlate by id", async () => {
  const bundle = await build({
    entryPoints: ["src/browser/bridge.js"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "bridgeAPI",
    platform: "browser",
  });
  for (const [name, engine] of Object.entries(browserEngines)) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://bridge.example.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<iframe id="app" srcdoc="<main data-af-id=\'n1\'>App</main>"></iframe><iframe id="stranger"></iframe>',
        }),
      );
      await page.goto("https://bridge.example.test/");
      await page.evaluate(() => {
        window.requests = [];
        addEventListener("message", (event) => {
          if (event.data?.kind === "remote-request") requests.push(event.data);
        });
      });
      const frame = await (await page.$("#app")).contentFrame();
      await frame.addScriptTag({ content: bundle.outputFiles[0].text });
      await frame.evaluate(() => {
        bridgeAPI.installBridge({
          local: false,
          channel: "trusted-channel",
          revision: "r",
          viewer: { designSystem: "riso", dark: null },
        });
        const host = globalThis[Symbol.for("afbin.host")];
        window.viewer = host.viewer();
        window.results = [];
        const port = host.remote();
        for (const query of ["{ a { x } }", "{ b { x } }"])
          port
            .execute({ query, variables: {}, operation: "query" })
            .then((reply) => results.push(reply.data), (error) => results.push(error.message));
      });
      assert.deepEqual(await frame.evaluate(() => viewer), { designSystem: "riso", dark: null }, name);
      await page.waitForFunction(() => requests.length === 2);
      const ids = await page.evaluate(() => requests.map((request) => request.id));
      const reply = (target, data) =>
        page.evaluate(
          ([target, data]) => {
            const send = (from, message) => from.postMessage(message, "*");
            const app = document.querySelector("#app").contentWindow;
            if (target === "stranger")
              send(document.querySelector("#stranger").contentWindow, { forward: data });
            else send(app, data);
          },
          [target, data],
        );
      const message = (id, data, extra = {}) => ({
        pagegi: true,
        channel: "trusted-channel",
        kind: "remote-response",
        response: { id, response: { data } },
        ...extra,
      });
      await reply("app", message(ids[0], { forged: "channel" }, { channel: "wrong" }));
      await reply("app", message(ids[0], { forged: "marker" }, { pagegi: false }));
      await frame.evaluate((forged) => window.postMessage(forged, "*"), message(ids[0], { forged: "self" }));
      const stranger = await (await page.$("#stranger")).contentFrame();
      await stranger.evaluate(
        (forged) => parent.document.querySelector("#app").contentWindow.postMessage(forged, "*"),
        message(ids[0], { forged: "sibling" }),
      );
      await reply("app", message("unrelated", { forged: "id" }));
      await reply("app", {
        pagegi: true,
        channel: "trusted-channel",
        kind: "remote-response",
        response: { id: ids[1], error: { message: "offline", sent: false } },
      });
      await reply("app", message(ids[0], { a: { x: 1 } }));
      await reply("app", message(ids[0], { a: { x: "duplicate" } }));
      await frame.waitForFunction(() => results.length === 2);
      assert.deepEqual(await frame.evaluate(() => results), ["offline", { a: { x: 1 } }], name);
      const accessMessage={pagegi:true,channel:'trusted-channel',kind:'authorization-context',context:'verified-guest',access:{epoch:1,state:'allowed',context:'verified-guest'}};
      await frame.evaluate(message=>window.postMessage(message,'*'),accessMessage);
      await stranger.evaluate(message=>parent.document.querySelector('#app').contentWindow.postMessage(message,'*'),accessMessage);
      assert.equal(await frame.evaluate(()=>globalThis[Symbol.for('afbin.host')].remote().access().state),'pending',name);
      await reply('app',accessMessage);
      await frame.waitForFunction(()=>globalThis[Symbol.for('afbin.host')].remote().access().state==='allowed');
      assert.equal(await frame.evaluate(()=>globalThis[Symbol.for('afbin.host')].remote().authorizationContext()),'verified-guest',name);
      await reply('app',{...accessMessage,context:null,access:{epoch:2,state:'denied',context:null}});
      await frame.waitForFunction(()=>globalThis[Symbol.for('afbin.host')].remote().access().state==='denied');
      await reply('app',accessMessage);
      assert.equal(await frame.evaluate(()=>globalThis[Symbol.for('afbin.host')].remote().authorizationContext()),null,name);
      assert.deepEqual(errors, [], name);
    } finally {
      await browser.close();
    }
  }
});
