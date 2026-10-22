import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "compiled conditional and keyed loop identities survive state changes and reject collisions",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        source: `<Helmet><Value name="mode" type="string" default="a"/><Value name="rows" type="table" value={[{key:"a",label:"First"},{key:"b",label:"Second"}]}/><Query name="summary">{\`select 1 as n\`}</Query></Helmet><Button id="switch" set={{mode:"b"}}>Switch</Button>{$mode === "a" ? <p id="yes">{$summary.n}</p> : <p id="no">Other</p>}<For id="list" each={$rows} keyBy="key"><span id="item">{$_row.label}</span></For>`,
        coreUrl: "/af/v1/core.js",
      },
      { legacyRoot: root! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.ok(result.html);

    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    const server = createServer((request, response) => {
      if (request.url === "/af/v1/core.js")
        response
          .writeHead(200, { "content-type": "text/javascript" })
          .end(core);
      else if (request.url === "/proof")
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(result.html);
      else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.hostname !== "127.0.0.1"
        )
          external.push(request.url());
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      await page.locator('#yes[data-af-id="yes"]').waitFor();
      const snapshot = () =>
        page.locator("#list span[id]").evaluateAll((nodes) =>
          nodes.map((node) => ({
            text: node.textContent,
            id: node.id,
            identity: node.getAttribute("data-af-id"),
          })),
        );
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("#list span[id]")].length === 2 &&
          [...document.querySelectorAll("#list span[id]")].every(
            (n) => n.id === n.getAttribute("data-af-id"),
          ),
      );
      const before = await snapshot();
      assert.equal(before.length, 2);
      await page.locator("#switch").click();
      await page.locator('#no[data-af-id="no"]').waitFor();
      assert.equal(await page.locator("#yes").count(), 0);
      await page.evaluate(async () => {
        const { client, gql } = await import(String("@afbin/apollo"));
        await client.updateQuery(
          {
            query: gql`
              {
                compiledPage
              }
            `,
          },
          (data: Record<string, any>) => ({
            ...data,
            compiledPage: {
              ...data.compiledPage,
              rows: [
                { key: "b", label: "Second" },
                { key: "a", label: "First" },
                { key: "c", label: "Third" },
              ],
            },
          }),
        );
      });
      await page.waitForFunction(
        () => document.querySelectorAll("#list span[id]").length === 3,
      );
      const after = await snapshot();
      for (const old of before)
        assert.equal(
          after.find((n) => n.text === old.text)?.identity,
          old.identity,
        );
      assert.equal(after[0]!.text, "Second");
      assert.equal(new Set(after.map((n) => n.identity)).size, 3);
      await page.evaluate(async () => {
        const { client, gql } = await import(String("@afbin/apollo"));
        await client.updateQuery(
          {
            query: gql`
              {
                compiledPage
              }
            `,
          },
          (data: Record<string, any>) => ({
            ...data,
            compiledPage: {
              ...data.compiledPage,
              rows: [{ key: "c", label: "Third" }],
            },
          }),
        );
      });
      await page.waitForFunction(
        () => document.querySelectorAll("#list span[id]").length === 1,
      );
      await page.reload();
      await page.locator('#no[data-af-id="no"]').waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll("#list span[id]").length === 1,
      );
      assert.equal(
        (await snapshot())[0]!.identity,
        after.find((n) => n.text === "Third")?.identity,
      );
      await page.evaluate(() =>
        document.body.append(document.querySelector("#no")!.cloneNode(true)),
      );
      await page
        .getByRole("alert")
        .filter({ hasText: "document identities" })
        .waitFor();
      assert.equal(await page.evaluate(() => document.body.inert), true);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
