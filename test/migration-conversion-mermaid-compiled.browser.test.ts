// @requires archived-compiler
import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('whole compiled Mermaid uses measured page fonts and switches themes without an engine or network',{skip:!root},async()=>{
 const result=await compileArchivedLocal({source:'<SlideDeck id="deck"><Slide id="first" title="Flow"><Mermaid id="diagram" code="flowchart LR; A[Start]--&gt;B[Finish]" title="Flow"/></Slide><Slide id="second" title="Second"><p>End</p></Slide></SlideDeck>',coreUrl:'/af/v1/core.js'},{legacyRoot:root!});assert.equal(result.classification,'functional',JSON.stringify(result.issues));assert.ok(result.html);
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

      await page.waitForFunction(()=>document.querySelector('#diagram')?.getAttribute('data-mx-mermaid-state')==='ready');
      assert.equal(await page.locator('#diagram').getAttribute('data-af-id'),'diagram');
      assert.equal(await page.locator('#diagram svg').count(),1);
      assert.match(await page.locator('#diagram').textContent()??'',/Start/);
      const before=await page.locator('#diagram svg').evaluate(e=>e.outerHTML);
      await page.evaluate(()=>{const root=document.querySelector('[data-mx-inline-story]')??document.documentElement;root.classList.remove('light');root.classList.add('dark');});
      await page.waitForFunction(()=>document.querySelector('#diagram')?.getAttribute('data-mx-mermaid-state')==='ready');
      await page.waitForFunction(before=>document.querySelector('#diagram svg')?.outerHTML!==before,before);
      assert.equal(await page.locator('#diagram [role="alert"]').count(),0);
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#diagram')?.getAttribute('data-mx-mermaid-state')==='ready');
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
