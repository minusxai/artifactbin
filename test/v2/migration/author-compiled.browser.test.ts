import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { compileAuthorScript } from "../../../src/migration/conversion/compiled/author/compiler.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "offline authored Solid mounts ordinary nodes using Apollo state from core",
  { skip: !archivedRoot },
  async () => {
    const compiled = await compileAuthorScript(
      `import {signal} from 'page';import {createSignal} from 'solid-js';export function Counter(){const [n,set]=signal('$count');const [local,put]=createSignal([{n:1}],{name:'local'});return <button onClick={()=>{set(v=>v+1);put(items=>items.map(item=>({n:item.n+1})))}}>{n()}:{local()[0].n}</button>}`,
      { values: ["count"], queries: [], mutations: [] },
      { archivedRoot: archivedRoot! },
    );
    const portsModule = (
      await build({
        entryPoints: [
          fileURLToPath(
            new URL(
              "../../../src/migration/conversion/compiled/author/apollo-ports.ts",
              import.meta.url,
            ),
          ),
        ],
        bundle: true,
        write: false,
        format: "esm",
      })
    ).outputFiles[0]!.text;
    const core = await readFile(
      new URL("../../../dist/core.js", import.meta.url),
      "utf8",
    );
    const errors: string[] = [];
    const html = `<!doctype html><html><head><script src="/af/v1/core.js"></script><script type="application/json" data-af="state">{"compiledPage":{"count":2}}</script></head><body><div id="mount"></div><script type="module">
 import {client,gql} from '@afbin/apollo';import {createAuthorModule} from '/author.js';import {authorApolloPorts} from '/ports.js';
 const query=gql\`{compiledPage authorSignals}\`;
 const ports=authorApolloPorts(client,query,()=>{throw Error('undeclared')});
 await createAuthorModule().mount(ports,[{element:document.querySelector('#mount'),identity:'counter',component:'Counter'}]);
 </script></body></html>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url?.endsWith(".js") ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/af/v1/core.js"
          ? core
          : req.url === "/author.js"
            ? compiled.code
            : req.url === "/ports.js"
              ? portsModule
              : html,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(5000);
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page.getByRole("button", { name: "2:1", exact: true }).waitFor();
      await page.getByRole("button").click();
      await page.getByRole("button", { name: "3:2", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "3:2", exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
