/**
 * The core's import map next to pages that load modules in other ways, in
 * real browsers. Invariants are asserted; what each engine does with a page's
 * own import map is recorded as a diagnostic (engines differ, and change).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium, firefox, webkit, type BrowserType } from "playwright";
import { repositoryPath } from "../support/load.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

const probe = `<script type="module">
  const out = {};
  try { out.apollo = typeof (await import('@afbin/apollo')).client.query; } catch (error) { out.apollo = 'error'; }
  try { out.author = (await import('author-lib')).value; } catch (error) { out.author = 'error'; }
  document.title = JSON.stringify(out);
</script>`;
const authorMap = (extra = "") => `<script type="importmap">{"imports":{"author-lib":"/lib.js"${extra}}}</script>`;
const pages: Record<string, string> = {
  "/external.html": `<!doctype html><html><head><script src="/af/v1/core.js?delay=1"></script><script type="module" src="/app.js"></script></head><body></body></html>`,
  "/override.html": `<!doctype html><html><head><script src="/af/v1/core.js"></script>${authorMap(',"@afbin/apollo":"/fake.js"')}</head><body>${probe}</body></html>`,
  "/after.html": `<!doctype html><html><head><script src="/af/v1/core.js"></script>${authorMap()}</head><body>${probe}</body></html>`,
  "/before.html": `<!doctype html><html><head>${authorMap()}<script src="/af/v1/core.js"></script></head><body>${probe}</body></html>`,
};

async function host() {
  const core = repositoryPath("dist/core.js");
  assert.ok(existsSync(core), "npm run build writes dist/core.js");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://loopback");
    const js = (body: string | Buffer) => res.writeHead(200, { "Content-Type": "text/javascript" }).end(body);
    if (url.pathname === "/af/v1/core.js") {
      // A slow core: the preload scanner sees the module script before the import map exists.
      if (url.searchParams.has("delay")) setTimeout(() => js(readFileSync(core)), 500);
      else js(readFileSync(core));
    } else if (url.pathname === "/app.js") js("import { client } from '@afbin/apollo'; document.title = 'external ' + typeof client.query;");
    else if (url.pathname === "/lib.js") js("export const value = 'author';");
    else if (url.pathname === "/fake.js") js("export const client = { query: 'fake' };");
    else if (url.pathname.startsWith("/af/v1/design-systems/")) res.writeHead(200, { "Content-Type": "text/css" }).end("");
    else if (pages[url.pathname]) res.writeHead(200, { "Content-Type": "text/html" }).end(pages[url.pathname]);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

for (const [name, engine] of engines) {
  test(`${name}: the core's import map holds against external modules and a page's own map`, async (t) => {
    const site = await host();
    const browser = await engine.launch();
    try {
      const title = async (path: string, until: (value: string) => boolean) => {
        const page = await browser.newPage();
        const warnings: string[] = [];
        page.on("console", (message) => warnings.push(message.text()));
        await page.goto(site.origin + path);
        await page.waitForFunction(() => document.title !== "", undefined, { timeout: 5000 }).catch(() => {});
        const value = await page.title();
        await page.close();
        assert.ok(until(value), `${path}: ${value}`);
        return { value, warnings };
      };
      await title("/external.html", (value) => value === "external function");
      const override = await title("/override.html", (value) => JSON.parse(value).apollo === "function");
      const after = await title("/after.html", (value) => JSON.parse(value).apollo === "function");
      const before = await title("/before.html", (value) => value.startsWith("{"));
      t.diagnostic(`${name} ${browser.version()}: page map after core ${after.value}; before core ${before.value}; overriding @afbin/apollo ${override.value}`);
      for (const warning of [...override.warnings, ...after.warnings, ...before.warnings]) t.diagnostic(`${name} console: ${warning}`);
    } finally {
      await browser.close();
      await site.close();
    }
  });
}
