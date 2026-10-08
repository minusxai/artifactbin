/**
 * Gate: datasets IN documents, as one walk — editable cells that write real rows (two readers, a conflict,
 * portals, virtual rows, row buttons, native user fields), the same editors under every permission the sharing
 * seam can put a reader in (anonymous, invited editor, demoted viewer, read-only dataset), a roadmap workspace
 * whose views and sprint dialog drive the same dataset, and row-bound images that decode, stay paired with
 * their rows, and load lazily.
 *
 * Absorbs editable-table, roadmap-views and row-images (proposal §3 row 13). One signed-in account plays both
 * the native-users author and the invited friend. Two lanes run side by side: the editable table and its
 * permissions; the roadmap then the image gallery. The document is read only inside its frame (lib/page-facts).
 *
 *   usage: node scripts/gates/gate-datasets-in-documents.mjs [base]
 */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { checkTableGeometry } from './lib/table-geometry.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
import { documentFrame, documentLocator, INLINE_STORY } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import { launchChromium } from './lib/browser.mjs';
import { createEditableTableFixture } from './lib/editable-table-fixture.mjs';
import { becomeOwner, becomeAccountOwner, startDocument } from '../lib/start-doc.mjs';
import { startMailSink } from '../lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('datasets-in-documents');
/** A group of assertions that reports as one check: ok when the body finishes, FAIL naming the first broken assertion. */
const step = async (label, body) => {
  try { await body(); return check(true, label); } catch (error) { return check(false, `${label} — ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}`); }
};
/** A lane of the journey: a thrown error is reported as a failure, and the other lane keeps walking. */
const lane = async (name, body) => {
  try { await body(); } catch (error) { check(false, `${name}: the journey stopped — ${String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`); }
};

