/** Full served-document test: real cell writes, two readers, conflict, portals and virtual rows. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createEditableTableFixture } from './lib/editable-table-fixture.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const fixture = await createEditableTableFixture(base);
const browser = await chromium.launch();
const errors = [];
const check = (name) => console.log(`  ok ${name}`);
try {
  const a = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const b = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([a.goto(fixture.url), b.goto(fixture.url)]);
  await Promise.all([a.getByLabel('Item 1', { exact: true }).waitFor(), b.getByLabel('Item 1', { exact: true }).waitFor()]);
  const select = async (page, label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await commit(page, () => page.getByRole('option', { name: option, exact: true }).click());
  };
  const inputValue = async (page, label, expected) => page.waitForFunction(({ label, expected }) => document.querySelector(`[aria-label="${label}"]`)?.value === expected, {label, expected});
  const waitText = async (page, label, expected) => page.waitForFunction(({label,expected}) => document.querySelector(`[aria-label="${label}"]`)?.textContent?.includes(expected), {label,expected});
  const commit = async (page, action, expectedStatus = 200) => {
    const response = page.waitForResponse(r => r.url().endsWith(`/a/${fixture.id}/mutate`) && r.request().method() === 'POST');
    await action();
    const result = await response;
    assert.equal(result.status(), expectedStatus, await result.text());
  };
  await select(a, 'Status 1', 'active');
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

  await a.getByLabel('Tags 1',{exact:true}).click();
  await a.getByRole('option',{name:'design,ux',exact:true}).click();
  await a.getByRole('button',{name:'Done',exact:true}).click();
  await waitText(b,'Tags 1','design,ux');
  await a.getByLabel('Depends on 1',{exact:true}).click();
  await a.getByRole('option',{name:'Task 2',exact:true}).click();
  await a.getByRole('button',{name:'Done',exact:true}).click();
  await waitText(b,'Depends on 1','Task 2');
  check('JSON tags and reference labels persist without delimiter corruption');

  // Sorting and virtual unmount happen while a draft exists. Scrolling alone must never commit it.
  await a.getByLabel('Item 1',{exact:true}).fill('survives scroll');
  const box='[data-slot="data-table"] > div';
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

  // A menu near the scroll edge must portal out of the table's overflow container.
  await a.getByLabel('Status 500',{exact:true}).click();
  assert.equal(await a.getByRole('listbox').evaluate(el=>!!el.closest('[data-slot="data-table"]')),false);
  await a.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  check('menu escapes table overflow; no hydration/runtime errors');
  console.log(`all good: ${fixture.url}`);
} finally { await browser.close(); }
