// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedAuthor } from "../src/migration/conversion/compiled/local.ts";
const legacyRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test("historical authored layout mounts and reports refused writes without remote requests", { skip: !legacyRoot }, async () => {
  const script = 'import {mutation} from "page";import {createSignal} from "solid-js";export function Editor(){const save=mutation("$save");const [status,setStatus]=createSignal("Saved editor layout");return <section><p id="result">{status()}</p><button id="save" onClick={async()=>{try{await save({title:"one"});setStatus("Unexpected commit");}catch{setStatus("Historical write unavailable");}}}>Save</button></section>}';
  const source = '<Helmet><Import name="items" src="ref:Abcd12"/><Query name="rows">{`select title from items.rows`}</Query><Mutation name="save">{`insert into items.rows(title) values($title)`}</Mutation><script type="module">{'+JSON.stringify(script)+'}</script></Helmet><h1>Saved report</h1><Editor id="editor"/>';
  const result = await compileArchivedAuthor({ source, coreUrl: "/af/v1/core.js", datasetUnavailable: { reason: "historical-binding-unavailable" } }, { legacyRoot: legacyRoot!, sourceAdmission: "offline-prototype" });
  assert.equal(result.classification, "renderable", JSON.stringify(result.issues));
  const core = (await build({ entryPoints: ["src/browser/core/core.ts"], bundle: true, write: false, format: "iife", target: "es2022", minify: true })).outputFiles[0]!.text;
  const server = createServer((req,res)=>res.writeHead(200,{"content-type":req.url==="/af/v1/core.js"?"text/javascript":"text/html"}).end(req.url==="/af/v1/core.js"?core:result.html));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();const errors:string[]=[];const requests:string[]=[];
    page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{const u=new URL(r.url());if(u.protocol==="http:"||u.protocol==="https:")requests.push(u.pathname);});
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);
    await page.getByText("Saved editor layout",{exact:true}).waitFor();
    await page.locator("#save").click();
    await page.getByText("Historical write unavailable",{exact:true}).waitFor();
    assert.equal(await page.locator('[data-migration-author-status]').isVisible(),false);
    assert.deepEqual(errors,[]);
    assert.deepEqual(requests.sort(),["/af/v1/core.js","/af/v1/design-systems/meridian.css","/proof"]);
  } finally {
    await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
