import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { build } from "esbuild";

test("runner presentation resolves only a root-relative core against its trusted platform", async () => {
 const bundle = await build({stdin:{contents:'export {createAppHTML} from "./src/browser/surface.js";',resolveDir:process.cwd()},bundle:true,write:false,format:"iife",globalName:"surface"});
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage(); await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.route("https://platform.invalid/af/v1/core.js", route => route.fulfill({contentType:"application/javascript",body:"window.coreLoaded=true"}));
  await page.route("**/custom.js", route => route.fulfill({contentType:"application/javascript",body:""}));
  const result = await page.evaluate(() => {
   const source='<html><head><base href="https://untrusted.invalid/"><script defer src="/af/v1/core.js"></script><script src="/custom.js"></script></head><body></body></html>';
   const out=(globalThis as any).surface.createAppHTML(source,{revision:"immutable"},"",null,"https://platform.invalid");
   const doc=new DOMParser().parseFromString(out,"text/html");
   const absolute=(globalThis as any).surface.createAppHTML('<head><script src="https://other.invalid/af/v1/core.js"></script><script src="//other.invalid/af/v1/core.js"></script></head>',{revision:"immutable"},"",null,"https://platform.invalid");
   const preserved=[...new DOMParser().parseFromString(absolute,"text/html").querySelectorAll("script[src]")].map(s=>s.getAttribute("src"));
   const frame=document.createElement("iframe");frame.srcdoc=out;document.body.append(frame);
   return {preserved,scripts:[...doc.querySelectorAll("script[src]")].map(s=>s.getAttribute("src")),base:doc.querySelector("base"),defer:doc.querySelector("script[src]")!.hasAttribute("defer"),revision:JSON.parse(doc.querySelector("#pagegi-boot")!.textContent!).revision};
  });
  assert.deepEqual(result,{preserved:["https://other.invalid/af/v1/core.js","//other.invalid/af/v1/core.js"],scripts:["https://platform.invalid/af/v1/core.js","/custom.js"],base:null,defer:true,revision:"immutable"});
  const frame = await page.locator("iframe").elementHandle().then(el => el!.contentFrame());
  assert.ok(frame);
  await frame.waitForFunction("window.coreLoaded === true");
 } finally {await browser.close();}
});
