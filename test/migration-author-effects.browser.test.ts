import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { compileAuthorScript } from "../src/migration/conversion/compiled/author/compiler.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "effect-only modules initialize once in owned roots and dispose listeners timers and failures per instance",
  { skip: !archivedRoot },
  async () => {
    const source = `import {onCleanup} from 'solid-js';const out=document.getElementById('out');out.dataset.starts=String(Number(out.dataset.starts||0)+1);document.addEventListener('click',()=>out.dataset.clicks=String(Number(out.dataset.clicks||0)+1));window.addEventListener('scroll',()=>out.dataset.scroll=String(window.scrollY));setInterval(()=>out.dataset.ticks=String(Number(out.dataset.ticks||0)+1),5);onCleanup(()=>out.dataset.cleanups=String(Number(out.dataset.cleanups||0)+1));`;
    const compiled = await compileAuthorScript(
      source,
      { values: [], queries: [], mutations: [] },
      { archivedRoot: archivedRoot!, mode: "effects" },
    );
    const failed = await compileAuthorScript(
      `document.addEventListener('click',()=>document.getElementById('out').dataset.leaked='yes');throw Error('failed initializer');`,
      { values: [], queries: [], mutations: [] },
      { archivedRoot: archivedRoot!, mode: "effects" },
    );
    const html = `<!doctype html><p id="out"></p><script type="module">import {createAuthorModule}from'/effect.js';import{createAuthorModule as failed}from'/failed.js';const ports={state:{read:()=>undefined,write(){},subscribe:()=>()=>{}},query(){throw Error('undeclared')}};const a=createAuthorModule(),b=createAuthorModule();window.stops=[await a.mount(ports,[]),await b.mount(ports,[])];try{await failed().mount(ports,[]);}catch{}const cancellation=new AbortController();const pending=createAuthorModule().mount(ports,[],{signal:cancellation.signal});cancellation.abort();try{await pending;}catch{}window.proofReady=true;</script>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url?.endsWith(".js") ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/effect.js"
          ? compiled.code
          : req.url === "/failed.js"
            ? failed.code
            : html,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page.waitForFunction(() => Boolean((window as any).proofReady));
      assert.equal(await page.locator("#out").getAttribute("data-starts"), "2");
      await page.evaluate(() => document.dispatchEvent(new Event("click")));
      assert.equal(await page.locator("#out").getAttribute("data-clicks"), "2");
      assert.equal(
        await page.locator("#out").getAttribute("data-leaked"),
        null,
      );
      await page.evaluate(() => {
        (window as any).stops[0]();
        document.dispatchEvent(new Event("click"));
      });
      assert.equal(await page.locator("#out").getAttribute("data-clicks"), "3");
      assert.equal(
        await page.locator("#out").getAttribute("data-cleanups"),
        "1",
      );
      await page.evaluate(() => {
        (window as any).stops[1]();
        document.dispatchEvent(new Event("click"));
      });
      const ticks = await page.locator("#out").getAttribute("data-ticks");
      await page.waitForTimeout(40);
      assert.equal(
        await page.locator("#out").getAttribute("data-ticks"),
        ticks,
      );
      assert.equal(await page.locator("#out").getAttribute("data-clicks"), "3");
      assert.equal(
        await page.locator("#out").getAttribute("data-cleanups"),
        "2",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "canonical effect document compiles to ordinary HTML and owns lifecycle through page boot",
  { skip: !archivedRoot },
  async () => {
    const { compileArchivedAuthor } = await import(
      "../src/migration/conversion/compiled/local.ts"
    );
    const { readFile } = await import("node:fs/promises");
    const result = await compileArchivedAuthor(
      {
        source: `<Helmet><script>{\`import {onCleanup} from 'solid-js';const out=document.getElementById('effect-output');out.textContent='Started';document.getElementById('effect-button').addEventListener('click',()=>out.textContent='Clicked');onCleanup(()=>out.textContent='Stopped');\`}</script></Helmet><p id="effect-output">Fallback</p><button id="effect-button">Act</button>`,
        coreUrl: "/af/v1/core.js",
      },
      { legacyRoot: archivedRoot! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.equal(result.provenance?.mode, "authored-effects");
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url?.endsWith(".js") ? "text/javascript" : "text/html",
      );
      res.end(req.url === "/af/v1/core.js" ? core : result.html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page.getByText("Started", { exact: true }).waitFor();
      await page.locator("#effect-button").click();
      await page.getByText("Clicked", { exact: true }).waitFor();
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        ),
      );
      await page.locator("#effect-button").click();
      await page.getByText("Clicked", { exact: true }).waitFor();
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: false }),
        ),
      );
      await page.getByText("Stopped", { exact: true }).waitFor();
      await page.locator("#effect-button").click();
      assert.equal(
        await page.locator("#effect-output").textContent(),
        "Stopped",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
