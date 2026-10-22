import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { compileAuthorScript } from "../src/migration/conversion/compiled/author/compiler.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "owned exported modules initialize once and retire conditional/component listeners with original shared callback semantics",
  { skip: !archivedRoot },
  async () => {
    const source = `import {createSignal,Show,onCleanup} from 'solid-js';
 const out=document.getElementById('stats');out.dataset.starts=String(Number(out.dataset.starts||0)+1);
 const [shared,setShared]=createSignal(0);const common=()=>out.dataset.common=String(Number(out.dataset.common||0)+1);
 function Child(){window.addEventListener('scroll',common);window.addEventListener('scroll',()=>out.dataset.child=String(Number(out.dataset.child||0)+1));onCleanup(()=>out.dataset.childStops=String(Number(out.dataset.childStops||0)+1));return <span>Child</span>;}
 export function First(){const [visible,setVisible]=createSignal(true);return <div><button id="toggle" onClick={()=>setVisible(!visible())}>Toggle</button><button id="increment" onClick={()=>setShared(shared()+1)}>Increment</button><Show when={visible()}><Child/></Show><p class="shared">{shared()}</p></div>;}
 export function Second(){window.addEventListener('scroll',common);return <p class="shared">{shared()}</p>;}`;
    const compiled = await compileAuthorScript(
      source,
      { values: [], queries: [], mutations: [] },
      { archivedRoot: archivedRoot!, lifecycle: "owned" },
    );
    const failed = await compileAuthorScript(
      `window.addEventListener('scroll',()=>document.getElementById('stats').dataset.leak='yes');throw Error('initializer');export function Failed(){return <p/>;}`,
      { values: [], queries: [], mutations: [] },
      { archivedRoot: archivedRoot!, lifecycle: "owned" },
    );
    const html = `<!doctype html><p id="stats"></p><main id="first"></main><main id="second"></main><script type="module">import{createAuthorModule}from'/module.js';import{createAuthorModule as failing}from'/failed.js';const ports={state:{read:()=>undefined,write(){},subscribe:()=>()=>{}},query(){throw Error('undeclared')}};const controller=new AbortController();window.stop=await createAuthorModule().mount(ports,[{element:document.getElementById('first'),identity:'a',component:'First'},{element:document.getElementById('second'),identity:'b',component:'Second'}],{signal:controller.signal});try{await failing().mount(ports,[]);}catch{}window.makeAnother=async()=>createAuthorModule().mount(ports,[{element:document.getElementById('second'),identity:'c',component:'Second'}]);window.ready=true;</script>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url?.endsWith(".js") ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/module.js"
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
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page.waitForFunction(() => Boolean((window as any).ready));
      assert.equal(
        await page.locator("#stats").getAttribute("data-starts"),
        "1",
      );
      await page.locator("#increment").click();
      assert.deepEqual(await page.locator(".shared").allTextContents(), [
        "1",
        "1",
      ]);
      await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
      assert.equal(
        await page.locator("#stats").getAttribute("data-common"),
        "1",
      );
      assert.equal(
        await page.locator("#stats").getAttribute("data-child"),
        "1",
      );
      await page.locator("#toggle").click();
      await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
      assert.equal(
        await page.locator("#stats").getAttribute("data-child"),
        "1",
      );
      assert.equal(
        await page.locator("#stats").getAttribute("data-child-stops"),
        "1",
      );
      await page.locator("#toggle").click();
      await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
      assert.equal(
        await page.locator("#stats").getAttribute("data-child"),
        "2",
      );
      await page.evaluate(() => {
        (window as any).stop();
        window.dispatchEvent(new Event("scroll"));
      });
      assert.equal(
        await page.locator("#stats").getAttribute("data-common"),
        "2",
      );
      assert.equal(
        await page.locator("#stats").getAttribute("data-child"),
        "2",
      );
      assert.equal(
        await page.locator("#stats").getAttribute("data-child-stops"),
        "2",
      );
      await page.evaluate(async () => {
        (window as any).secondStop = await (window as any).makeAnother();
      });
      assert.equal(
        await page.locator("#stats").getAttribute("data-starts"),
        "2",
      );
      assert.equal(await page.locator("#second .shared").textContent(), "0");
      await page.evaluate(() => {
        window.dispatchEvent(new Event("scroll"));
        (window as any).secondStop();
      });
      assert.equal(
        await page.locator("#stats").getAttribute("data-leak"),
        null,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
