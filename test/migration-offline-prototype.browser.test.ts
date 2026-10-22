// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "offline prototype packed compiler preserves native scalar controls and viewer state on reload",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        source:
          '<Helmet><Value name="mode" type="string" default="a"/><Value name="enabled" type="boolean" default={false}/><Value name="amount" type="number" default={2}/></Helmet><Segmented id="segments" value="$mode" options={["a","b"]}/><Switch id="switch" checked="$enabled" label="Enabled"/><Slider id="slider" value="$amount" min={0} max={10} step={1} label="Amount"/><p id="selected">{$mode}</p><p id="amount">{$amount}</p>',
        coreUrl: "/af/v1/core.js",
      },
      { legacyRoot: root!, sourceAdmission:"offline-prototype" },
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
      else
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(result.html);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (
          ["http:", "https:"].includes(u.protocol) &&
          u.hostname !== "127.0.0.1"
        )
          external.push(r.url());
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      await page
        .locator("#segments")
        .getByRole("button", { name: "b", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#selected")?.textContent === "b",
      );
      await page.getByRole("switch", { name: "Enabled" }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="switch"]')
            ?.getAttribute("aria-checked") === "true",
      );
      await page
        .getByRole("slider", { name: "Amount" })
        .evaluate((input: HTMLInputElement) => {
          input.value = "7";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await page.waitForFunction(
        () => document.querySelector("#amount")?.textContent === "7",
      );
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#selected")?.textContent === "b" &&
          document.querySelector("#amount")?.textContent === "7" &&
          document
            .querySelector('[role="switch"]')
            ?.getAttribute("aria-checked") === "true",
      );
      assert.equal(
        await page.getByRole("slider", { name: "Amount" }).inputValue(),
        "7",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);
test('offline prototype executes archived browser effects through the packaged module',{skip:!root},async()=>{
 const {compileArchivedAuthor}=await import('../src/migration/conversion/compiled/local.ts');
 const script='window.addEventListener("click",()=>document.querySelector("#effect").textContent="Clicked");document.querySelector("#effect").textContent="Started";';
 const result=await compileArchivedAuthor({source:'<Helmet><script>{'+JSON.stringify(script)+'}</script></Helmet><button id="effect">Pending</button>',coreUrl:'/af/v1/core.js'},{legacyRoot:root!,sourceAdmission:'offline-prototype'});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 const core=await readFile(new URL('../dist/core.js',import.meta.url),'utf8');
 const server=createServer((req,res)=>res.writeHead(200,{'content-type':req.url==='/af/v1/core.js'?'text/javascript':'text/html'}).end(req.url==='/af/v1/core.js'?core:result.html));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);await page.getByRole('button',{name:'Started',exact:true}).click();await page.getByRole('button',{name:'Clicked',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Started',exact:true}).waitFor();assert.deepEqual(errors,[]);}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
