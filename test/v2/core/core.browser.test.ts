/**
 * The built core (dist/core.js) in real browsers, without the Pagegi server:
 * a loopback static host stands in for /af/v1/. Brief A.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium, firefox, webkit, type BrowserType, type Page } from "playwright";
import { DESIGN_SYSTEMS, KNOWN_AF_ORIGINS } from "../../../src/af-contracts.ts";
import { repositoryPath } from "../support/load.ts";
import { skillFile } from "../support/skill.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

/** Serves pages with every known platform origin replaced by this host's own origin, as the server does on save. */
async function staticHost(pages: Record<string, string>) {
  const core = repositoryPath("dist/core.js");
  assert.ok(existsSync(core), "npm run build writes dist/core.js");
  let origin = "";
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", origin).pathname;
    const css = /^\/af\/v1\/design-systems\/([a-z]+)\.css$/.exec(path)?.[1];
    if (path === "/af/v1/core.js")
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(readFileSync(core));
    else if (css && (DESIGN_SYSTEMS as readonly string[]).includes(css))
      res.writeHead(200, { "Content-Type": "text/css" }).end(skillFile(`design-systems/${css}.css`));
    else if (pages[path] !== undefined)
      res.writeHead(200, { "Content-Type": "text/html" }).end(KNOWN_AF_ORIGINS.reduce((html, known) => html.replaceAll(known, origin), pages[path]!));
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const htmlAttributes = (page: Page) =>
  page.evaluate(() => ({
    designSystem: document.documentElement.getAttribute("data-af-design-system"),
    dark: document.documentElement.getAttribute("data-af-dark"),
    link: document.querySelector('link[data-af="design-system"]')?.getAttribute("href") ?? null,
    linkAfterCore:
      document.querySelector('link[data-af="design-system"]')?.previousElementSibling?.getAttribute("src")?.endsWith("/af/v1/core.js") ?? false,
    // The page must never paint before its design system: the core's link blocks rendering until the CSS is in.
    renderBlocking: document.querySelector('link[data-af="design-system"]')?.getAttribute("blocking") === "render",
  }));

const withState = (state: unknown) =>
  skillFile("examples/todo.html").replace(
    "</head>",
    `  <script type="application/json" data-af="state">${JSON.stringify(state)}</script>\n</head>`,
  );

for (const [name, engine] of engines) {
  test(`${name}: the todo example runs as written on its own, with @afbin/apollo from the core`, async () => {
    const site = await staticHost({
      "/todo.html": skillFile("examples/todo.html"),
      "/dossier.html": skillFile("examples/todo.html").replace("<html", '<html data-af-design-system="dossier"'),
      "/saved.html": withState({
        draft: "Unsent draft", filter: "done",
        todos: [{ id: "s1", text: "Stale shared row", done: true }],
      }),
    });
    const browser = await engine.launch();
    try {
      const light = await browser.newPage({ colorScheme: "light" });
      const errors: string[] = [];
      light.on("pageerror", (error) => errors.push(error.message));
      await light.goto(`${site.origin}/todo.html`);
      assert.deepEqual(await htmlAttributes(light), {
        designSystem: "meridian",
        dark: null,
        link: `${site.origin}/af/v1/design-systems/meridian.css`,
        linkAfterCore: true,
        renderBlocking: true,
      });
      // Opened on its own the shared list is out of reach; the viewer's own state still works and persists.
      await light.getByText("Shared list unavailable. Connect or check your access.").waitFor();
      await light.fill("#text", "Write tests");
      await light.click('#filters button[data-filter="open"]');
      await light.locator('#filters button[data-filter="open"][aria-pressed="true"]').waitFor();
      await light.reload();
      await light.locator('#filters button[data-filter="open"][aria-pressed="true"]').waitFor();
      assert.equal(await light.inputValue("#text"), "Write tests", "the unsent text is local state too");
      assert.deepEqual(errors, []);

      const dark = await browser.newPage({ colorScheme: "dark" });
      await dark.goto(`${site.origin}/dossier.html`);
      const attributes = await htmlAttributes(dark);
      assert.equal(attributes.designSystem, "dossier");
      assert.equal(attributes.dark, "true");
      assert.equal(attributes.link, `${site.origin}/af/v1/design-systems/dossier.css`);

      const saved = await browser.newPage();
      await saved.goto(`${site.origin}/saved.html`);
      await saved.getByText("Shared list unavailable. Connect or check your access.").waitFor();
      assert.equal(await saved.inputValue("#text"), "Unsent draft");
      await saved.locator('#filters button[data-filter="done"][aria-pressed="true"]').waitFor();
      assert.equal(await saved.locator("#list li").count(), 0, "saved local state cannot substitute stale shared backend rows");
    } finally {
      await browser.close();
      await site.close();
    }
  });
}

for (const [name, engine] of engines) {
  test(`${name}: a preview query forces the appearance (shot.mjs)`, async () => {
    const site = await staticHost({ "/todo.html": skillFile("examples/todo.html").replace("<html", '<html data-af-design-system="volta"') });
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ colorScheme: "light" });
      await page.goto(`${site.origin}/todo.html?af-dark=1&af-design-system=dossier`);
      const attributes = await htmlAttributes(page);
      assert.equal(attributes.designSystem, "dossier");
      assert.equal(attributes.dark, "true");
      assert.equal(attributes.link, `${site.origin}/af/v1/design-systems/dossier.css`);
    } finally {
      await browser.close();
      await site.close();
    }
  });
}
