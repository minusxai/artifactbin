// @requires archived-compiler
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('compiled deck keeps real navigation, canonical state, layout and anchors',{skip:!root},async()=>{
 const result=await compileArchivedLocal({source:'<Helmet><Value name="n" type="number" default={1}/></Helmet><SlideDeck id="deck"><Slide id="one" title="First" className="min-h-screen"><h1>First</h1><Button id="add" set={{n:2}}>Add</Button><p id="value">{$n}</p><Input id="input" value="$n"/></Slide><Slide id="two" className="min-h-screen"><h2>Second</h2><a id="back" href="#one">Back</a></Slide></SlideDeck>',coreUrl:'/af/v1/core.js'},{legacyRoot:root!});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));assert.ok(result.html);
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

      await page.waitForFunction(()=>document.documentElement.hasAttribute('data-mx-ready'),undefined,{timeout:5000}).catch(e=>{assert.deepEqual(errors,[]);throw e;});
      assert.equal(await page.locator('.mx-rail-row').count(),2);
      assert.equal(await page.locator('#one').getAttribute('data-af-id'),'one');
      assert.ok(await page.locator('.mx-rail').evaluate(e=>e.getBoundingClientRect().width)>100);
      await page.locator('#add').click();
      await page.waitForFunction(()=>document.querySelector('#value')?.textContent==='2');
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.mx-rail p')).some(e=>e.textContent==='2'));
      await page.locator('#input').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('.mx-present-count').textContent(),'1 / 2');
      await page.locator('#input').blur();
      await page.keyboard.press('PageDown');
      await page.waitForFunction(()=>document.querySelector('.mx-present-count')?.textContent==='2 / 2');
      await page.getByRole('button',{name:'Previous slide',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.mx-present-count')?.textContent==='1 / 2');
      await page.getByRole('button',{name:'Go to slide 2: Second',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.mx-present-count')?.textContent==='2 / 2');
      await page.locator('#back').click();
      await page.waitForFunction(()=>location.hash==='#one');
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#value')?.textContent==='2');
      assert.equal(new URL(page.url()).hash,'#one');
      await page.getByRole('button',{name:'Present',exact:true}).click();
      await page.waitForFunction(()=>!!document.fullscreenElement);
      await page.getByRole('button',{name:'Exit presentation',exact:true}).click();
      await page.waitForFunction(()=>!document.fullscreenElement);
      await page.setViewportSize({width:600,height:800});
      assert.equal(await page.locator('.mx-rail').isVisible(),false);
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
