import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { build } from "esbuild";

test("bounded rendered snapshots retain dynamic rows and immutable multi-megabyte styles", async () => {
  const bundle = await build({ stdin: { contents: 'import * as replay from "./src/browser/replay.ts";import {createAppHTML} from "./src/browser/surface.js";globalThis.replay={...replay,createAppHTML};', resolveDir: process.cwd() }, bundle: true, write: false, format: "iife" });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const result = await page.evaluate(() => {
      const api = (globalThis as any).replay;
      const css = '/*' + 'font-data-'.repeat(310000) + '*/ .row{color:rgb(12, 34, 56)}';
      const source = `<html data-af-dark="true"><head><style media="screen">${css}</style></head><body><p>initial</p></body></html>`;
      const hosted = new DOMParser().parseFromString(api.createAppHTML(source,{revision:"saved-r"},""),"text/html");
      const boot = JSON.parse(hosted.querySelector('#pagegi-boot')!.textContent!);
      const doc = new DOMParser().parseFromString(source, "text/html");
      doc.body.innerHTML = '<table><tr class="row"><td>Historical dynamic row</td></tr></table><input value="saved"><script>throw Error("must not run")</script>';
      const changed = doc.createElement('style'); changed.textContent = '.row{background:yellow}'; doc.head.append(changed);
      const rendered = api.captureRenderedDocument(doc, boot.sourceStyles);
      if (!rendered) return { captured: false };
      const html = api.assembleStaticReplay(rendered, null, source);
      const replay = new DOMParser().parseFromString(html, 'text/html');
      const frame = api.mountStaticReplay(document.body, html);
      const malformed = JSON.stringify({format:'pagegi-source-styles-v1',html:'<style></style><p>untrusted</p>',styles:[[0,99999]]});
      const amplification = JSON.stringify({format:'pagegi-source-styles-v1',html:'<style></style><style></style><p>amplified</p>',styles:[[0,0],[1,0]]});
      const duplicate = JSON.stringify({format:'pagegi-source-styles-v1',html:'<style></style><p>duplicate</p>',styles:[[0,0],[0,0]]});
      return {amplification:api.assembleStaticReplay(amplification,null,source),duplicate:api.assembleStaticReplay(duplicate,null,source),missingSource:api.assembleStaticReplay(rendered),captured:true,sandbox:frame.getAttribute("sandbox"),media:replay.querySelector("style")!.media,size:rendered.length,text:replay.body.textContent,styles:[...replay.querySelectorAll('style')].map(s=>s.textContent),dark:replay.documentElement.dataset.afDark,scripts:replay.querySelectorAll('script').length,invalid:api.assembleStaticReplay(malformed,null,source),tooBig:api.captureRenderedDocument(new DOMParser().parseFromString('<p>'+ 'x'.repeat(200001)+'</p>','text/html'),[])};
    });
    assert.equal(result.captured, true);
    assert.ok(result.size! <= 200000);
    assert.match(result.text!, /Historical dynamic row/);
    assert.ok(result.styles![0]!.length > 3000000);
    assert.equal(result.styles![1], '.row{background:yellow}');
    assert.equal(result.dark, 'true');
    assert.equal(result.sandbox, '');
    assert.equal(result.media, 'screen');
    assert.equal(result.scripts, 0);
    assert.doesNotMatch(result.invalid!, /untrusted/);
    assert.equal(result.tooBig, undefined);
    const replayFrame = await page.locator('iframe').elementHandle().then(el => el!.contentFrame());
    assert.ok(replayFrame);
    await replayFrame.waitForSelector('.row');
    assert.deepEqual(await replayFrame.locator('.row').evaluate(el => ({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})), {color:'rgb(12, 34, 56)',background:'rgb(255, 255, 0)'});
    assert.doesNotMatch(result.amplification!, /amplified/);
    assert.doesNotMatch(result.duplicate!, /duplicate/);
    assert.doesNotMatch(result.missingSource!, /Historical dynamic row/);
  } finally { await browser.close(); }
});

test("hosted bridge reports compact captures after author-rendered rows change", async () => {
  const [surface, bridge] = await Promise.all([
    build({ stdin: { contents: 'export {createAppHTML} from "./src/browser/surface.js";', resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", globalName: "surface" }),
    build({ entryPoints: ['src/browser/bridge.js'], bundle: true, write: false, format: 'iife' }),
  ]);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({content:surface.outputFiles[0]!.text});
    await page.evaluate((bridge) => {
      (globalThis as any).captures = [];
      addEventListener('message', e => { if(e.data?.kind === 'view') (globalThis as any).captures.push(e.data.snapshot); });
      const css = '/*'+ 'fonts'.repeat(610000)+'*/td{color:green}';
      const source = `<style>${css}</style><table><tbody id="rows"></tbody></table><script>document.getElementById("rows").innerHTML="<tr><td>Rendered dataset row</td></tr>"</script>`;
      const frame = document.createElement('iframe');
      frame.srcdoc = (globalThis as any).surface.createAppHTML(source,{revision:'historical-r',channel:'test'},bridge);
      document.body.append(frame);
    }, bridge.outputFiles[0]!.text);
    await page.waitForFunction(() => (globalThis as any).captures.some((s:any) => s.rendered?.includes('Rendered dataset row')));
    const snapshot = await page.evaluate(() => (globalThis as any).captures.find((s:any) => s.rendered?.includes('Rendered dataset row')));
    assert.equal(snapshot.sourceRevision, 'historical-r');
    assert.ok(snapshot.rendered.length <= 200000);
    assert.equal(JSON.parse(snapshot.rendered).format, 'pagegi-source-styles-v1');
  } finally { await browser.close(); }
});
