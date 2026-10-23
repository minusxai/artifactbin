import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("saved migration recovery controls preserve content layout and retry only failures", async () => {
  const bundle = await build({ entryPoints: ['src/browser/core/core.ts'], bundle: true, write: false, format: "iife" });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:54999/**', route => route.fulfill({contentType:'text/html',body:'<html></html>'}));
    await page.goto('http://127.0.0.1:54999/');
    await page.setContent(`<style>body{margin:0;color:#eee;background:#0f1b2d;font:16px Arial}button{padding:0}</style><p role="status" data-migration-dataset-status data-af-id="status" hidden></p><button type="button">Refresh data</button><main data-af-id="content">Content</main><button type="button" data-af-id="author">Refresh data</button>`);
    const before = await page.locator('main').boundingBox();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const retry = page.locator('[data-migration-dataset-retry]');
    await retry.waitFor({ state: 'attached' });
    await retry.waitFor({ state: 'hidden' });
    assert.equal((await page.locator('main').boundingBox())!.y, 0);
    assert.ok(before!.y > 0);
    assert.equal(await page.locator('[data-af-id="author"]').getAttribute('style'), null);
    await page.evaluate(() => {
      const status = document.querySelector('p')!;
      status.textContent = 'Protected data is unavailable. Check access and refresh data.';
      status.hidden = false;
      document.querySelector('button')!.addEventListener('click', () => {
        status.textContent = 'Loading protected data…';
      });
    });
    await retry.waitFor({ state: 'visible' });
    assert.equal(await retry.evaluate(el => getComputedStyle(el).paddingTop), '6px');
    await retry.click();
    await retry.waitFor({ state: 'hidden' });
    await page.evaluate(() => { const status = document.querySelector('p')!; status.textContent='';status.hidden=true; });
    assert.equal((await page.locator('main').boundingBox())!.y, 0);
    // The generated boot may create its button after core has loaded.
    await page.evaluate(() => {
      document.querySelector('[data-migration-dataset-retry]')!.remove();
      const button=document.createElement('button');button.type='button';button.hidden=true;button.setAttribute('data-migration-dataset-retry','');button.textContent='Refresh data';
      document.querySelector('p')!.after(button);
    });
    await page.waitForFunction(() => document.querySelector('[data-migration-dataset-retry]')?.hasAttribute('hidden'));
    // A real unload disconnects the observer; a cached page remains active.
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}));
      const status=document.querySelector('p')!;status.textContent='Protected data queries could not be evaluated.';status.hidden=false;
    });
    await retry.waitFor({state:'visible'});
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', {persisted:false}));
      document.querySelector('p')!.textContent='';
    });
    await page.waitForTimeout(30);
    assert.equal(await retry.isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
