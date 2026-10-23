// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { prepareInactiveServerDocument } from "../src/migration/server-document.ts";
import { createMigrationConverter } from "../src/migration/convert.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "explicit inactive server document keeps viewer counter and visible limitation without enabling its handler",
  { skip: !archivedRoot },
  async () => {
    const source =
      '<Helmet><Value name="count" type="number" default={0}/><script>{`import {signal} from "page";const [count,setCount]=signal("$count");const out=document.querySelector("#out");const label=()=>{out.textContent=String(count());};label();document.querySelector("#increment").addEventListener("click",()=>{setCount(count()+1);label();});`}</script><script type="server">{`export default async function(){throw Error("must never execute")}`}</script></Helmet><p id="out">0</p><button id="increment">Increment</button>';
    const view = prepareInactiveServerDocument(source, {
        mode: "archived-inactive",
      }),
      admission = {
        mode: "archived-inactive" as const,
        originalSourceSha256: view.originalSourceSha256,
        handlerSourceSha256: view.handler.sourceSha256,
        renderSourceSha256: createHash("sha256")
          .update(view.renderSource)
          .digest("hex"),
      };
    const conversion = await createMigrationConverter({
      strategy: "archived-functional",
      legacyRoot: archivedRoot!,
    })({
      source,
      coreUrl: "/af/v1/core.js",
      archivedInactiveServerDocument: admission,
    });
    assert.equal(
      conversion.classification,
      "functional",
      JSON.stringify(conversion.issues),
    );
    assert(conversion.archivedInactiveServerDocument);
    assert(!conversion.nativeProgram);
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/af/v1/core.js" ? "text/javascript" : "text/html",
      );
      res.end(req.url === "/af/v1/core.js" ? core : conversion.html);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        "http://127.0.0.1:" + (server.address() as { port: number }).port,
      );
      await page.waitForFunction(
        () =>
          !document.querySelector("[data-migration-author-status]") ||
          document.querySelector<HTMLElement>("[data-migration-author-status]")!
            .hidden,
      );
      assert.equal(await page.locator("#out").innerText(), "0");
      await page.locator("#increment").click();
      await page.waitForFunction(
        () => document.querySelector("#out")?.textContent === "1",
      );
      assert.equal(
        await page.locator("[data-migration-inactive-server]").innerText(),
        view.limitation,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
