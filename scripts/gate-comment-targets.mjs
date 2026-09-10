/** Real app acceptance for durable targets across managed and declarative content. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { startDocument, becomeOwner } from './lib/start-doc.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { commentTargetsMarkup } from './fixtures/comment-targets.mjs';

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
  page.on('response',async response=>{if(response.status()>=400&&response.url().includes('/annotations'))console.error('Annotation request failed:',response.status(),await response.text());});
  await becomeOwner(page,base,seed.token);
  await page.goto(`${base}/a/${seed.id}`);
  const realm=page.frameLocator('iframe[title="Dynamic comment playground"]').frameLocator('iframe');
  const alice=realm.locator('[data-comment-key="order-101"] [data-comment-key="customer"]');
  await alice.waitFor();
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
    await page.getByLabel('Annotation comment',{exact:true}).fill(body);
    await page.getByRole('button',{name:'Save annotation',exact:true}).click();
    await page.getByLabel('Annotation composer',{exact:true}).waitFor({state:'hidden'});
  };
  await select();
  await alice.hover();
  await alice.and(realm.locator('[data-mx-annotate-pick-hover]')).waitFor();
  await alice.click();
  await save('Keep this comment on iframe Alice');
  let stored=await annotations();
  const iframeComment=stored.find(item=>item.thread[0].body==='Keep this comment on iframe Alice');
  assert.equal(iframeComment.anchor.nodeId,'iframe-orders');
  assert.deepEqual(iframeComment.range.target,{kind:'iframe',node:{kind:'key',path:['order-101','customer']}});
  await alice.and(realm.locator('[data-mx-annotated]')).waitFor();
  await realm.getByRole('button',{name:'Reverse rows',exact:true}).click();
  await realm.getByRole('button',{name:'Rebuild rows',exact:true}).click();
  await alice.and(realm.locator('[data-mx-annotated]')).waitFor();
  assert.equal(await realm.locator('[data-comment-key="order-102"] [data-mx-annotated]').count(),0);
  await realm.getByRole('button',{name:'Remove Alice',exact:true}).click();
  await alice.waitFor({state:'detached'});
  stored=await annotations();
  assert.equal(stored.find(item=>item.id===iframeComment.id).anchor.nodeId,'iframe-orders');
  assert.equal(stored.find(item=>item.id===iframeComment.id).orphaned,false);
  await realm.getByRole('button',{name:'Restore rows',exact:true}).click();
  await alice.and(realm.locator('[data-mx-annotated]')).waitFor();
  await realm.getByRole('button',{name:'Duplicate key',exact:true}).click();
  await realm.locator('[data-comment-key="order-101"] [data-mx-annotated]').waitFor({state:'detached'});
  await realm.getByRole('button',{name:'Restore rows',exact:true}).click();
  await alice.and(realm.locator('[data-mx-annotated]')).waitFor();
  console.log('PASS iframe Select, persistence, keyed replacement, missing-owner fallback and ambiguity');

  const cardText=page.locator('p[data-mx-comment-owner="order-cards"]').filter({hasText:'Alice Chen'}).first();
  await cardText.waitFor();
  await select();await cardText.click();await save('Keep this comment on the repeated customer');
  stored=await annotations();
  const repeatComment=stored.find(item=>item.thread[0].body==='Keep this comment on the repeated customer');
  assert.equal(repeatComment.anchor.nodeId,'order-cards');
  assert.equal(repeatComment.range.target.kind,'repeat');
  assert.equal(repeatComment.range.target.scopes[0].key,'order-101');
  await page.getByRole('button',{name:'Reverse JSX rows',exact:true}).click();
  await page.getByRole('button',{name:'Rename JSX Alice',exact:true}).click();
  await cardText.filter({hasText:'updated'}).waitFor();
  await cardText.and(page.locator('[data-mx-annotated]')).waitFor();

  const cell=page.locator('td[data-mx-comment-owner="order-table"]').filter({hasText:'Alice Chen'}).first();
  await select();await cell.click();await save('Keep this comment on the table customer');
  stored=await annotations();
  const tableComment=stored.find(item=>item.thread[0].body==='Keep this comment on the table customer');
  assert.equal(tableComment.anchor.nodeId,'order-table');
  assert.deepEqual(tableComment.range.target,{kind:'table',rowKey:'order-101',columnKey:'customer'});
  await page.getByRole('button',{name:'Remove JSX Alice',exact:true}).click();
  await cell.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Restore JSX Alice',exact:true}).click();
  await cell.and(page.locator('[data-mx-annotated]')).waitFor();
  assert.equal((await annotations()).find(item=>item.id===tableComment.id).anchor.nodeId,'order-table');
  console.log('PASS For and DataTable target identity after sorting, updates, removal and restoration');

  await page.reload();
  await alice.and(realm.locator('[data-mx-annotated]')).waitFor();
  await page.locator('td[data-mx-comment-owner="order-table"][data-mx-annotated]').filter({hasText:'Alice Chen'}).waitFor();
  assert.equal((await annotations()).length,3);
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

  // Text selection is captured in the opaque child; only the app composes it.
  const prose=realm.locator('#static-iframe-text');
  await prose.scrollIntoViewIfNeeded();
  // Use an actual native text gesture, so disabled user-select cannot be hidden
  // by programmatically assigning a DOM Range.
  await prose.click({clickCount:3});
  await realm.getByRole('button',{name:'Comment on selected text',exact:true}).click();
  await save('A precise iframe text comment');
  const textComment=(await annotations()).find(item=>item.thread[0].body==='A precise iframe text comment');
  assert.equal(textComment.range.target.node.id,'static-iframe-text');
  assert(textComment.quote.includes('persistent source ID'));
  assert(textComment.range.range.parts.length>0);
  await prose.evaluate(node=>node.ownerDocument.defaultView.getSelection().removeAllRanges());

  // Real pointer drag, then ensure the composer remains above app content.
  await select();
  await prose.scrollIntoViewIfNeeded();
  const bounds=await prose.boundingBox();assert(bounds);
  await page.mouse.move(bounds.x+4,bounds.y+4);await page.mouse.down();
  await page.mouse.move(bounds.x+Math.min(120,bounds.width-4),bounds.y+Math.min(20,bounds.height-2),{steps:8});
  await page.mouse.up();
  const composer=page.getByLabel('Annotation composer',{exact:true});await composer.waitFor();
  assert(await composer.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(el.getRootNode().elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await save('A drawn iframe area');
  const areaComment=(await annotations()).find(item=>item.thread[0].body==='A drawn iframe area');
  assert.equal(areaComment.range.range.kind,'area');
  console.log('PASS iframe text and area selection with parent composer layering');
  // Keep using the same loaded iframe and sidebar: the first saved draft must
  // never lock out a new node or replace it with stale layout from the old one.
  assert.equal(await realm.getByRole('button',{name:'Open comment',exact:true}).count(),0);
  // Saving intentionally leaves that thread open; close it before checking
  // that a subsequent content click does not reopen it.
  await page.getByRole('button',{name:'Close comments',exact:true}).click();
  await prose.click();
  await expect(page.getByLabel('Reply to annotation',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Annotation composer',{exact:true})).toHaveCount(0);
  await expect(prose).not.toHaveCSS('cursor','pointer');
  await prose.dblclick({position:{x:20,y:8}});
  assert((await prose.evaluate(node=>node.ownerDocument.defaultView.getSelection().toString())).trim().length>0);
  await expect(page.getByLabel('Reply to annotation',{exact:true})).toHaveCount(0);
  await realm.getByRole('button',{name:'Comment on selected text',exact:true}).click();
  await save('Different words on an already commented iframe node');
  await select();
  const bob=realm.locator('[data-comment-key="order-102"] [data-comment-key="customer"]');
  await bob.click();await save('A second iframe node without reloading');
  const second=(await annotations()).find(item=>item.thread[0].body==='A second iframe node without reloading');
  assert.deepEqual(second.range.target.node,{kind:'key',path:['order-102','customer']});
  await prose.click({clickCount:3});
  await expect(prose).not.toHaveCSS('user-select','none');
  const menu=realm.getByRole('toolbar',{name:'Text selection actions',exact:true});
  await expect(menu.locator('.lucide-message-square')).toHaveCount(1);
  await expect(menu.locator('.lucide-square-dashed-mouse-pointer')).toHaveCount(1);
  await menu.getByRole('button',{name:'Comment on selected text',exact:true}).click();
  await save('Another native text comment without reloading');
  const repeated=(await annotations()).find(item=>item.thread[0].body==='Another native text comment without reloading');
  assert(repeated.quote.includes('persistent source ID'));
  assert.equal(repeated.range.target.node.id,'static-iframe-text');
  await prose.evaluate(node=>node.ownerDocument.defaultView.getSelection().removeAllRanges());
  // Same menu styling and target size as the regular markup selection toolbar.
  const outside=page.locator('p[data-mx-comment-owner="order-cards"]').filter({hasText:'Bob Singh'}).first();
  await outside.click({clickCount:3});
  const outsideMenu=page.getByRole('toolbar',{name:'Text selection actions',exact:true});
  await outsideMenu.waitFor();
  const outsideStyle=await outsideMenu.evaluate(el=>({font:getComputedStyle(el).font,borderRadius:getComputedStyle(el).borderRadius,background:getComputedStyle(el).backgroundColor}));
  await prose.click({clickCount:3});await menu.waitFor();
  const insideStyle=await menu.evaluate(el=>({font:getComputedStyle(el).font,borderRadius:getComputedStyle(el).borderRadius,background:getComputedStyle(el).backgroundColor}));
  assert.deepEqual(insideStyle,outsideStyle);
  console.log('PASS repeated iframe node/text commenting, native selection and shared menu appearance');

  await outside.evaluate(node=>node.ownerDocument.defaultView.getSelection().removeAllRanges());
  await prose.evaluate(node=>node.ownerDocument.defaultView.getSelection().removeAllRanges());
  await expect(outsideMenu).toBeHidden();
  const unkeyed=page.locator('#index-cards');
  const unkeyedAlice=unkeyed.locator('p').filter({hasText:'Alice Chen'}).first();
  await select();await unkeyedAlice.click();await save('Unkeyed list owner comment');
  let ownerComment=(await annotations()).find(item=>item.thread[0].body==='Unkeyed list owner comment');
  assert.equal(ownerComment.anchor.nodeId,'index-cards');assert.equal(ownerComment.range,null);
  await page.getByRole('button',{name:'Reverse JSX rows',exact:true}).click();
  await expect(unkeyed).toHaveAttribute('data-mx-annotated','');
  await expect(unkeyed.locator('[data-mx-comment-target], [data-mx-annotated]')).toHaveCount(0);
  await unkeyedAlice.dblclick({position:{x:25,y:20}});
  await page.getByRole('button',{name:'Comment on selected text',exact:true}).click();
  await save('Unkeyed words retain only their list owner');
  ownerComment=(await annotations()).find(item=>item.thread[0].body==='Unkeyed words retain only their list owner');
  assert.equal(ownerComment.anchor.nodeId,'index-cards');assert.equal(ownerComment.range,null);assert(ownerComment.quote);
  await select();await unkeyedAlice.scrollIntoViewIfNeeded();
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
  const phoneRealm=phone.frameLocator('iframe[title="Dynamic comment playground"]').frameLocator('iframe');
  const heading=phoneRealm.locator('#static-iframe-heading');await heading.waitFor();
  await openArtifactControls(phone);await phone.getByRole('button',{name:'Toggle comments',exact:true}).tap();
  await phone.getByRole('button',{name:'Select',exact:true}).tap();
  await phone.getByLabel('Annotation sidebar',{exact:true}).waitFor({state:'hidden'});
  await heading.tap();
  await phone.getByLabel('Annotation comment',{exact:true}).fill('An iframe block selected by touch');
  await phone.getByRole('button',{name:'Save annotation',exact:true}).tap();
  await phone.getByLabel('Annotation composer',{exact:true}).waitFor({state:'hidden'});
  const mobileComment=(await annotations()).find(item=>item.thread[0].body==='An iframe block selected by touch');
  assert.equal(mobileComment.range.target.node.id,'static-iframe-heading');
  if(await phone.getByRole('button',{name:'Close comments',exact:true}).isVisible())await phone.getByRole('button',{name:'Close comments',exact:true}).tap();
  await heading.scrollIntoViewIfNeeded();
  const touchBox=await heading.boundingBox();assert(touchBox);
  const session=await mobile.newCDPSession(phone);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchBox.x+20,y:touchBox.y+10}]});
  await phoneRealm.getByRole('button',{name:'Select',exact:true}).waitFor();
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await phoneRealm.getByRole('button',{name:'Select',exact:true}).tap();
  await phone.getByLabel('Select tool active',{exact:true}).waitFor();
  await phone.getByRole('button',{name:'Cancel picking',exact:true}).tap();
  await phone.getByLabel('Select tool active',{exact:true}).waitFor({state:'hidden'});
  console.log('PASS mobile iframe tap, long-press Select and cancellation');
  await mobile.close();
} finally { await browser.close(); }
