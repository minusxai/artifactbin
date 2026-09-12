import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { checkTableGeometry } from './lib/table-geometry.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Full served-document test: real cell writes, two readers, conflict, portals
 * and virtual rows — and then the same editors under every permission the
 * sharing seam can put a reader in: anonymous, invited editor, demoted viewer,
 * read-only document.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createEditableTableFixture } from './lib/editable-table-fixture.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const fixture = await createEditableTableFixture(base);
const browser = await chromium.launch();
const sink = await startMailSink();
const errors = [];
const check = (name) => console.log(`  ok ${name}`);
try {
  await checkTableGeometry(base, browser, (condition, label) => { assert.ok(condition, label); check(label); });
  const aPage = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const bPage = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  for (const page of [aPage, bPage]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([becomeOwner(aPage,base,fixture.token),becomeOwner(bPage,base,fixture.token)]);
  await Promise.all([aPage.goto(fixture.url), bPage.goto(fixture.url)]);
  await Promise.all([aPage.locator('[data-mx-inline-story]').waitFor(),bPage.locator('[data-mx-inline-story]').waitFor()]);
  const a = await artifactDocument(aPage);
  const b = await artifactDocument(bPage);
  await Promise.all([a.getByLabel('Item 1', { exact: true }).waitFor(), b.getByLabel('Item 1', { exact: true }).waitFor()]);
  const select = async (page, label, option) => {
    const trigger = page.getByRole('button', { name: label, exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await trigger.click();
    const popup = page.getByRole('listbox').locator('..');
    assert.equal(await popup.evaluate(el => getComputedStyle(el).position), 'fixed');
    assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'opening a menu must not scroll the page');
    const menuBox = await popup.boundingBox();
    const triggerBox = await trigger.boundingBox();
    assert.ok(menuBox && triggerBox && Math.abs(menuBox.y - (triggerBox.y + triggerBox.height)) <= menuBox.height + 8, 'menu must remain beside its trigger');
    await commit(page, () => page.getByRole('option', { name: option, exact: true }).click());
  };
  const inputValue = async (page, label, expected) => page.waitForFunction(({ label, expected }) => document.querySelector(`[aria-label="${label}"]`)?.value === expected, {label, expected});
  const waitText = async (page, label, expected) => page.waitForFunction(({label,expected}) => document.querySelector(`[aria-label="${label}"]`)?.textContent?.includes(expected), {label,expected});
  const commit = async (page, action, expectedStatus = 200) => {
    const response = (page.page?.() ?? page).waitForResponse(r => r.url().endsWith(`/a/${fixture.id}/mutate`) && r.request().method() === 'POST');
    await action();
    const result = await response;
    assert.equal(result.status(), expectedStatus, await result.text());
  };
  // Hold the authoritative refresh so a fast local query cannot hide a
  // disruptive overlay. Other cells must stay usable throughout the save.
  let releaseRefresh;
  const refreshHeld = new Promise(resolve => { releaseRefresh = resolve; });
  const queryRoute = `**/a/${fixture.id}/query*`;
  await aPage.route(queryRoute, async route => { await refreshHeld; await route.continue(); });
  await select(a, 'Status 1', 'active');
  const refreshingTable = a.getByLabel('DataTable embed', {exact:true});
  await a.waitForFunction(() => document.querySelector('[aria-label="DataTable embed"]')?.getAttribute('aria-busy') === 'true');
  assert.equal(await refreshingTable.evaluate(el => el.classList.contains('mx-busy')), false);
  assert.equal(await refreshingTable.locator(':scope > *').first().evaluate(el => getComputedStyle(el).opacity), '1');
  await a.getByLabel('Item 2', {exact:true}).fill('draft during refresh');
  releaseRefresh();
  await a.waitForFunction(() => document.querySelector('[aria-label="DataTable embed"]')?.getAttribute('aria-busy') === 'false');
  await aPage.unroute(queryRoute);
  assert.equal(await a.getByLabel('Item 2', {exact:true}).inputValue(), 'draft during refresh');
  await a.getByLabel('Item 2', {exact:true}).press('Escape');
  check('cell refresh has no table overlay and preserves another cell draft');
  await waitText(b, 'Status 1', 'active');
  check('status commit propagates to a second reader without reload');

  // Both drafts begin before either one commits. A live refresh must preserve the other draft.
  await a.getByLabel('Item 1', {exact:true}).fill('first reader');
  await b.getByLabel('Item 1', {exact:true}).fill('second reader');
  await commit(a, () => a.getByLabel('Item 1', {exact:true}).press('Enter'));
  await inputValue(a,'Item 1','first reader');
  assert.equal(await b.getByLabel('Item 1',{exact:true}).inputValue(),'second reader');
  const versionBeforeConflict = (await fixture.api(`/api/artifacts/${fixture.datasetId}`,undefined,'GET')).version;
  await commit(b, () => b.getByLabel('Item 1',{exact:true}).press('Enter'), 409);
  await b.getByRole('alert').filter({hasText:/changed|conflict/i}).waitFor();
  check('same-cell stale edit is rejected while preserving the draft');
  assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`,undefined,'GET')).version,versionBeforeConflict);
  await b.getByLabel('Item 1',{exact:true}).press('Escape');

  await select(a,'Owner 1','@vivek');
  await select(a,'Sprint 1','Sprint 2');
  await waitText(b,'Sprint 1','Sprint 2');
  await a.getByLabel('Hours 1',{exact:true}).fill('8');
  await a.getByLabel('Hours 1',{exact:true}).press('Enter');
  await inputValue(b,'Hours 1','8');
  check('owner, sprint and numeric editors persist');

  const invalidWrites = [];
  const watchInvalid = request => {
    if (request.url().endsWith(`/a/${fixture.id}/mutate`) && request.method() === 'POST') invalidWrites.push(request.postDataJSON());
  };
  aPage.on('request', watchInvalid);
  await a.getByLabel('Hours 1', { exact: true }).fill('-1');
  await a.getByLabel('Hours 1', { exact: true }).press('Enter');
  await a.getByLabel('Hours 1', { exact: true }).fill('');
  await a.getByLabel('Hours 1', { exact: true }).press('e');
  assert.equal(await a.getByLabel('Hours 1', { exact: true }).evaluate(el => el.validity.badInput), true);
  await a.getByLabel('Hours 1', { exact: true }).press('Tab');
  await select(a, 'Owner 2', '@vivek');
  aPage.off('request', watchInvalid);
  assert.equal(invalidWrites.filter(write => write.mutation === 'set_hours').length, 0);
  await a.getByLabel('Hours 1', { exact: true }).press('Escape');
  await a.getByLabel('Hours 1', { exact: true }).fill('');
  await commit(a, () => a.getByLabel('Hours 1', { exact: true }).press('Enter'));
  await inputValue(b, 'Hours 1', '');
  assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).rows.find(row => row.id === 1).hours, null);
  await a.getByLabel('Hours 1', { exact: true }).fill('8');
  await commit(a, () => a.getByLabel('Hours 1', { exact: true }).press('Enter'));
  check('invalid numeric text/ranges never write; an intentional clear writes null');

  await a.getByLabel('Tags 1',{exact:true}).click();
  await a.getByRole('option',{name:'design,ux',exact:true}).click();
  await a.getByRole('button',{name:'Done',exact:true}).click();
  await waitText(b,'Tags 1','design,ux');
  await a.getByLabel('Depends on 1',{exact:true}).click();
  await a.getByRole('option',{name:'Task 2',exact:true}).click();
  await a.getByRole('button',{name:'Done',exact:true}).click();
  await waitText(b,'Depends on 1','Task 2');
  check('JSON tags and reference labels persist without delimiter corruption');
  await a.getByLabel('Depends on 1', { exact: true }).click();
  await a.getByRole('option', { name: 'first reader', exact: true }).click();
  const beforeSelf = (await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).version;
  await commit(a, () => a.getByRole('button', { name: 'Done', exact: true }).click(), 409);
  await a.getByRole('alert').filter({ hasText: /changed|conflict/i }).waitFor();
  assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).version, beforeSelf);
  await a.getByLabel('Depends on 1', { exact: true }).click();
  await aPage.keyboard.press('Escape');
  await select(a, 'Sprint 1', 'Unscheduled');
  await waitText(b, 'Sprint 1', 'Unscheduled');
  check('self-dependency predicate rejects without a version bump; sprint clearing persists');

  // Sorting and virtual unmount happen while a draft exists. Scrolling alone must never commit it.
  await a.getByLabel('Item 1',{exact:true}).fill('survives scroll');
  const box='[data-slot="data-table"] > div.overflow-auto';
  await a.locator(box).evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await a.getByLabel('Item 500',{exact:true}).waitFor();
  assert.ok(await a.locator('tbody tr').count()<500);
  await a.locator(box).evaluate(el=>{el.scrollTop=0;});
  await inputValue(a,'Item 1','survives scroll');
  await a.getByLabel('Item 1',{exact:true}).press('Escape');
  await a.getByLabel('Sort by ID',{exact:true}).click();
  await a.getByLabel('Sort by ID',{exact:true}).click();
  await a.getByLabel('Item 500',{exact:true}).waitFor();
  await select(a,'Status 500','done');
  const saved = await fixture.api(`/api/artifacts/${fixture.datasetId}`,undefined,'GET');
  assert.equal(saved.rows.find(row=>row.id===1).item,'first reader');
  assert.equal(saved.rows.find(row=>row.id===1).owner,'@vivek');
  assert.equal(saved.rows.find(row=>row.id===1).hours,8);
  assert.deepEqual(JSON.parse(saved.rows.find(row=>row.id===1).tags),['design,ux']);
  assert.deepEqual(JSON.parse(saved.rows.find(row=>row.id===1).depends_on),['2']);
  check('draft survives virtual unmount and sorting preserves record identity');

  // A refreshed query resets its window; find the saved row in that window.
  await a.waitForFunction(() => document.querySelector('[aria-label="DataTable embed"]')?.getAttribute('aria-busy') === 'false');
  await a.locator(box).evaluate(el=>{el.scrollTop=el.scrollHeight;});

  // A menu near the scroll edge must portal out of the table's overflow container.
  await a.getByLabel('Status 500',{exact:true}).click();
  assert.equal(await a.getByRole('listbox').evaluate(el=>!!el.closest('[data-slot="data-table"]')),false);
  await aPage.keyboard.press('Escape');
  await a.getByLabel('Filter status', { exact: true }).click();
  await a.getByRole('option', { name: 'done', exact: true }).click();
  await a.getByLabel('Item 500', { exact: true }).waitFor();
  assert.equal(await a.getByLabel('Item 1', { exact: true }).count(), 0);
  check('filtering follows the updated dataset');

  // The owner's inline document uses the same authenticated mutation transport.
  const owner = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  owner.on('pageerror', error => errors.push(error.message));
  await becomeOwner(owner, base, fixture.token);
  await owner.goto(fixture.url);
  const frame = owner.locator('[data-mx-inline-story]');
  await frame.getByLabel('Item 1', { exact: true }).waitFor();
  await frame.getByLabel('Owner 1', { exact: true }).click();
  await commit(owner, () => owner.getByRole('option', { name: '@ppsreejith', exact: true }).click());
  await waitText(b, 'Owner 1', '@ppsreejith');
  assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).rows.find(row => row.id === 1).owner, '@ppsreejith');
  check('owner cell snapshots publish updates to other readers');

  const capture = await browser.newPage();
  capture.on('pageerror', error => errors.push(error.message));
  await capture.goto(`${fixture.url}/raw?chrome=0`);
  await capture.getByLabel('Item 1', { exact: true }).waitFor();
  assert.equal(await capture.getByLabel('Item 1', { exact: true }).inputValue(), 'first reader');
  assert.equal(await capture.getByLabel('Item 1', { exact: true }).isDisabled(), true);
  assert.equal(await capture.getByLabel('Status 1', { exact: true }).isDisabled(), true);
  assert.equal(await capture.getByRole('listbox').count(), 0);
  const exported = await fetch(`${fixture.url}/export?format=png`);
  assert.equal(exported.status, 200);
  const png = Buffer.from(await exported.arrayBuffer());
  assert.ok(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.ok(png.length > 1000);
  check('capture uses saved values and disabled editors; PNG export succeeds');

  assert.deepEqual(errors,[]);
  check('menu escapes table overflow; no hydration/runtime errors');

  /*
   * WHO MAY WRITE — the same editors, under every permission the sharing seam
   * can put them in. `mutation-permissions.test.ts` covers the state machine;
   * what needs a browser is that a permission CHANGE reaches cells that are
   * already on screen, without a reload and without discarding what the person
   * was typing. A small fixture of its own, so the 500-row table above keeps
   * its state.
   */
  const shared = await createEditableTableFixture(base, 2, { seed: await startDocument(base) });
  const guest = await browser.newPage();
  await guest.goto(shared.url);
  await guest.getByLabel('Item 1', { exact: true }).waitFor();
  assert.equal(await guest.getByLabel('Item 1', { exact: true }).isDisabled(), true);
  const forged = await guest.request.post(`${shared.url}/mutate`, { data: {
    mutation: 'set_item',
    values: { _value: 'forged' },
    row: { id: 1, item: 'Task 1', owner: 'TBD', hours: 2, depends_on: '[]', tags: '[]', status: 'backlog', sprint: '' },
  } });
  assert.equal(forged.status(), 403);
  check('an anonymous reader gets disabled cells, and a forged mutation is refused');

  const sharedOwner = await browser.newPage();
  await becomeOwner(sharedOwner, base, shared.token);
  const friend = await browser.newPage();
  const email = `mxmx_test_dataset_friend_${Date.now().toString(36)}@example.com`;
  await loginViaEmail(friend, base, sink, email);
  await friend.goto(shared.url);
  await friend.locator('[data-mx-inline-story]').waitFor();
  const friendDoc = friend.locator('[data-mx-inline-story]');
  await friendDoc.getByLabel('Item 1', { exact: true }).waitFor();
  assert.equal(await friendDoc.getByLabel('Item 1', { exact: true }).isDisabled(), true);

  const share = async (patch) => {
    const response = await sharedOwner.request.put(`${base}/api/my/artifacts/${shared.datasetId}/sharing`, { data: patch });
    assert.equal(response.status(), 200, await response.text());
  };
  await share({ shares: [{ email, role: 'editor' }] });
  await friendDoc.locator('[aria-label="Item 1"]:enabled').waitFor();
  await friendDoc.getByLabel('Item 1', { exact: true }).fill('Shared edit');
  await friendDoc.getByLabel('Item 1', { exact: true }).press('Enter');
  await guest.waitForFunction(() => document.querySelector('[aria-label="Item 1"]')?.value === 'Shared edit');
  assert.equal(await guest.getByLabel('Item 1', { exact: true }).isDisabled(), true);
  check('promotion to editor enables the open page live, and its write reaches a reader who still cannot write');

  // A draft in flight when the grant is taken away must not be thrown away.
  await friendDoc.getByLabel('Item 2', { exact: true }).fill('Unsaved draft');
  await share({ shares: [{ email, role: 'viewer' }] });
  await friendDoc.locator('[aria-label="Item 2"]:disabled').waitFor();
  assert.equal(await friendDoc.getByLabel('Item 2', { exact: true }).inputValue(), 'Unsaved draft');
  await share({ shares: [{ email, role: 'editor' }] });
  await friendDoc.locator('[aria-label="Item 2"]:enabled').waitFor();
  await share({ access: 'read' });
  await friendDoc.locator('[aria-label="Item 2"]:disabled').waitFor();
  check('demotion disables the same cells live and preserves the draft in them');

  // Read-only is not inert: the table still filters.
  await friendDoc.getByLabel('Filter status', { exact: true }).click();
  await friend.getByRole('option', { name: 'backlog', exact: true }).click();
  await friendDoc.getByLabel('Item 1', { exact: true }).waitFor();
  check('and a read-only reader can still filter');

  console.log(`all good: ${fixture.url}`);
} finally { await browser.close(); await sink.close(); }
