import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright";

test("trusted hosted and portable placement boot pins access before authored code can observe the host", async () => {
  const [placement, runner, bridge] = await Promise.all([
    build({
      entryPoints: ["src/browser/placement.js"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "placementAPI",
    }),
    build({
      entryPoints: ["src/browser/runner.js"],
      bundle: true,
      write: false,
      format: "iife",
    }),
    build({
      entryPoints: ["src/browser/bridge.js"],
      bundle: true,
      write: false,
      format: "iife",
    }),
  ]);
  const source =
    '<!doctype html><html><head><script>window.firstAccess=globalThis[Symbol.for("afbin.host")].remote().access();</script></head><body>Fixture</body></html>';
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url?.endsWith(".js") ? "text/javascript" : "text/html",
    );
    if (req.url === "/placement.js") res.end(placement.outputFiles[0]!.text);
    else if (req.url === "/runner.js") res.end(runner.outputFiles[0]!.text);
    else if (req.url === "/bridge.js") res.end(bridge.outputFiles[0]!.text);
    else if (req.url === "/runner")
      res.end(
        '<!doctype html><html data-platform-origin="http://' +
          req.headers.host +
          '"><head><script src="/runner.js"></script></head></html>',
      );
    else
      res.end(
        '<!doctype html><iframe id="page"></iframe><iframe id="history" hidden></iframe><script src="/placement.js"></script>',
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const local of [false, true]) {
      const page = await browser.newPage();
      await page.addInitScript({content:"globalThis.__name=(fn)=>fn;"});
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page.evaluate(
        ({ local, source, bridge }) => {
          const w = window as any;
          if (local)
            w[Symbol.for("afbin.core")] = {
              attach: () => ({
                state: { read: () => ({}), subscribe: () => () => {} },
              }),
            };
          w.placement = w.placementAPI.createPlacement({
            local,
            shell: { runner: "/runner" },
            frame: document.querySelector("#page"),
            historyFrame: document.querySelector("#history"),
            localState: () => ({ page: "Fixture", seed: null, load: null }),
            access: () => ({ epoch: 7, state: "pending", context: null }),
            viewer: () => ({ dark: null, designSystem: null }),
            bridge,
          });
          w.placement.mount(source, null, "revision");
        },
        { local, source, bridge: bridge.outputFiles[0]!.text },
      );
      if (local) {
        assert.deepEqual(
          await page.evaluate(() =>
            (globalThis as any)[Symbol.for("afbin.host")].remote().access(),
          ),
          { epoch: 7, state: "pending", context: null },
        );
      } else {
        const frame = page.frameLocator("#page");
        await frame.getByText("Fixture", { exact: true }).waitFor();
        assert.deepEqual(
          await (await page.locator("#page").elementHandle())!
            .contentFrame()
            .then((frame) =>
              frame!.evaluate(() => (window as any).firstAccess),
            ),
          { epoch: 7, state: "pending", context: null },
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
