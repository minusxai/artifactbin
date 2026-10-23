// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {compileArchivedStatic} from '../src/migration/conversion/compiled/index.ts';
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('archived documents retain theme defaults, reading geometry and working contents navigation', {skip: !root}, async () => {
  const source = '<h1 id="title">Document title</h1><h2 id="first">First section</h2><div id="spacer" style={{height:"1800px"}}>Body</div><h2 id="second">Second section</h2><p id="copy">Saved text</p>';
  const result = await compileArchivedStatic({source, coreUrl:'/af/v1/core.js', template:'doc', theme:'terminal', colorMode:null}, {legacyRoot:root!});
  assert.equal(result.classification, 'renderable', JSON.stringify(result.issues));
  assert.equal(result.identities.second, 'second');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.route('**/af/v1/core.js', route=>route.fulfill({body:''}));
    await page.setContent(result.html!);
    assert.equal(await page.locator('html').getAttribute('class'),'dark');
    assert.equal(await page.locator('.mx-outline').isVisible(),true);
    const column=await page.locator('.mx-doc').boundingBox();
    assert.ok(column && column.width <= 816 && column.x > 0);
    await page.getByRole('button',{name:'Go to section 2: Second section',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.getElementById('second')!.getBoundingClientRect().top)<900);
    assert.equal(await page.locator('#second').getAttribute('data-af-id'),'second');
  } finally {await browser.close();}
});
