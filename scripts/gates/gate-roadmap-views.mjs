import { artifactDocument } from './lib/artifact-document.mjs';
import assert from 'node:assert/strict';
import { launchChromium } from './lib/browser.mjs';
import { createEditableTableFixture } from './lib/editable-table-fixture.mjs';
import { startDocument, becomeOwner } from '../lib/start-doc.mjs';
const base = process.argv[2] ?? 'http://localhost:3030';
const rows = Array.from({length:15}, (_,i) => ({id:i+1,item:`Task ${i+1}`,owner:'TBD',hours:2,depends_on:i===1 || i===2 ? '["1"]' : '[]',tags:'[]',status:'backlog',sprint:''}));
const fixture = await createEditableTableFixture(base, 15, {workspace:true,rows,seed:await startDocument(base)});
console.log(`roadmap workspace: ${fixture.url}`);
const browser = await launchChromium();
/** Checks that fail without stopping the walk, so every later check still runs; reported together at the end. */
const failures = [];
try {
  const ownerPage = await browser.newPage({viewport:{width:1450,height:950}});
  ownerPage.on('pageerror', error => console.error(error.message));
  await becomeOwner(ownerPage,base,fixture.token);
  await ownerPage.goto(fixture.url);
  // The document is framed by the app page on its own origin: every check on the document runs in that frame.
  let page = await artifactDocument(ownerPage);
  const switchView = async name => {
    await page.getByLabel('View', {exact:true}).click();
    await page.getByRole('option',{name,exact:true}).click();
  };
  await page.getByLabel('View',{exact:true}).waitFor({timeout:5000});
  await page.getByLabel('Item 1',{exact:true}).waitFor();
  assert.ok(await page.getByLabel('Item 1',{exact:true}).evaluate(el=>el.closest('tr').getBoundingClientRect().height<=48));
  await switchView('DAG');
  await page.locator('#view-dag svg.marks, #view-dag canvas').first().waitFor();
  await page.locator('#view-dag [aria-label="Dependency 1 → 3"]').first().waitFor({timeout:3000});
  assert.equal(await page.getByLabel('Item 1',{exact:true}).isVisible(),false);
  await switchView('Sprint');
  // The link the reader copies, the app page's address, says what they narrowed the document to (lib/islands/url-sync).
  const linked = await ownerPage.waitForFunction(()=>new URLSearchParams(location.search).get('$view_mode')==='sprint',null,{timeout:5000}).then(()=>true,()=>false);
  if (!linked) failures.push(`the app page's address carries the view the reader chose ($view_mode=sprint): saw ${JSON.stringify(await ownerPage.evaluate(()=>location.search))}, the frame's ${JSON.stringify(await page.evaluate(()=>location.search))}`);
  await page.locator('#view-sprint').getByLabel('Add Sprint',{exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add sprint'});
  await dialog.waitFor();
  await page.getByLabel('Sprint name',{exact:true}).fill('Planning week');
  await page.getByLabel('Sprint deadline',{exact:true}).fill('2026-09-14');
  await page.getByLabel('Create sprint',{exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('#view-sprint').getByText('Planning week',{exact:true}).waitFor();
  await page.locator('#view-sprint').getByLabel('Add Sprint',{exact:true}).click();
  await page.getByLabel('Sprint name',{exact:true}).fill(' planning WEEK ');
  await page.getByLabel('Create sprint',{exact:true}).click();
  let refusal='';
  for(let attempt=0;attempt<40&&!refusal;attempt++){
    refusal=await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? '');
    if(!refusal)await page.waitForTimeout(250);
  }
  assert.match(refusal,/affected|changed|mutation/i,`missing refusal: ${await dialog.textContent()}`);
  assert.equal(await dialog.isVisible(),true);
  await page.getByLabel('Cancel sprint',{exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await switchView('Table');
  await ownerPage.waitForFunction(()=>new URLSearchParams(location.search).get('$view_mode')!=='sprint');
  await page.getByLabel('Sprint 1',{exact:true}).click();
  await page.getByRole('option',{name:'Planning week',exact:true}).waitFor();
  await page.locator('[data-return-label="Sprint 1"]').click();
  await dialog.waitFor();
  await page.getByLabel('Sprint name',{exact:true}).fill('Quick sprint');
  await page.getByLabel('Create sprint',{exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByLabel('Sprint 1',{exact:true}).click();
  await page.getByRole('option',{name:'Quick sprint',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="Sprint 1"]')?.textContent.includes('Quick sprint'));
  let persisted;
  for(let attempt=0;attempt<100;attempt++){
    persisted=await fixture.api(`/api/artifacts/${fixture.datasetId}`,undefined,'GET');
    if(persisted.rows.find(row=>row.id===1)?.sprint==='Quick sprint')break;
    await ownerPage.waitForTimeout(50);
  }
  assert.equal(persisted?.rows.find(row=>row.id===1)?.sprint,'Quick sprint','sprint assignment persisted before reload');
  await ownerPage.reload({waitUntil:'load'});
  page = await artifactDocument(ownerPage);
  await page.getByLabel('Item 1',{exact:true}).waitFor({timeout:20_000});
  await page.getByRole('button',{name:'Sprint 1',exact:true}).filter({hasText:'Quick sprint'}).waitFor({timeout:20_000});
  await ownerPage.setViewportSize({width:390,height:844});
  await page.getByLabel('View',{exact:true}).click();
  const popup=page.getByRole('listbox').locator('..');
  const box=await popup.boundingBox();
  assert.ok(box && box.x>=0 && box.x+box.width<=390 && box.y>=0 && box.y+box.height<=844);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('option',{name:'Sprint',exact:true}).click();
  await page.locator('#view-sprint').getByLabel('Add Sprint',{exact:true}).click();
  const modalBox=await page.getByRole('dialog',{name:'Add sprint'}).boundingBox();
  assert.ok(modalBox && modalBox.x>=0 && modalBox.x+modalBox.width<=390);
  await ownerPage.keyboard.press('Escape');
  await page.getByRole('dialog',{name:'Add sprint'}).waitFor({state:'hidden'});
  if (failures.length) throw new Error(`roadmap-views: ${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`);
  console.log('all good: views, Vega DAG, shared sprint modal, dropdown action, compact rows and narrow layout');
} finally { await browser.close(); }
