import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{chromium}from'playwright';
import{isolateArchivedThemeVariables}from'../src/migration/conversion/compiled/legacy-theme.ts';
test('archived theme context survives actual platform CSS while authored story and descendant fonts remain authoritative',async()=>{
 const platform=await readFile(new URL('../skills/pagegi-author/design-systems/meridian.css',import.meta.url),'utf8');
 const source='[data-mx-inline-story].authored{font-family:monospace}:root{--foreground:#123456;--default-font-family:Georgia;--font-sans:Georgia}html,:host{font-family:var(--default-font-family,sans-serif)}.dark{--foreground:#abcdef}:root:where([data-theme="ink"]){--font-body:Cambria;font-family:var(--font-body)}.custom{font-family:serif}';
 const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<html data-af-design-system="meridian"><head><style>'+platform+'</style><style>'+isolateArchivedThemeVariables(source)+'</style></head><body><div id="normal" data-mx-inline-story><p id="copy">Saved</p><p id="custom" class="custom">Custom</p></div><div id="authored" data-mx-inline-story class="authored">Authored</div><div id="themed" data-mx-inline-story data-theme="ink">Theme</div></body></html>');
 const read=(selector:string,property:string)=>page.locator(selector).evaluate((el,p)=>getComputedStyle(el).getPropertyValue(p),property);
 assert.equal(await read('#normal','--foreground'),'#123456');assert.equal(await read('#copy','font-family'),'Georgia');assert.equal(await read('#custom','font-family'),'serif');assert.equal(await read('#authored','font-family'),'monospace');assert.equal(await read('#themed','font-family'),'Cambria');
 await page.locator('#normal').evaluate(el=>el.classList.add('dark'));assert.equal(await read('#normal','--foreground'),'#abcdef');
 // A viewer stylesheet arriving later still cannot replace locally declared source variables.
 await page.addStyleTag({content:platform});assert.equal(await read('#normal','--foreground'),'#abcdef');assert.equal(await read('#copy','font-family'),'Georgia');assert.equal(await read('#authored','font-family'),'monospace');
 }finally{await browser.close();}
});
