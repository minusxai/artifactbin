// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "native persisted upload restores filename and size across binary bridge and reload",
  { skip: !root },
  async () => {
    const ref = `dfile:${"a".repeat(32)}`;
    const result = await compileArchivedLocal(
      {
        source: `<Helmet><Import name="images" src="ref:Abcd12"/><Value name="files" type="string" default="${ref}"/><Query name="total">{\`select 1 as n\`}</Query></Helmet><FileUpload id="upload" dataset="images" value="$files" accept="image/webp"/>`,
        coreUrl: "/af/v1/core.js",
        datasetBindings: [
          {
            name: "images",
            legacyRef: "ref:Abcd12",
            backendNamespace: "data",
            backendHref: "/af/v1/ids/Bac123",
            mode: "live",
            version: 1,
            tables: [
              {
                schema: "main",
                table: "rows",
                columns: [{ name: "file", type: "string" }],
              },
            ],
          },
        ],
        datasetAttachments: [
          { backendNamespace: "data", bindingName: "images" },
        ],
      },
      { legacyRoot: root!, sourceAdmission: "offline-prototype" },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    const core = (
      await build({
        entryPoints: ["src/browser/core/core.ts"],
        bundle: true,
        write: false,
        format: "iife",
        target: "es2022",
        minify: true,
      })
    ).outputFiles[0]!.text;
    const server = createServer((q, s) =>
      s
        .writeHead(200, {
          "content-type":
            q.url === "/af/v1/core.js" ? "text/javascript" : "text/html",
        })
        .end(q.url === "/af/v1/core.js" ? core : result.html),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        const w = window as any;
        w.__name = (f: any) => f;
        w[Symbol.for("afbin.host")] = {
          viewer: () => ({ dark: null, designSystem: null }),
          subscribeViewer: () => () => {},
          state: () => null,
          remote: () => ({
            online: () => true,
            access: () => ({ state: "allowed", epoch: 1, context: "fixture" }),
            authorizationContext: () => "fixture",
            subscribe: () => () => {},
            execute: async () => ({ data: {} }),
          }),
          datasetAttachment: {
            availability: async () => ({ canAttempt: true }),
            upload: async () => {
              throw Error("No upload expected");
            },
            read: async () => {
              const file = location.search.includes("fallback")
                ? new Blob(["abc"], { type: "image/webp" })
                : new File(["abc"], "synthetic.webp", { type: "image/webp" });
              const channel = new MessageChannel();
              return await new Promise((resolve) => {
                channel.port2.onmessage = (e) => {
                  channel.port1.close();
                  channel.port2.close();
                  resolve(e.data);
                };
                channel.port1.postMessage(file);
              });
            },
          },
        };
      });
      const origin =
        "http://127.0.0.1:" + (server.address() as { port: number }).port;
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        else await page.goto(origin);
        await page
          .getByRole("link", { name: "synthetic.webp", exact: true })
          .waitFor();
        assert.match(
          await page.locator('[data-slot="file-upload"]').innerText(),
          /3 bytes/,
        );
        assert.equal(
          await page
            .getByRole("link", { name: "synthetic.webp" })
            .getAttribute("download"),
          "synthetic.webp",
        );
      }
      await page.goto(origin + "/?fallback");
      await page
        .getByRole("link", { name: "Uploaded image", exact: true })
        .waitFor();
      assert.match(
        await page.locator('[data-slot="file-upload"]').innerText(),
        /3 bytes/,
      );
      assert.doesNotMatch(
        await page.locator('[data-slot="file-upload"]').innerText(),
        /dfile:/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
