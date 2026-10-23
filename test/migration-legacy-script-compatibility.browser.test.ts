// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createMigrationConverter } from "../src/migration/convert.ts";
const legacyRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test("legacy params effects and exact classic date library preserve mounted readable controls", { skip: !legacyRoot }, async () => {
  const convert = createMigrationConverter({ strategy: "archived-functional", sourceAdmission: "offline-prototype", legacyRoot: legacyRoot! });
  const fixtures = [
    '<Helmet><Value name="count" type="number" default={0}/><script>{`function show(v){document.getElementById("readout").textContent=String(v.count)};show({count:mx.params.get("count")});mx.params.subscribe(show);document.getElementById("increment").onclick=()=>mx.params.set("count",mx.params.get("count")+1);`}</script></Helmet><p id="readout">Saved layout</p><button id="increment">Increment</button>',
    '<Helmet><Value name="count" type="number" default={0}/></Helmet><Iframe id="frame"><p id="readout">Saved layout</p><button id="increment">Increment</button><script src="https://cdnjs.cloudflare.com/ajax/libs/dayjs/1.11.13/dayjs.min.js"/><script>{`await new Promise(resolve=>setTimeout(resolve,10));function show(v){document.getElementById("readout").textContent=dayjs("2026-01-02").format("YYYY")+":"+v.count};show({count:mx.params.get("count")});mx.params.subscribe(["count"],show);document.getElementById("increment").onclick=()=>mx.params.set("count",mx.params.get("count")+1);`}</script></Iframe>',
  ];
  const core = (await build({entryPoints:["src/browser/core/core.ts"],bundle:true,write:false,format:"iife",target:"es2022",minify:true})).outputFiles[0]!.text;
  let html:string|null=null;
  const server=createServer((req,res)=>res.writeHead(200,{"content-type":req.url==="/af/v1/core.js"?"text/javascript":"text/html"}).end(req.url==="/af/v1/core.js"?core:html));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch();
  try {
    for(const [index,source] of fixtures.entries()) {
      const result=await convert({source,coreUrl:"/af/v1/core.js"});
      assert.equal(result.classification,"functional",JSON.stringify(result.issues));
      assert.equal(result.sourceNormalization?.kind,index?"original-managed-frame-codemod":"original-scalar-params-codemod");
      if(index)assert.equal(result.sourceNormalization?.dayjs?.version,"1.11.13");
      html=result.html;
      const page=await browser.newPage();const errors:string[]=[];const external:string[]=[];
      page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{const u=new URL(r.url());if(["http:","https:"].includes(u.protocol)&&u.hostname!=="127.0.0.1")external.push(r.url());});
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);
      await page.waitForFunction(expected=>document.getElementById("readout")?.textContent===expected,index?"2026:0":"0");
      await page.locator("#increment").click();
      await page.waitForFunction(expected=>document.getElementById("readout")?.textContent===expected,index?"2026:1":"1");
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      await page.close();
    }
  } finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
