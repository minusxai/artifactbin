import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, webkit, firefox } from "playwright";
import { compiledJavascriptMarkup } from "../src/migration/conversion/compiled/javascript-payload.ts";
const moduleSource =
  'document.querySelector("#content").setAttribute("data-executed","yes");';
for (const [name, engine] of Object.entries({ chromium, webkit, firefox }))
  test(`compiled module codec uses native module execution offline and respects CSP/errors in ${name}`, async () => {
    const markup = compiledJavascriptMarkup(moduleSource, true);
    const make = (body = markup) =>
      '<!doctype html><meta charset="utf-8"><style>p{color:blue}</style><p id="content">Readable content</p>' +
      body;
    const server = createServer((req, res) => {
      const deny = req.url === "/csp-denied",
        inlineDenied = req.url === "/inline-denied";
      res
        .writeHead(200, {
          "content-type": "text/html",
          "Content-Security-Policy": `default-src 'none'; script-src ${inlineDenied ? "'none'" : "'unsafe-inline'"}${deny || inlineDenied ? "" : " blob:"}; style-src 'unsafe-inline'; connect-src 'none'`,
        })
        .end(make());
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await engine.launch();
    const directory = await mkdtemp(join(tmpdir(), "compiled-codec-"));
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const requests: string[] = [];
      page.on("request", (r) => {
        if (/^https?:/.test(r.url())) requests.push(r.url());
      });
      await page.goto(base + "/");
      await page.waitForFunction(
        () =>
          document.querySelector("#content")?.getAttribute("data-executed") ===
          "yes",
      );
      assert.equal(
        await page.locator("[data-migration-runtime-status]").count(),
        0,
      );
      assert.equal(await page.locator("html[data-mx-ready]").count(), 0);
      assert.equal(requests.length, 1);
      await page.goto(base + "/csp-denied");
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.locator("#content").getAttribute("data-executed"),
        null,
      );
      assert.equal(await page.locator("html[data-mx-ready]").count(), 0);
      await page.goto(base + "/inline-denied");
      assert.match(
        (await page.getByRole("status").textContent()) ?? "",
        /has not started/,
      );
      assert.equal(
        await page.locator("#content").getAttribute("data-executed"),
        null,
      );
      for (const persisted of [false, true]) {
        const held = await browser.newPage();
        held.setDefaultTimeout(10000);
        await held.addInitScript(() => {
          const Native = globalThis.DecompressionStream;
          globalThis.DecompressionStream = class extends Native {
            constructor(format: CompressionFormat) {
              super(format);
              const original = this.readable;
              let release!: () => void;
              const gate = new Promise<void>((r) => (release = r));
              Object.defineProperty(this, "readable", {
                value: original.pipeThrough(
                  new TransformStream({
                    async transform(chunk, controller) {
                      document.documentElement.setAttribute(
                        "data-decoder-held",
                        "",
                      );
                      await gate;
                      controller.enqueue(chunk);
                    },
                  }),
                ),
              });
              window.addEventListener("release-decoder", () => release(), {
                once: true,
              });
            }
          };
        });
        await held.goto(base + "/");
        await held.locator("html[data-decoder-held]").waitFor();
        await held.evaluate((persisted) => {
          window.dispatchEvent(
            new PageTransitionEvent("pagehide", { persisted }),
          );
          window.dispatchEvent(new Event("release-decoder"));
        }, persisted);
        if (persisted)
          await held.waitForFunction(
            () =>
              document
                .querySelector("#content")
                ?.getAttribute("data-executed") === "yes",
          );
        else {
          await held
            .locator("[data-migration-runtime-status]")
            .waitFor({ state: "detached" });
          assert.equal(
            await held.locator("#content").getAttribute("data-executed"),
            null,
          );
        }
        await held.close();
      }
      for (const persisted of [false, true]) {
        const held = await browser.newPage();
        held.setDefaultTimeout(10000);
        await held.addInitScript(() => {
          const Native = globalThis.Blob;
          globalThis.Blob = class extends Native {
            constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
              super(
                options?.type === "text/javascript"
                  ? [
                      'await new Promise(resolve=>{document.documentElement.setAttribute("data-import-held","");window.addEventListener("release-import",resolve,{once:true});});\n',
                      ...(parts ?? []),
                    ]
                  : parts,
                options,
              );
            }
          };
        });
        await held.goto(base + "/");
        await held.locator("html[data-import-held]").waitFor();
        await held.evaluate((persisted) => {
          window.dispatchEvent(
            new PageTransitionEvent("pagehide", { persisted }),
          );
          window.dispatchEvent(new Event("release-import"));
        }, persisted);
        await held
          .locator("[data-migration-runtime-status]")
          .waitFor({ state: "detached" });
        assert.equal(
          await held.locator("#content").getAttribute("data-executed"),
          persisted ? "yes" : null,
        );
        assert.equal(await held.locator('[role="alert"]').count(), 0);
        await held.close();
      }
      for (const failure of ["unsupported", "corrupt", "module-error"]) {
        const broken = await browser.newPage();
        broken.setDefaultTimeout(10000);
        await broken.addInitScript(
          failure === "unsupported"
            ? "globalThis.DecompressionStream=undefined;"
            : "",
        );
        let html = make(
          failure === "module-error"
            ? compiledJavascriptMarkup('throw Error("Startup failed");', true)
            : markup,
        );
        if (failure === "corrupt")
          html = html.replace(
            /"sha256":"[a-f0-9]+"/,
            '"sha256":"' + "0".repeat(64) + '"',
          );
        await broken.route("**/broken", (route) =>
          route.fulfill({ contentType: "text/html", body: html }),
        );
        await broken.goto(base + "/broken");
        await broken.getByRole("alert").waitFor();
        assert.equal(
          await broken.locator("#content").getAttribute("data-executed"),
          null,
        );
        assert.equal(await broken.locator("html[data-mx-ready]").count(), 0);
        await broken.unroute("**/broken");
        await broken.close();
      }
      const offline = await browser.newPage();
      await writeFile(join(directory, "proof.html"), make());
      await offline.route(/^https?:/, (route) => route.abort());
      await offline.goto(pathToFileURL(join(directory, "proof.html")).href);
      await offline.waitForFunction(
        () =>
          document.querySelector("#content")?.getAttribute("data-executed") ===
          "yes",
      );
      await offline.reload();
      await offline.waitForFunction(
        () =>
          document.querySelector("#content")?.getAttribute("data-executed") ===
          "yes",
      );
      assert.equal(
        await offline.locator("#content").textContent(),
        "Readable content",
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(directory, { recursive: true, force: true });
    }
  });
