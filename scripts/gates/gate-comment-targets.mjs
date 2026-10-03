/** Real app acceptance for durable comment targets across declarative content: keyed repeats, tables, unkeyed lists. */
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { startDocument, becomeOwner } from '../lib/start-doc.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { commentTargetsMarkup } from '../fixtures/comment-targets.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const seed = await startDocument(base);
const headers = { Authorization: `Bearer ${seed.token}`, 'Content-Type': 'application/json' };
const published = await fetch(`${base}/api/artifacts/${seed.id}`, {
  method:'PUT',headers,body:JSON.stringify({title:'Dynamic comment acceptance',markup:commentTargetsMarkup,visibility:'unlisted'}),
});
assert(published.ok, `publish: ${published.status} ${await published.text()}`);
const annotations = async () => {
  const response=await fetch(`${base}/api/artifacts/${seed.id}/annotations`,{headers});
  assert(response.ok, `annotations: ${response.status}`);
  return (await response.json()).annotations;
};

const browser = await chromium.launch();
try {
  const context=await browser.newContext({viewport:{width:1280,height:960}});
  const page=await context.newPage();
  // This gate exercises anchoring. Capture itself is exercised by screenshot-comments.
  await page.addInitScript(()=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'setCaptureHandleConfig',{value:undefined});});
  page.on('response',async response=>{if(response.status()>=400&&response.url().includes('/annotations'))console.error('Annotation request failed:',response.status(),await response.text());});
  await becomeOwner(page,base,seed.token);
  await page.goto(`${base}/a/${seed.id}`);
  const cardText=page.locator('p[data-mx-comment-owner="order-cards"]').filter({hasText:'Alice Chen'}).first();
  await cardText.waitFor();
  await openArtifactControls(page);
  await page.getByRole('button',{name:'Toggle comments',exact:true}).click();
  await page.getByLabel('Annotation sidebar',{exact:true}).waitFor();
  const select=async()=>{
    if(await page.getByRole('button',{name:'Select',exact:true}).count()===0){
      await openArtifactControls(page);
      await page.getByRole('button',{name:'Toggle comments',exact:true}).click();
    }
    const button=page.getByRole('button',{name:'Select',exact:true});
    if(await button.getAttribute('aria-pressed')!=='true')await button.click();
  };
  const save=async(body)=>{
    await page.getByRole('dialog',{name:'Annotation composer',exact:true}).waitFor();
    const fallback=page.getByRole('button',{name:'Continue without screenshot',exact:true});
    if(await fallback.isVisible())await fallback.click();
    await page.getByLabel('Annotation comment',{exact:true}).fill(body);
    await page.getByRole('button',{name:'Save annotation',exact:true}).click();
    await page.getByLabel('Annotation composer',{exact:true}).waitFor({state:'hidden'});
    // Leave the resumed tool before testing ordinary document interactions.
    const cancelPick=page.getByRole('button',{name:'Cancel picking',exact:true});
    if(await cancelPick.isVisible())await cancelPick.click();
  };
  await select();await cardText.click();await save('Keep this comment on the repeated customer');
  let stored=await annotations();
  const repeatComment=stored.find(item=>item.thread[0].body==='Keep this comment on the repeated customer');
  assert.equal(repeatComment.anchor.nodeId,'order-cards');
  assert.equal(repeatComment.range.target.kind,'repeat');
  assert.equal(repeatComment.range.target.scopes[0].key,'order-101');
  await page.getByRole('button',{name:'Reverse JSX rows',exact:true}).click();
  await page.getByRole('button',{name:'Rename JSX Alice',exact:true}).click();
  await cardText.filter({hasText:'updated'}).waitFor();
  await cardText.and(page.locator('[data-mx-annotated]')).waitFor({ timeout: 10000 }).catch(async error => {
    console.error('Compiled repeat pin state:', JSON.stringify({
      stored: repeatComment.range.target,
      cards: await page.locator('[data-mx-comment-owner="order-cards"]').evaluateAll(nodes => nodes.map(node => ({
        text: node.textContent, target: node.getAttribute('data-mx-comment-target'), annotated: node.hasAttribute('data-mx-annotated'),
      }))),
      owner: await page.locator('#order-cards').getAttribute('data-mx-annotated'),
    }));
    throw error;
  });

  const cell=page.locator('td[data-mx-comment-owner="order-table"]').filter({hasText:'Alice Chen'}).first();
  await select();await cell.click();await save('Keep this comment on the table customer');
  stored=await annotations();
  const tableComment=stored.find(item=>item.thread[0].body==='Keep this comment on the table customer');
  if (tableComment?.range.target.rowKey !== 'order-101') console.error('Compiled table target state:', JSON.stringify({
    stored: tableComment?.range.target,
    cells: await page.locator('td[data-mx-comment-owner="order-table"]').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent, target: node.getAttribute('data-mx-comment-target'), annotated: node.hasAttribute('data-mx-annotated'),
    }))),
  }));
  assert.equal(tableComment.anchor.nodeId,'order-table');
  assert.deepEqual(tableComment.range.target,{kind:'table',rowKey:'order-101',columnKey:'customer'});
  await page.getByRole('button',{name:'Remove JSX Alice',exact:true}).click();
  await cell.waitFor({state:'detached'}).catch(async error => {
    console.error('Compiled removed row state:', JSON.stringify({
      cells: await page.locator('td[data-mx-comment-owner="order-table"]').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, target: node.getAttribute('data-mx-comment-target') }))),
      cards: await page.locator('p[data-mx-comment-owner="order-cards"]').allTextContents(),
      errors: await page.getByRole('alert').allTextContents(),
      remove: await page.getByRole('button',{name:'Remove JSX Alice',exact:true}).evaluate(node => ({ disabled: node.disabled, busy: node.getAttribute('aria-busy'), reason: node.getAttribute('aria-description') })),
    }));
    throw error;
  });
  await page.getByRole('button',{name:'Restore JSX Alice',exact:true}).click();
  await cell.and(page.locator('[data-mx-annotated]')).waitFor();
  assert.equal((await annotations()).find(item=>item.id===tableComment.id).anchor.nodeId,'order-table');
  console.log('PASS For and DataTable target identity after sorting, updates, removal and restoration');

  await page.reload();
  await page.locator('td[data-mx-comment-owner="order-table"][data-mx-annotated]').filter({hasText:'Alice Chen'}).waitFor();
  await cardText.and(page.locator('[data-mx-annotated]')).waitFor();
  assert.equal((await annotations()).length,2);
  console.log('PASS persisted comments reconnect after a fresh launch');
  // A saved markup comment must not steal the first click of a word selection.
  await cardText.click();
  await expect(page.getByLabel('Reply to annotation',{exact:true})).toHaveCount(0);
  await expect(cardText).not.toHaveCSS('cursor','pointer');
  await cardText.dblclick({position:{x:15,y:8}});
  await expect(page.getByLabel('Reply to annotation',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Comment on selected text',exact:true}).click();
  await save('Different words on an already commented markup node');
  await cardText.evaluate(node=>node.ownerDocument.defaultView.getSelection().removeAllRanges());


  // Real pointer drag over a static node, then ensure the composer remains above app content.
  const intro=page.locator('#intro');
  await select();
  await page.getByRole('button',{name:'Screenshot',exact:true}).click();
  await expect(page.getByRole('status',{name:'Screenshot tool active'})).toHaveText(/drag an area/);
  await intro.scrollIntoViewIfNeeded();
  const bounds=await intro.boundingBox();assert(bounds);
  await page.mouse.move(bounds.x+4,bounds.y+4);await page.mouse.down();
  await page.mouse.move(bounds.x+Math.min(120,bounds.width-4),bounds.y+Math.min(20,bounds.height-2),{steps:8});
  await page.mouse.up();
  const composer=page.getByLabel('Annotation composer',{exact:true});await composer.waitFor();
  assert(await composer.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(el.getRootNode().elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await save('A drawn markup area');
  const areaComment=(await annotations()).find(item=>item.thread[0].body==='A drawn markup area');
  assert.equal(areaComment.range.kind,'area');
  console.log('PASS area selection with parent composer layering');
  if(await page.getByRole('button',{name:'Close comments',exact:true}).isVisible())await page.getByRole('button',{name:'Close comments',exact:true}).click();

  const unkeyed=page.locator('#index-cards');
  const unkeyedAlice=unkeyed.locator('p').filter({hasText:'Alice Chen'}).first();
  await select();await unkeyedAlice.click();await save('Unkeyed list owner comment');
  let ownerComment=(await annotations()).find(item=>item.thread[0].body==='Unkeyed list owner comment');
  assert.equal(ownerComment.anchor.nodeId,'index-cards');assert.equal(ownerComment.range,null);
  // Wait for the re-run to redraw the rows: a selection made before it lands is on text it replaces.
  const unkeyedOrder=()=>unkeyed.locator('p').allTextContents();
  const orderBefore=await unkeyedOrder();
  await page.getByRole('button',{name:'Reverse JSX rows',exact:true}).click();
  await expect.poll(unkeyedOrder).not.toEqual(orderBefore);
  await expect(unkeyed).toHaveAttribute('data-mx-annotated','');
  await expect(unkeyed.locator('[data-mx-comment-target], [data-mx-annotated]')).toHaveCount(0);
  await unkeyedAlice.dblclick({position:{x:25,y:20}});
  await page.getByRole('button',{name:'Comment on selected text',exact:true}).click();
  await save('Unkeyed words retain only their list owner');
  ownerComment=(await annotations()).find(item=>item.thread[0].body==='Unkeyed words retain only their list owner');
  assert.equal(ownerComment.anchor.nodeId,'index-cards');assert.equal(ownerComment.range,null);assert(ownerComment.quote);
  await select();
  await page.getByRole('button',{name:'Screenshot',exact:true}).click();
  await expect(page.getByRole('status',{name:'Screenshot tool active'})).toHaveText(/drag an area/);
  await unkeyedAlice.scrollIntoViewIfNeeded();
  const unkeyedBox=await unkeyedAlice.boundingBox();assert(unkeyedBox);
  await page.mouse.move(unkeyedBox.x+3,unkeyedBox.y+3);await page.mouse.down();
  await page.mouse.move(unkeyedBox.x+80,unkeyedBox.y+25,{steps:8});await page.mouse.up();
  await save('Unkeyed area retains only its list owner');
  ownerComment=(await annotations()).find(item=>item.thread[0].body==='Unkeyed area retains only its list owner');
  assert.equal(ownerComment.anchor.nodeId,'index-cards');assert.equal(ownerComment.range,null);
  await page.reload();await expect(page.locator('#index-cards')).toHaveAttribute('data-mx-annotated','');
  await expect(page.locator('#index-cards [data-mx-comment-target], #index-cards [data-mx-annotated]')).toHaveCount(0);
  console.log('PASS optional For keys render by index and persist only owner-level comments across reorder/reload');

  await context.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const phone=await mobile.newPage();await becomeOwner(phone,base,seed.token);await phone.goto(`${base}/a/${seed.id}`);
  const heading=phone.locator('#rows-heading');await heading.waitFor();
  await openArtifactControls(phone);await phone.getByRole('button',{name:'Toggle comments',exact:true}).tap();
  await phone.getByRole('button',{name:'Select',exact:true}).tap();
  await phone.getByLabel('Annotation sidebar',{exact:true}).waitFor({state:'hidden'});
  await heading.tap();
  await phone.getByLabel('Annotation comment',{exact:true}).fill('A markup block selected by touch');
  await expect(phone.getByRole('button',{name:'Continue without screenshot',exact:true})).toHaveCount(0);
  await phone.getByRole('button',{name:'Save annotation',exact:true}).tap();
  await phone.getByLabel('Annotation composer',{exact:true}).waitFor({state:'hidden'});
  const mobileComment=(await annotations()).find(item=>item.thread[0].body==='A markup block selected by touch');
  assert.equal(mobileComment.anchor.nodeId,'rows-heading');
  console.log('PASS mobile tap Select');
  await mobile.close();
} finally { await browser.close(); }
