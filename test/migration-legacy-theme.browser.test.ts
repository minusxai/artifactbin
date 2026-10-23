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

test('complete archived design systems keep their original cascade and page ground when platform CSS loads',async()=>{
 const {archivedOutlineNavigation}=await import('../src/migration/conversion/compiled/outline-navigation.ts');
 const platform=await readFile(new URL('../skills/pagegi-author/design-systems/meridian.css',import.meta.url),'utf8');
 const original=':root:where([data-theme="ink"]){--background:#0f1b2d;--foreground:#e9eef7;background:var(--background);color:var(--foreground);font-family:serif}:root:where([data-theme="ink"]) .t-display-l{font-size:56px;font-weight:900}:root:where([data-theme="ink"]) .t-body{font:16px/24px serif}';
 const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<html class="dark" data-theme="ink" data-af-design-system="meridian" data-af-dark="true"><head><link data-af="design-system" rel="stylesheet" href="data:text/css;base64,'+Buffer.from(platform).toString('base64')+'"><style>'+original+'</style></head><body><div data-mx-inline-story><h1 class="t-display-l">Saved title</h1><p class="t-body">Saved copy</p></div>'+archivedOutlineNavigation+'</body></html>');
 const values=()=>page.evaluate(()=>({background:getComputedStyle(document.documentElement).backgroundColor,title:getComputedStyle(document.querySelector('h1')!).fontSize,weight:getComputedStyle(document.querySelector('h1')!).fontWeight,copy:getComputedStyle(document.querySelector('p')!).fontSize}));
 await page.screenshot();
 const expected={background:'rgb(15, 27, 45)',title:'56px',weight:'900',copy:'16px'};assert.deepEqual(await values(),expected);
 await page.evaluate(css=>{const link=document.createElement('link');link.rel='stylesheet';link.setAttribute('data-af','design-system');link.href='data:text/css;base64,'+btoa(css);document.head.append(link);},platform);
 await page.waitForTimeout(50);assert.deepEqual(await values(),expected);
 await page.evaluate(css=>{const style=document.createElement('style');style.setAttribute('data-af','design-system');style.textContent=css;document.head.append(style);},platform);
 await page.waitForTimeout(50);assert.deepEqual(await values(),expected);
 await page.evaluate(()=>document.documentElement.removeAttribute('data-af-dark'));
 await page.waitForFunction(()=>document.documentElement.classList.contains('light'));
 assert.deepEqual(await values(),expected);
 }finally{await browser.close();}
});