// ── fixtures, published at once ─────────────────────────────────────────────────
const roadmapRows = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, item: `Task ${i + 1}`, owner: 'TBD', hours: 2, depends_on: i === 1 || i === 2 ? '["1"]' : '[]', tags: '[]', status: 'backlog', sprint: '' }));
const imageSeed = startDocument(base);
const [fixture, roadmap, shared, { token: imageToken }] = await Promise.all([
  createEditableTableFixture(base),
  startDocument(base).then((seed) => createEditableTableFixture(base, 15, { workspace: true, rows: roadmapRows, seed })),
  // The permission walk's own small fixture, so the 500-row table keeps its state.
  startDocument(base).then((seed) => createEditableTableFixture(base, 2, { seed })),
  imageSeed,
]);
console.log(`roadmap workspace: ${roadmap.url}`);
const createImage = async (body) => {
  const response = await fetch(base + '/api/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imageToken}` }, body: JSON.stringify({ ...body, visibility: 'unlisted' }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`fixture publish: ${response.status} ${JSON.stringify(result)}`);
  return result;
};

const browser = await launchChromium();
const sink = await startMailSink();
try {
  // ── one account: the native-users author, and later the invited friend ──────
  const accountCtx = await browser.newContext();
  const userPage = await accountCtx.newPage();
  const accountEmail = `mxmx_test_datasets_docs_${Date.now().toString(36)}@example.com`;
  const signedIn = becomeAccountOwner(userPage, base, { sink, email: accountEmail });
  signedIn.catch(() => {}); // awaited by the editable lane

  // ── LANE 1: editable cells, then who may write them ─────────────────────────
  const editable = lane('editable table', async () => {
    const errors = [];
    await checkTableGeometry(base, browser, check);
    const aPage = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const bPage = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    for (const page of [aPage, bPage]) page.on('pageerror', error => errors.push(error.message));
    await Promise.all([becomeOwner(aPage, base, fixture.token), becomeOwner(bPage, base, fixture.token)]);
    // Both row-action surfaces through the real publish/mutate/query doors.
    await step('For and DataTable row buttons persist the clicked row and refresh the reader', async () => {
      const dataset = await fixture.api('/api/artifacts', { title: 'Row action gate data', dataset: [{ id: 1, status: 'backlog' }, { id: 2, status: 'backlog' }], access: 'readwrite', visibility: 'unlisted' });
      const doc = await fixture.api('/api/artifacts', { title: 'Row action gate', visibility: 'unlisted', markup:
        `<Helmet><Import name="tasks_data" src="ref:${dataset.id}" /><Query name="tasks">{\`select * from tasks_data.rows order by id\`}</Query>
        <Import name="complete_data" src="ref:${dataset.id}" /><Mutation name="complete" expectedAffected={1}>{\`update complete_data.rows set status='done' where id=$_row.id\`}</Mutation></Helmet>
        <For each={$tasks} keyBy="id"><p aria-label="Repeated status {$_row.id}">{$_row.status}</p><Button run="$complete" aria-label="Repeat complete {$_row.id}">Complete</Button></For>
        <DataTable data="$tasks" rowKey="id"><Column col="id"/><Column col="status"><Button run="$complete" aria-label="Table complete {$_row.id}">Complete</Button></Column></DataTable>` });
      await aPage.goto(`${base}/a/${doc.id}`);
      const page = await artifactDocument(aPage);
      for (const [label, id] of [['Repeat complete 1', 1], ['Table complete 2', 2]]) {
        const response = aPage.waitForResponse(r => r.url().endsWith(`/a/${doc.id}/mutate`) && r.request().method() === 'POST');
        await page.getByRole('button', { name: label, exact: true }).click();
        const result = await response;
        assert.equal(result.status(), 200, await result.text());
        assert.equal(result.request().postDataJSON().row.id, id);
        await page.getByLabel(`Repeated status ${id}`, { exact: true }).filter({ hasText: 'done' }).waitFor();
      }
      const persisted = await fixture.api(`/api/artifacts/${dataset.id}`, undefined, 'GET');
      assert.deepEqual(persisted.rows.map(row => row.status), ['done', 'done']);
    });
    // Native user metadata drives the existing cell picker and audit identity.
    await step('native user picker and row button persist IDs and display member names', async () => {
      const account = await signedIn;
      await userPage.request.get(`${base}/api/my/profile`);
      const dataset = await account.publish({ title: 'Native users gate', dataset: [{ id: 1, assignee: null, completed_by: null }], columns: [{ name: 'assignee', type: 'user', constraints: { memberOf: ['current'] } }, { name: 'completed_by', type: 'user', constraints: { self: true } }], access: 'readwrite', visibility: 'unlisted' });
      const doc = await account.publish({ title: 'User field project', visibility: 'unlisted', markup:
        `<Helmet><Value name="person" source="ref:${dataset.id}" column="assignee" />
        <Import name="tasks_data" src="ref:${dataset.id}" /><Query name="tasks">{\`select *, '' as action from tasks_data.rows where $person is null or assignee=$person\`}</Query>
        <Import name="assign_data" src="ref:${dataset.id}" /><Mutation name="assign" expectedAffected={1}>{\`update assign_data.rows set assignee=$_value where id=$_row.id\`}</Mutation>
        <Import name="complete_data" src="ref:${dataset.id}" /><Mutation name="complete" expectedAffected={1}>{\`update complete_data.rows set completed_by=$_me.id where id=$_row.id\`}</Mutation></Helmet>
        <Select label="Team filter" value="$person" />
        <DataTable data="$tasks" rowKey="id"><Column col="id"/><Column col="assignee"><Select label="Assign member" value="$_row.assignee" run="$assign"/></Column><Column col="completed_by"/><Column col="action"><Button run="$complete">Finish user task</Button></Column></DataTable>` });
      await userPage.goto(`${base}/a/${doc.id}`);
      const page = await artifactDocument(userPage);
      await page.getByRole('button', { name: 'Assign member', exact: true }).click();
      const option = page.getByRole('option').last();
      const label = (await option.textContent()).trim();
      assert.ok(label && !label.startsWith('usr_'), 'member picker displays a name');
      let response = userPage.waitForResponse(r => r.url().endsWith(`/a/${doc.id}/mutate`) && r.request().method() === 'POST');
      await option.click();
      assert.equal((await response).status(), 200);
      await page.getByRole('button', { name: 'Assign member', exact: true }).filter({ hasText: label }).waitFor();
      response = userPage.waitForResponse(r => r.url().endsWith(`/a/${doc.id}/mutate`) && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Finish user task', exact: true }).click();
      assert.equal((await response).status(), 200);
      // The user cell draws the PERSON: picture, then `@handle` (or the display name); never the account id.
      const personCell = page.getByRole('cell', { name: new RegExp(`^@?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).last();
      await personCell.waitFor();
      assert.ok(!(await personCell.textContent()).includes('usr_'), 'a user cell shows the person, never the account id');
      const persisted = await (await userPage.request.get(`${base}/api/my/artifacts/${dataset.id}`)).json();
      assert.match(persisted.rows[0].assignee, /^usr_/);
      assert.equal(persisted.rows[0].completed_by, persisted.rows[0].assignee);
    });

    await Promise.all([aPage.goto(fixture.url), bPage.goto(fixture.url)]);
    const [a, b] = await Promise.all([artifactDocument(aPage), artifactDocument(bPage)]);
    await Promise.all([a.getByLabel('Item 1', { exact: true }).waitFor(), b.getByLabel('Item 1', { exact: true }).waitFor()]);
    const commit = async (page, action, expectedStatus = 200) => {
      const response = (page.page?.() ?? page).waitForResponse(r => r.url().endsWith(`/a/${fixture.id}/mutate`) && r.request().method() === 'POST');
      await action();
      const result = await response;
      assert.equal(result.status(), expectedStatus, await result.text());
    };
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
    const inputValue = async (page, label, expected) => page.waitForFunction(({ label, expected }) => document.querySelector(`[aria-label="${label}"]`)?.value === expected, { label, expected });
    const waitText = async (page, label, expected) => page.waitForFunction(({ label, expected }) => document.querySelector(`[aria-label="${label}"]`)?.textContent?.includes(expected), { label, expected });
    // Hold the authoritative refresh so a fast local query cannot hide a disruptive overlay.
    await step('cell refresh has no table overlay and preserves another cell draft', async () => {
      let releaseRefresh;
      const refreshHeld = new Promise(resolve => { releaseRefresh = resolve; });
      const queryRoute = `**/a/${fixture.id}/query*`;
      await aPage.route(queryRoute, async route => { await refreshHeld; await route.continue(); });
      try {
        await select(a, 'Status 1', 'active');
        const refreshingTable = a.getByLabel('DataTable embed', { exact: true });
        await a.waitForFunction(() => document.querySelector('[aria-label="DataTable embed"]')?.getAttribute('aria-busy') === 'true');
        assert.equal(await refreshingTable.evaluate(el => el.classList.contains('mx-busy')), false);
        assert.equal(await refreshingTable.locator(':scope > *').first().evaluate(el => getComputedStyle(el).opacity), '1');
        await a.getByLabel('Item 2', { exact: true }).fill('draft during refresh');
      } finally { releaseRefresh(); }
      await a.waitForFunction(() => document.querySelector('[aria-label="DataTable embed"]')?.getAttribute('aria-busy') === 'false');
      await aPage.unroute(queryRoute);
      assert.equal(await a.getByLabel('Item 2', { exact: true }).inputValue(), 'draft during refresh');
      await a.getByLabel('Item 2', { exact: true }).press('Escape');
    });
    await step('status commit propagates to a second reader without reload', () => waitText(b, 'Status 1', 'active'));
    // Both drafts begin before either one commits. A live refresh must preserve the other draft.
    await step('same-cell stale edit is rejected while preserving the draft', async () => {
      await a.getByLabel('Item 1', { exact: true }).fill('first reader');
      await b.getByLabel('Item 1', { exact: true }).fill('second reader');
      await commit(a, () => a.getByLabel('Item 1', { exact: true }).press('Enter'));
      await inputValue(a, 'Item 1', 'first reader');
      assert.equal(await b.getByLabel('Item 1', { exact: true }).inputValue(), 'second reader');
      const versionBeforeConflict = (await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).version;
      await commit(b, () => b.getByLabel('Item 1', { exact: true }).press('Enter'), 409);
      await b.getByRole('alert').filter({ hasText: /changed|conflict/i }).first().waitFor();
      assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).version, versionBeforeConflict);
      await b.getByLabel('Item 1', { exact: true }).press('Escape');
    });
    await step('owner, sprint and numeric editors persist', async () => {
      await select(a, 'Owner 1', '@vivek');
      await select(a, 'Sprint 1', 'Sprint 2');
      await waitText(b, 'Sprint 1', 'Sprint 2');
      await a.getByLabel('Hours 1', { exact: true }).fill('8');
      await a.getByLabel('Hours 1', { exact: true }).press('Enter');
      await inputValue(b, 'Hours 1', '8');
    });
    await step('invalid numeric text/ranges never write; an intentional clear writes null', async () => {
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
    });
    await step('JSON tags and reference labels persist without delimiter corruption', async () => {
      await a.getByLabel('Tags 1', { exact: true }).click();
      await a.getByRole('option', { name: 'design,ux', exact: true }).click();
      await a.getByRole('button', { name: 'Done', exact: true }).click();
      await waitText(b, 'Tags 1', 'design,ux');
      await a.getByLabel('Depends on 1', { exact: true }).click();
      await a.getByRole('option', { name: 'Task 2', exact: true }).click();
      await a.getByRole('button', { name: 'Done', exact: true }).click();
      await waitText(b, 'Depends on 1', 'Task 2');
    });
    await step('self-dependency predicate rejects without a version bump; sprint clearing persists', async () => {
      await a.getByLabel('Depends on 1', { exact: true }).click();
      await a.getByRole('option', { name: 'first reader', exact: true }).click();
      const beforeSelf = (await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).version;
      await commit(a, () => a.getByRole('button', { name: 'Done', exact: true }).click(), 409);
      await a.getByRole('alert').filter({ hasText: /changed|conflict/i }).first().waitFor();
      assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).version, beforeSelf);
      await a.getByLabel('Depends on 1', { exact: true }).click();
      await aPage.keyboard.press('Escape');
      await select(a, 'Sprint 1', 'Unscheduled');
      await waitText(b, 'Sprint 1', 'Unscheduled');
    });
    // Sorting and virtual unmount happen while a draft exists. Scrolling alone must never commit it.
    const box = '[data-slot="data-table"] > div.overflow-auto';
    await step('draft survives virtual unmount and sorting preserves record identity', async () => {
      await a.getByLabel('Item 1', { exact: true }).fill('survives scroll');
      await a.locator(box).evaluate(el => { el.scrollTop = el.scrollHeight; });
      await a.getByLabel('Item 500', { exact: true }).waitFor();
      assert.ok(await a.locator('tbody tr').count() < 500);
      await a.locator(box).evaluate(el => { el.scrollTop = 0; });
      await inputValue(a, 'Item 1', 'survives scroll');
      await a.getByLabel('Item 1', { exact: true }).press('Escape');
      await a.getByLabel('Sort by ID', { exact: true }).click();
      await a.getByLabel('Sort by ID', { exact: true }).click();
      await a.getByLabel('Item 500', { exact: true }).waitFor();
      await select(a, 'Status 500', 'done');
      const saved = await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET');
      assert.equal(saved.rows.find(row => row.id === 1).item, 'first reader');
      assert.equal(saved.rows.find(row => row.id === 1).owner, '@vivek');
      assert.equal(saved.rows.find(row => row.id === 1).hours, 8);
      assert.deepEqual(JSON.parse(saved.rows.find(row => row.id === 1).tags), ['design,ux']);
      assert.deepEqual(JSON.parse(saved.rows.find(row => row.id === 1).depends_on), ['2']);
    });
    await step('filtering follows the updated dataset', async () => {
      // Scroll to the edge after refresh; complete results retain their local sort.
      await a.waitForFunction(() => document.querySelector('[aria-label="DataTable embed"]')?.getAttribute('aria-busy') === 'false');
      await a.locator(box).evaluate(el => { el.scrollTop = el.scrollHeight; });
      // A menu near the scroll edge must portal out of the table's overflow container.
      await a.locator(box).getByRole('button', { name: /^Status \d+$/ }).last().click();
      assert.equal(await a.getByRole('listbox').evaluate(el => !!el.closest('[data-slot="data-table"]')), false);
      await aPage.keyboard.press('Escape');
      await a.getByLabel('Filter status', { exact: true }).click();
      await a.getByRole('option', { name: 'done', exact: true }).click();
      await a.getByLabel('Item 500', { exact: true }).waitFor();
      assert.equal(await a.getByLabel('Item 1', { exact: true }).count(), 0);
    });
    // The owner's inline document uses the same authenticated mutation transport.
    await step('owner cell snapshots publish updates to other readers', async () => {
      const owner = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      owner.on('pageerror', error => errors.push(error.message));
      await becomeOwner(owner, base, fixture.token);
      await owner.goto(fixture.url);
      const frame = documentLocator(owner).locator(INLINE_STORY);
      await frame.getByLabel('Item 1', { exact: true }).waitFor();
      await frame.getByLabel('Owner 1', { exact: true }).click();
      await commit(owner, () => documentLocator(owner).getByRole('option', { name: '@ppsreejith', exact: true }).click());
      await waitText(b, 'Owner 1', '@ppsreejith');
      assert.equal((await fixture.api(`/api/artifacts/${fixture.datasetId}`, undefined, 'GET')).rows.find(row => row.id === 1).owner, '@ppsreejith');
      await owner.close();
    });
    // The PNG export of this table (magic bytes, non-trivial size) moved to gate-exports.mjs (proposal row 17).
    await step('capture uses saved values and disabled editors', async () => {
      const capture = await browser.newPage();
      capture.on('pageerror', error => errors.push(error.message));
      await capture.goto(`${fixture.url}/raw?chrome=0`);
      await capture.getByLabel('Item 1', { exact: true }).waitFor();
      assert.equal(await capture.getByLabel('Item 1', { exact: true }).inputValue(), 'first reader');
      assert.equal(await capture.getByLabel('Item 1', { exact: true }).isDisabled(), true);
      assert.equal(await capture.getByLabel('Status 1', { exact: true }).isDisabled(), true);
      assert.equal(await capture.getByRole('listbox').count(), 0);
      await capture.close();
    });
    await step('menu escapes table overflow; no hydration/runtime errors', async () => { assert.deepEqual(errors, []); });
    await aPage.close(); await bPage.close();

    /*
     * WHO MAY WRITE — the same editors, as one grant goes and comes. services/app/__tests__/mutation-permissions.test.ts
     * owns the state machine: an anonymous write's 403 ("denies anonymous writes…"), a dataset editor's write and a
     * viewer's refusal ("uses dataset roles independently…"), a read-only dataset ("…access: read → 403"). What needs a
     * browser is that a permission CHANGE reaches cells already on screen, without a reload and without discarding
     * what the person was typing — one promotion and one demotion show it; a second flip back to editor and then to a
     * read-only dataset rode the same live capability refresh and were dropped.
     */
    const guestPage = await browser.newPage();
    await guestPage.goto(shared.url);
    const guest = await artifactDocument(guestPage);
    await step('an anonymous reader gets disabled cells', async () => {
      await guest.getByLabel('Item 1', { exact: true }).waitFor();
      assert.equal(await guest.getByLabel('Item 1', { exact: true }).isDisabled(), true);
    });
    const sharedOwner = await browser.newPage();
    await becomeOwner(sharedOwner, base, shared.token);
    await signedIn;
    const friend = await accountCtx.newPage();
    await friend.goto(shared.url);
    const friendDoc = documentLocator(friend).locator(INLINE_STORY);
    const share = async (patch) => {
      const response = await sharedOwner.request.put(`${base}/api/my/artifacts/${shared.datasetId}/sharing`, { data: patch });
      assert.equal(response.status(), 200, await response.text());
    };
    await step('promotion to editor enables the open page live, and its write reaches a reader who still cannot write', async () => {
      await friendDoc.waitFor();
      await friendDoc.getByLabel('Item 1', { exact: true }).waitFor();
      assert.equal(await friendDoc.getByLabel('Item 1', { exact: true }).isDisabled(), true);
      await share({ shares: [{ email: accountEmail, role: 'editor' }] });
      await friendDoc.locator('[aria-label="Item 1"]:enabled').waitFor();
      await friendDoc.getByLabel('Item 1', { exact: true }).fill('Shared edit');
      await friendDoc.getByLabel('Item 1', { exact: true }).press('Enter');
      await guest.waitForFunction(() => document.querySelector('[aria-label="Item 1"]')?.value === 'Shared edit');
      assert.equal(await guest.getByLabel('Item 1', { exact: true }).isDisabled(), true);
    });
    // A draft in flight when the grant is taken away must not be thrown away.
    await step('demotion disables the same cells live and preserves the draft in them', async () => {
      await friendDoc.getByLabel('Item 2', { exact: true }).fill('Unsaved draft');
      await share({ shares: [{ email: accountEmail, role: 'viewer' }] });
      await friendDoc.locator('[aria-label="Item 2"]:disabled').waitFor();
      assert.equal(await friendDoc.getByLabel('Item 2', { exact: true }).inputValue(), 'Unsaved draft');
    });
    // Read-only is not inert: the table still filters.
    await step('and a reader who may not write can still filter', async () => {
      await friendDoc.getByLabel('Filter status', { exact: true }).click();
      await documentLocator(friend).getByRole('option', { name: 'backlog', exact: true }).click();
      await friendDoc.getByLabel('Item 1', { exact: true }).waitFor();
    });
    console.log(`  ·   editable table: ${fixture.url}`);
  });

  // ── LANE 2: the roadmap workspace, then the row-image gallery ───────────────
  const workspace = lane('roadmap and row images', async () => {
    const ownerPage = await browser.newPage({ viewport: { width: 1450, height: 950 } });
    ownerPage.on('pageerror', error => console.error(error.message));
    await becomeOwner(ownerPage, base, roadmap.token);
    await ownerPage.goto(roadmap.url);
    // The document is framed by the app page on its own origin: every check on the document runs in that frame.
    let page = await artifactDocument(ownerPage);
    const switchView = async name => {
      await page.getByLabel('View', { exact: true }).click();
      await page.getByRole('option', { name, exact: true }).click();
    };
    const dialog = () => page.getByRole('dialog', { name: 'Add sprint' });
    await step('roadmap: compact rows, and the DAG view draws its Vega dependency graph', async () => {
      await page.getByLabel('View', { exact: true }).waitFor({ timeout: 5000 });
      await page.getByLabel('Item 1', { exact: true }).waitFor();
      assert.ok(await page.getByLabel('Item 1', { exact: true }).evaluate(el => el.closest('tr').getBoundingClientRect().height <= 48));
      await switchView('DAG');
      await page.locator('#view-dag svg.marks, #view-dag canvas').first().waitFor();
      await page.locator('#view-dag [aria-label="Dependency 1 → 3"]').first().waitFor({ timeout: 3000 });
      assert.equal(await page.getByLabel('Item 1', { exact: true }).isVisible(), false);
    });
    await switchView('Sprint').catch(() => {});
    // The link the reader copies, the app page's address, says what they narrowed the document to (lib/islands/url-sync).
    const linked = await ownerPage.waitForFunction(() => new URLSearchParams(location.search).get('$view_mode') === 'sprint', null, { timeout: 5000 }).then(() => true, () => false);
    check(linked, `the app page's address carries the view the reader chose ($view_mode=sprint): saw ${JSON.stringify(await ownerPage.evaluate(() => location.search))}, the frame's ${JSON.stringify(await page.evaluate(() => location.search).catch(() => ''))}`);
    await step('roadmap: the shared sprint modal creates a sprint and refuses a case-insensitive duplicate', async () => {
      await page.locator('#view-sprint').getByLabel('Add Sprint', { exact: true }).click();
      await dialog().waitFor();
      await page.getByLabel('Sprint name', { exact: true }).fill('Planning week');
      await page.getByLabel('Sprint deadline', { exact: true }).fill('2026-09-14');
      await page.getByLabel('Create sprint', { exact: true }).click();
      await dialog().waitFor({ state: 'hidden' });
      await page.locator('#view-sprint').getByText('Planning week', { exact: true }).waitFor();
      await page.locator('#view-sprint').getByLabel('Add Sprint', { exact: true }).click();
      await page.getByLabel('Sprint name', { exact: true }).fill(' planning WEEK ');
      await page.getByLabel('Create sprint', { exact: true }).click();
      let refusal = '';
      for (let attempt = 0; attempt < 40 && !refusal; attempt++) {
        refusal = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? '');
        if (!refusal) await page.waitForTimeout(250);
      }
      assert.match(refusal, /affected|changed|mutation/i, `missing refusal: ${await dialog().textContent()}`);
      assert.equal(await dialog().isVisible(), true);
      await page.getByLabel('Cancel sprint', { exact: true }).click();
      await dialog().waitFor({ state: 'hidden' });
    });
    await step('roadmap: the dropdown action opens the same modal and the assignment persists across a reload', async () => {
      await switchView('Table');
      await ownerPage.waitForFunction(() => new URLSearchParams(location.search).get('$view_mode') !== 'sprint');
      await page.getByLabel('Sprint 1', { exact: true }).click();
      await page.getByRole('option', { name: 'Planning week', exact: true }).waitFor();
      await page.locator('[data-return-label="Sprint 1"]').click();
      await dialog().waitFor();
      await page.getByLabel('Sprint name', { exact: true }).fill('Quick sprint');
      await page.getByLabel('Create sprint', { exact: true }).click();
      await dialog().waitFor({ state: 'hidden' });
      await page.getByLabel('Sprint 1', { exact: true }).click();
      await page.getByRole('option', { name: 'Quick sprint', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('button[aria-label="Sprint 1"]')?.textContent.includes('Quick sprint'));
      let persisted;
      for (let attempt = 0; attempt < 100; attempt++) {
        persisted = await roadmap.api(`/api/artifacts/${roadmap.datasetId}`, undefined, 'GET');
        if (persisted.rows.find(row => row.id === 1)?.sprint === 'Quick sprint') break;
        await ownerPage.waitForTimeout(50);
      }
      assert.equal(persisted?.rows.find(row => row.id === 1)?.sprint, 'Quick sprint', 'sprint assignment persisted before reload');
      await ownerPage.reload({ waitUntil: 'load' });
      page = await artifactDocument(ownerPage);
      await page.getByLabel('Item 1', { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Sprint 1', exact: true }).filter({ hasText: 'Quick sprint' }).waitFor({ timeout: 20_000 });
    });
    await step('roadmap: at phone width the view menu and the sprint modal stay on screen, with no sideways scroll', async () => {
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await page.getByLabel('View', { exact: true }).click();
      const popup = page.getByRole('listbox').locator('..');
      const box = await popup.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('option', { name: 'Sprint', exact: true }).click();
      await page.locator('#view-sprint').getByLabel('Add Sprint', { exact: true }).click();
      const modalBox = await dialog().boundingBox();
      assert.ok(modalBox && modalBox.x >= 0 && modalBox.x + modalBox.width <= 390);
      await ownerPage.keyboard.press('Escape');
      await dialog().waitFor({ state: 'hidden' });
    });
    await ownerPage.close();

    // ROW IMAGES: dataset image bindings, measured in a real browser.
    const refs = [];
    for (const background of ['red', 'blue']) {
      const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background } }).png().toBuffer();
      refs.push((await createImage({ image: `data:image/png;base64,${bytes.toString('base64')}` })).id);
    }
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: i % 2 ? 'Blue book' : 'Red book', cover_ref: `ref:${refs[i % 2]}`, position: i }));
    const dataset = await createImage({ dataset: rows });
    const markup = `<Helmet>
 <Value name="take" type="number" default={2}/><Value name="reverse" type="boolean" default={false}/><Value name="selected" type="string" default="0"/>
 <Import name="books_data" src="ref:${dataset.id}" /><Query name="books">{\`select * from books_data.rows order by case when $reverse then -position else position end limit $take\`}</Query>
 <Import name="detail_data" src="ref:${dataset.id}" /><Query name="detail">{\`select * from detail_data.rows where id=$selected\`}</Query>
</Helmet><main className="p-8">
<Input label="Rows" type="number" value="$take"/><Switch label="Reverse" checked="$reverse"/><Input label="Selected book" value="$selected"/>
<section aria-label="Selected"><For each={$detail} keyBy="id"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={48} height={64}/><p>{$_row.title}</p></For></section>
<section aria-label="Gallery"><For each={$books} keyBy="id"><article><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={48} height={64}/><h2>{$_row.title}</h2></article></For></section>
</main>`;
    const doc = await createImage({ markup });
    // "two authored image templates, independent of row count" (the stored source keeps one template per <img>)
    // moved to vitest: row-image-binding.test.ts:38.
    /** The document's frame, once its story is on screen (the app page frames every document on its own origin). */
    const storyFrame = async (page) => { const frame = await documentFrame(page); await frame.waitForSelector(INLINE_STORY, { state: 'visible', timeout: 30_000 }); return frame; };
    const imagePage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const requests = []; const errors = [];
    imagePage.on('request', r => requests.push(r.url())); imagePage.on('pageerror', e => errors.push(e.message));
    await becomeOwner(imagePage, base, imageToken);
    await imagePage.goto(`${base}/a/${doc.id}`); const doc_ = await storyFrame(imagePage); const framed = documentLocator(imagePage);
    const gallery = framed.locator('[aria-label="Gallery"]');
    await gallery.locator('img').first().waitFor();
    await doc_.waitForFunction(() => [...document.querySelectorAll('[aria-label="Gallery"] img')].length === 2 && [...document.querySelectorAll('[aria-label="Gallery"] img')].every(i => i.naturalWidth > 0));
    const pairs = await gallery.locator('article').evaluateAll(nodes => nodes.map(n => ({ title: n.querySelector('h2').textContent, alt: n.querySelector('img').alt, src: n.querySelector('img').currentSrc })));
    check(pairs.every((p, i) => p.title === rows[i].title && p.alt === p.title && p.src.includes(`/a/${refs[i]}/raw`)), 'red and blue decode and match their rows');
    await framed.getByLabel('Selected book', { exact: true }).fill('1');
    await doc_.waitForFunction(id => document.querySelector('[aria-label="Selected"] img')?.currentSrc.includes(`/a/${id}/raw`), refs[1]);
    check(await framed.locator('[aria-label="Selected"] img').getAttribute('alt') === 'Blue book', 'shared detail query updates its image');
    for (const count of [24, 48, 1000]) {
      await framed.getByLabel('Rows', { exact: true }).fill(String(count));
      await doc_.waitForFunction(n => document.querySelectorAll('[aria-label="Gallery"] article').length === n, count);
      check(await gallery.locator('article').count() === count, `progressive query renders ${count} rows`);
    }
    const all = await gallery.locator('article').evaluateAll(nodes => nodes.map(n => ({ title: n.querySelector('h2').textContent, alt: n.querySelector('img').alt, src: n.querySelector('img').getAttribute('src'), lazy: n.querySelector('img').loading })));
    check(all.every((p, i) => p.title === rows[i].title && p.alt === p.title && (p.src.includes(refs[i % 2]) || p.src.includes(encodeURIComponent(`ref:${refs[i % 2]}`))) && p.lazy === 'lazy'), '1,000 items remain correctly paired');
    await framed.getByRole('switch', { name: 'Reverse', exact: true }).click();
    await doc_.waitForFunction(() => document.querySelector('[aria-label="Gallery"] img')?.alt === 'Blue book');
    check(await gallery.locator('img').first().getAttribute('alt') === 'Blue book', 'reordering retains image/text identity');
    // Each lazy image is scrolled into the browser's loading range before asserting decode.
    for (let i = 0; i < 1000; i += 10) await gallery.locator('article').nth(i).scrollIntoViewIfNeeded();
    await gallery.locator('article').last().scrollIntoViewIfNeeded();
    await doc_.waitForFunction(() => [...document.querySelectorAll('[aria-label="Gallery"] img')].every(i => i.naturalWidth > 0), null, { timeout: 15000 });
    check(!requests.some(url => url.includes('$_row') || url.includes('%24_row')), 'no literal row-binding URL requested');
    check(!errors.some(e => /50000|hydration|#418/.test(e)), 'no expansion or hydration errors');
    const guest = await browser.newPage(); await guest.goto(`${base}/a/${doc.id}`);
    await (await storyFrame(guest)).waitForFunction(() => { const images = [...document.querySelector('[aria-label="Gallery"]')?.querySelectorAll('img') ?? []]; return images.length === 2 && images.every(i => i.naturalWidth > 0); });
    check(true, 'signed-out reader decodes both permitted images'); await guest.close();
    // Captures use the standalone opaque-origin document, without a parent asset relay.
    const capture = await browser.newPage(); const captureErrors = [];
    capture.on('console', m => { if (m.type() === 'error') captureErrors.push(m.text()); });
    capture.on('requestfailed', r => captureErrors.push(`${new URL(r.url()).pathname}: ${r.failure()?.errorText}`));
    await capture.goto(`${base}/a/${doc.id}/raw?chrome=0`);
    await capture.waitForFunction(() => [...document.querySelectorAll('[aria-label="Gallery"] img')].length === 2 && [...document.querySelectorAll('[aria-label="Gallery"] img')].every(i => i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
    check(await capture.locator('[aria-label="Gallery"] img').evaluateAll(images => images.length === 2 && images.every(i => i.naturalWidth > 0)), `standalone capture resolves row images: ${captureErrors.join('; ')}`);
    await capture.close();
    // "PNG export contains both uploaded cover colors" moved to gate-exports.mjs (proposal row 17).
    // Distinct assets distinguish metadata resolution from original-byte downloads.
    const distinct = await Promise.all(Array.from({ length: 32 }, async (_, i) => {
      const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: { r: i * 7, g: 32, b: 180 } } }).png().toBuffer();
      const image = await createImage({ image: `data:image/png;base64,${bytes.toString('base64')}` });
      return { id: String(i), title: `Cover ${i}`, cover_ref: `ref:${image.id}` };
    }));
    const lazyData = await createImage({ dataset: distinct });
    const lazy = await createImage({ markup: `<Helmet><Import name="covers_data" src="ref:${lazyData.id}" /><Query name="covers">{\`select * from covers_data.rows\`}</Query></Helmet><For each={$covers} keyBy="id"><article className="h-96"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={180} height={240}/></article></For>` });
    const probe = await browser.newPage({ viewport: { width: 1000, height: 700 } }); const fetched = new Set(); let metadata = 0;
    probe.on('request', r => { const u = new URL(r.url()); if (r.resourceType() === 'image' && /^\/a\/[^/]+\/raw$/.test(u.pathname)) fetched.add(u.pathname); if (u.pathname.endsWith('/assets') && r.resourceType() !== 'image') metadata++; });
    await probe.goto(`${base}/a/${lazy.id}`); const probeDoc = await storyFrame(probe);
    await probeDoc.waitForFunction(() => document.querySelector('article img')?.naturalWidth > 0);
    await probe.waitForTimeout(500);
    const initial = fetched.size; check(initial > 0 && initial < distinct.length, `lazy gallery initially downloads ${initial}/${distinct.length} image assets (${metadata} metadata requests)`);
    await documentLocator(probe).locator('article').last().scrollIntoViewIfNeeded();
    await probeDoc.waitForFunction(() => [...document.querySelectorAll('article img')].at(-1)?.naturalWidth > 0);
    check(fetched.size > initial, 'scrolling downloads additional image bytes');
    await probe.close(); await imagePage.close();
  });

  await Promise.all([editable, workspace]);
} finally { await browser.close(); await sink.close(); }
check.done();
