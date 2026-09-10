/** Real app acceptance for durable targets across managed and declarative content. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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
  await becomeOwner(page,base,seed.token);
  await page.goto(`${base}/a/${seed.id}`);
  const realm=page.frameLocator('iframe[title="Dynamic comment playground"]').frameLocator('iframe');
  const alice=realm.locator('[data-comment-key="order-101"] [data-comment-key="customer"]');
  await alice.waitFor();
  await openArtifactControls(page);
  await page.getByRole('button',{name:'Toggle comments',exact:true}).click();
  await page.getByLabel('Annotation sidebar',{exact:true}).waitFor();
  const select=async()=>{
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
  await context.close();
} finally { await browser.close(); }
