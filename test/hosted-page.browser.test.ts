/**
 * A hosted page in real browsers without the server: the runner's HTML
 * (bridge first, then the page with the built core) in two frames under a
 * fake platform frame that answers backend requests from one in-memory list.
 * Covers what the server-backed integration tests rely on: the todo example's
 * shared list through backend calls on the platform, the viewer's own local
 * state kept in browser storage (two frames of one viewer are like two tabs),
 * node IDs in comment targets and viewer appearance.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, firefox, webkit, type BrowserType, type Frame, type Page } from "playwright";
import { DEFAULT_AF_ORIGIN, DESIGN_SYSTEMS } from "../src/af-contracts.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];
const PLATFORM = "https://platform.example.test";
const todo = readFileSync("skills/pagegi-author/examples/todo.html", "utf8");

/** The platform side: answers every frame's backend calls from one shared list, as the team backend would. */
const PLATFORM_SCRIPT = `
import { createAppHTML } from "./src/browser/surface.js";
const list = [];
window.views = [];
window.remoteCalls = [];
addEventListener("message", (event) => {
  const m = event.data;
  if (!m?.pagegi || !event.source) return;
  const reply = (data) => event.source.postMessage({ pagegi: true, channel: m.channel, ...data }, "*");
  if (m.kind === "view") window.views.push(m);
  if (m.kind === "remote-request") {
    const request = m.request;
    window.remoteCalls.push(request);
    let response = { data: { team: { list: list.slice() } } };
    if (request.operation === "mutation" && /add\\(/.test(request.query)) {
      const todo = { id: String(list.length + 1), text: request.variables.text, done: false };
      list.push(todo);
      response = { data: { team: { add: { id: todo.id } } }, extensions: { outcomes: { "team.add": "committed" } } };
    }
    reply({ kind: "remote-response", response: { id: m.id, response } });
  }
});
window.mount = (id, source, bridge) => {
  document.getElementById(id).srcdoc = createAppHTML(
    source,
    { revision: "r", page: "Pg4mQ2", seed: { filter: "all" }, channel: id, viewer: { designSystem: "dossier", dark: true } },
    bridge,
  );
};
window.appearance = (id, viewer) =>
  document.getElementById(id).contentWindow.postMessage({ pagegi: true, channel: id, kind: "appearance", viewer }, "*");
`;

async function bundles() {
  assert.ok(existsSync("dist/core.js"), "npm run build writes dist/core.js");
  const bridge = await build({ entryPoints: ["src/browser/bridge.js"], bundle: true, write: false, format: "iife", target: "es2022" });
  const platform = await build({
    stdin: {
      contents: PLATFORM_SCRIPT,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
  });
  return { bridge: bridge.outputFiles[0]!.text, platform: platform.outputFiles[0]!.text };
}

async function app(page: Page, id: string): Promise<Frame> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const frame = await (await page.$(`iframe#${id}`))?.contentFrame();
    if (frame && (await frame.$("#list").catch(() => null))) return frame;
    await page.waitForTimeout(50);
  }
  throw Error(`frame ${id} did not load`);
}
const items = (frame: Frame) => frame.locator("#list li span").allTextContents();
async function eventually<T>(read: () => Promise<T>, expected: T) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (JSON.stringify(await read()) === JSON.stringify(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(await read(), expected);
}
async function add(frame: Frame, text: string) {
  await frame.fill("#text", text);
  await frame.click("#new button");
}

for (const [name, engine] of engines) {
  test(`${name}: hosted frames share the todo list through backend calls and keep the viewer's own state`, async () => {
    const code = await bundles();
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(`${DEFAULT_AF_ORIGIN}/af/v1/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        const css = /^\/af\/v1\/design-systems\/([a-z]+)\.css$/.exec(path)?.[1];
        if (path === "/af/v1/core.js")
          return route.fulfill({ contentType: "text/javascript", body: readFileSync("dist/core.js", "utf8") });
        if (css && (DESIGN_SYSTEMS as readonly string[]).includes(css))
          return route.fulfill({ contentType: "text/css", body: readFileSync(`skills/pagegi-author/design-systems/${css}.css`, "utf8") });
        return route.fulfill({ status: 404, body: "" });
      });
      await page.route(PLATFORM + "/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><iframe id="a" name="a"></iframe><iframe id="b" name="b"></iframe><script>${code.platform}</script>`,
        }),
      );
      await page.goto(PLATFORM + "/");
      await page.evaluate(
        ([source, other, bridge]) => {
          (window as any).mount("a", source, bridge);
          (window as any).mount("b", other, bridge);
        },
        [todo, todo, code.bridge],
      );
      const a = await app(page, "a");
      const b = await app(page, "b");

      // The viewer's picks from the platform drive the page's appearance.
      const look = (frame: Frame) =>
        frame.evaluate(() => ({
          designSystem: document.documentElement.getAttribute("data-af-design-system"),
          dark: document.documentElement.getAttribute("data-af-dark"),
          link: document.querySelector('link[data-af="design-system"]')?.getAttribute("href"),
        }));
      assert.deepEqual(await look(a), {
        designSystem: "dossier",
        dark: "true",
        link: `${DEFAULT_AF_ORIGIN}/af/v1/design-systems/dossier.css`,
      });
      await page.evaluate(() => (window as any).appearance("a", { designSystem: "riso", dark: false }));
      await eventually(() => look(a), { designSystem: "riso", dark: null, link: `${DEFAULT_AF_ORIGIN}/af/v1/design-systems/riso.css` });

      // Backend calls go to the platform frame, never to a server from the page.
      await eventually(async () => (await page.evaluate(() => (window as any).remoteCalls.length)) >= 2, true);
      const calls = await page.evaluate(() => (window as any).remoteCalls);
      assert.equal(calls[0].operation, "query");

      // The shared list: one frame's add reaches the other through the backend.
      await add(a, "Alpha");
      await eventually(() => items(a), ["Alpha"]);
      await eventually(() => items(b), ["Alpha"]);

      // Local state starts from the page's seed and belongs to this viewer: two
      // frames of one viewer are like two tabs, so a filter picked in one shows in the other.
      const pressed = (frame: Frame) => frame.locator('#filters button[aria-pressed="true"]').textContent();
      await eventually(() => pressed(a), "All");
      await a.click('#filters button[data-filter="done"]');
      await eventually(() => pressed(a), "Done");
      await eventually(() => items(a), []);
      await eventually(() => pressed(b), "Done");
      const stored = await a.evaluate(() => JSON.parse(localStorage.getItem("af:state:Pg4mQ2") ?? "null"));
      assert.equal(stored.filter, "done");

      // Comment targets are the elements' data-af-id node IDs.
      const targets = await page.evaluate(() =>
        (window as any).views.flatMap((view: { targets: { id: string }[] }) => view.targets.map((target) => target.id)),
      );
      assert.ok(targets.some((id: string) => /^todo-/.test(id)), JSON.stringify(targets.slice(0, 5)));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}
