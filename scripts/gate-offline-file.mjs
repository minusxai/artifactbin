/**
 * THE OFFLINE FILE, OPENED THE WAY A READER OPENS IT: a double-clicked `.html`
 * from file://, in Chromium, Firefox and WebKit, with no server anywhere.
 *
 * Renders the checked-in fixture (scripts/fixtures/offline-file, a small
 * dashboard) through the real lib/offline/file-html writer with the real
 * core and mermaid offline bundles, writes them to a temp dir and asserts, per
 * bundle and engine:
 *  - the title and body render, from inside the file;
 *  - the table shows the snapshot's rows, and changing the Select swaps to
 *    the precomputed variant's rows;
 *  - the frozen text input is disabled with OFFLINE_FILTER_REASON (and its
 *    hint says so on focus);
 *  - the <Mutation> button says OFFLINE_MUTATION_REASON, never an access check;
 *  - the Vega chart draws its bars from the snapshot, then from the variant;
 *  - a browser without DecompressionStream gets the plain "needs a current
 *    browser" message instead of a broken page;
 *  - nothing but file:/data: is requested, no Content-Security-Policy
 *    violation fires (a blocked fetch never reaches the request log, so this
 *    is the check that would catch one), and no page error is thrown.
 *
 * And then, with the core bundle in each engine, what a reader DOES with the
 * file (lib/offline/file-backend, components/offline/OfflineApp):
 *  - Save starts disabled ("No changes to save"); Edit asks "What should we
 *    call you?" the first time; a heading edited in place shows on the page,
 *    marks the file unsaved, and Save downloads a file;
 *  - what needs artifactbin says why in place: version history, an image by
 *    URL, the query notebook's tables;
 *  - THAT saved file, opened on its own, has the edit, and "Changes" lists it
 *    under the name; invalid markup typed in code view shows the validator's
 *    reason and is not applied;
 *  - a second reader (a fresh browser profile) comments on a selection in the
 *    saved copy — the name prompt comes first — replies and resolves, saves,
 *    and the copy they saved reopens with the thread, the name and its status;
 *  - Chromium's save picker is written to when it exists (stubbed: Playwright
 *    cannot drive the native dialog);
 *  - still zero requests, CSP violations and page errors on every page.
 *
 * The base URL the gate runner passes is deliberately unused: this gate's
 * whole claim is that no server is needed.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { expect } from 'playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'services/app');
const work = path.join(os.tmpdir(), `afbin-offline-gate-${process.pid}`);
mkdirSync(work, { recursive: true });
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

// The bundle, built if this checkout has not built it (a no-op on a cache hit).
execFileSync(process.execPath, ['scripts/build-offline.mjs', '--cache'], { cwd: APP, stdio: 'inherit' });

// The real writer and constants, bundled for Node rather than re-implemented here.
const shim = path.join(work, 'file-html.mjs');
await esbuild.build({
  stdin: { contents: "export * from './lib/offline/file-html'; export * from './lib/offline/file-format';", resolveDir: APP, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: shim, alias: { '@': APP }, logLevel: 'warning',
});
const {
  renderArtifactFileHtml, parseArtifactFile, ARTIFACT_FILE_CSP, ARTIFACT_FILE_UNSUPPORTED,
  OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON,
} = await import(pathToFileURL(shim).href);
const HISTORY_REASON = 'Version history lives on artifactbin. Open the live version.';
const NOTHING_TO_SAVE = 'No changes to save';

const file = parseArtifactFile(JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/offline-file/artifact-file.json'), 'utf8')));
const manifest = JSON.parse(readFileSync(path.join(APP, 'lib/story-runtime/dist/offline/manifest.json'), 'utf8'));
/*
 * Both bundles open the same Mermaid-free fixture: core is what this file would
 * carry; mermaid proves the larger bundle also loads and runs under the CSP.
 */
const files = Object.keys(manifest.bundles).map((kind) => {
  const code = readFileSync(path.join(APP, 'lib/story-runtime/dist/offline', manifest.bundles[kind].file)).toString('base64');
  const htmlPath = path.join(work, `Regional sales (${kind}).html`);
  writeFileSync(htmlPath, renderArtifactFileHtml({ file: { ...file, bundle: kind }, code }));
  console.log(`${kind} file: ${(Buffer.byteLength(readFileSync(htmlPath)) / 1024).toFixed(0)} KB`);
  return { kind, url: pathToFileURL(htmlPath).href };
});
console.log(`CSP: ${ARTIFACT_FILE_CSP}`);

const baseRows = file.snapshot.state.tables.sales.rows;
const westRows = file.snapshot.variants.find((v) => v.values.region === 'west').tables.sales.rows;
const failures = [];

for (const { kind, url } of files) for (const [engine_, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const name = `${engine_} (${kind})`;
  const browser = await engine.launch();
  const started = Date.now();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const requests = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on('request', (request) => { if (!/^(file|data):/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await page.goto(url);

    // Title and body, from inside the file.
    await expect(page.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
    assert.equal(await page.title(), file.metadata.title, 'document title');
    await expect(page.getByText('Revenue by region and month')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0); // the "Opening …" placeholder is gone
    const bar = page.getByRole('banner', { name: 'Offline copy' });
    await expect(bar).toContainText(`Offline copy of ${file.metadata.title}`);
    await expect(bar).toContainText('data as of');
    await expect(bar.getByRole('link', { name: 'Open live version' })).toHaveAttribute('href', file.liveUrl);

    // The chart draws, from the same rows: one bar per month, summed.
    const chart = page.getByLabel('Question embed').first();
    const expectBars = async (rows) => {
      const sums = new Map();
      for (const row of rows) sums.set(row.month, (sums.get(row.month) ?? 0) + row.revenue);
      await expect(chart.locator('[data-mx-chart-state="ready"]')).toHaveCount(1, { timeout: 20_000 });
      await expect(chart.locator('.mark-rect path')).toHaveCount(sums.size);
      for (const [month, sum] of sums) await expect(chart.locator(`[aria-label="month: ${month}; Sum of revenue: ${sum}"]`)).toHaveCount(1);
    };
    await expectBars(baseRows);

    // The snapshot's rows, then the precomputed variant's.
    const table = page.getByRole('table').first();
    const bodyRows = table.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
    await expect(bodyRows).toHaveCount(baseRows.length);
    for (const row of baseRows) await expect(table).toContainText(String(row.month));
    await page.getByRole('button', { name: 'Region', exact: true }).click();
    await page.getByRole('option', { name: 'west', exact: true }).click();
    await expect(bodyRows).toHaveCount(westRows.length);
    for (const text of await bodyRows.allTextContents()) assert.match(text, /west/, `${name}: a filtered row is not west: ${text}`);
    await expectBars(westRows);

    // The frozen Value: disabled, described, and its hint shows the reason.
    const frozen = page.getByRole('textbox', { name: 'Region pattern' });
    await expect(frozen).toBeDisabled();
    await expect(frozen).toHaveAttribute('aria-description', OFFLINE_FILTER_REASON);
    await page.locator(`[tabindex="0"][aria-description="${OFFLINE_FILTER_REASON}"]`).focus();
    await expect(page.getByRole('tooltip')).toContainText(OFFLINE_FILTER_REASON);

    // The write: refused by name, never "Checking edit access…".
    const add = page.getByRole('button', { name: 'Add a row' });
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute('aria-description', OFFLINE_MUTATION_REASON);
    await expect(page.getByText(OFFLINE_MUTATION_REASON, { exact: true })).toBeVisible();
    await expect(page.getByText('Checking edit access…')).toHaveCount(0);

    // Nothing left the file.
    const violations = await page.evaluate(() => window.__cspViolations);
    assert.deepEqual(requests, [], `${name}: network requests`);
    assert.deepEqual(violations, [], `${name}: CSP violations`);
    assert.deepEqual(pageErrors, [], `${name}: page errors`);
    // A browser without DecompressionStream: the boot script's plain message, and nothing else runs.
    const old = await context.newPage();
    const oldErrors = [];
    old.on('pageerror', (error) => oldErrors.push(String(error)));
    await old.addInitScript(() => { delete globalThis.DecompressionStream; });
    await old.goto(url);
    await expect(old.getByRole('alert')).toHaveText(ARTIFACT_FILE_UNSUPPORTED);
    await expect(old.getByRole('heading', { name: 'Regional sales' })).toHaveCount(0);
    assert.deepEqual(oldErrors, [], `${name}: page errors without DecompressionStream`);

    console.log(`${name}: title, body, top bar, snapshot rows (${baseRows.length}) → west variant (${westRows.length}), frozen input, mutation reason, chart, 0 requests, 0 CSP violations, 0 page errors, unsupported-browser message — passed in ${((Date.now() - started) / 1000).toFixed(1)}s${consoleErrors.length ? ` (console errors: ${consoleErrors.join(' | ')})` : ''}`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`));
    console.log(`${name}: FAILED — ${error.message}`);
  } finally {
    await browser.close();
  }
}
// ── editing, commenting and saving, from file:// ──────────────────────────────

const core = files.find((f) => f.kind === 'core');
const headingId = /<h1 [^>]*id="([^"]+)"/.exec(file.source)[1];
const ENGINES = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
const downloads = {};

/** A page that records what must stay empty: requests off the file, CSP violations, page errors. */
async function watchedPage(context, sink) {
  const page = await context.newPage();
  page.on('request', (request) => { if (!/^(file|data|blob):/.test(request.url())) sink.requests.push(request.url()); });
  page.on('pageerror', (error) => sink.pageErrors.push(String(error)));
  return page;
}
async function newContext(browser, { picker = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(({ picker }) => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => { window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`); });
    // The download path is what every engine has; the picker is checked on its own, stubbed.
    if (!picker) { delete window.showSaveFilePicker; return; }
    window.__written = null;
    window.showSaveFilePicker = async (options) => {
      window.__pickerName = options.suggestedName;
      return { createWritable: async () => { const parts = []; return { write: async (data) => { parts.push(typeof data === 'string' ? data : await data.text()); }, close: async () => { window.__written = parts.join(''); } }; } };
    };
  }, { picker });
  return context;
}
const violations = (page) => page.evaluate(() => window.__cspViolations);

/** Select the first `length` characters of the heading's text, as a reader's drag does. */
async function selectHeading(page, length) {
  await page.evaluate(({ id, length }) => {
    const heading = document.getElementById(id);
    const text = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode();
    (heading.closest('.ProseMirror') ?? heading).focus({ preventScroll: true });
    const selection = getSelection();
    selection.removeAllRanges();
    selection.setBaseAndExtent(text, 0, text, length);
  }, { id: headingId, length });
}
async function answerName(page, name) {
  const dialog = page.getByRole('dialog', { name: 'What should we call you?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Your name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function saveByDownload(page, to) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save', exact: true }).click()]);
  await download.saveAs(to);
  const scheme = download.url().split(':')[0];
  // The saved copy is the same shell with the same code: it parses, and it is a complete file.
  const html = readFileSync(to, 'utf8');
  assert.match(html, /<script type="application\/octet-stream" id="afbin-code">/);
  return { html, scheme, name: download.suggestedFilename() };
}
const savedFile = (html) => {
  const json = /<script type="application\/json" id="afbin-file">([\s\S]*?)<\/script>/.exec(html)[1];
  return parseArtifactFile(JSON.parse(json));
};
const saveButton = (page) => page.getByRole('button', { name: 'Save', exact: true });

for (const [engineName, engine] of ENGINES) {
  const name = `${engineName} (core, editing)`;
  const browser = await engine.launch();
  const started = Date.now();
  const sink = { requests: [], pageErrors: [] };
  const seen = [];
  try {
    // ── Asha edits the heading and saves ─────────────────────────────────────
    const asha = await newContext(browser);
    const page = await watchedPage(asha, sink);
    await page.goto(core.url);
    await expect(page.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveAccessibleDescription(NOTHING_TO_SAVE);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await answerName(page, 'Asha');
    await expect(page.getByRole('button', { name: 'Edit the source' })).toBeVisible({ timeout: 20_000 });
    await selectHeading(page, 'Regional'.length);
    await page.keyboard.type('Quarterly');
    await expect(page.getByRole('heading', { name: 'Quarterly sales' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible({ timeout: 10_000 });
    await expect(saveButton(page)).toBeEnabled();
    seen.push('edit in place');

    // What needs artifactbin says so where its control is.
    const history = page.getByRole('tab', { name: 'History' }).first();
    await expect(history).toBeDisabled();
    await expect(history).toHaveAccessibleDescription(HISTORY_REASON);
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('button', { name: 'Image…' }).click();
    const imageUrl = page.getByRole('textbox', { name: 'Image URL' });
    await expect(imageUrl).toBeDisabled();
    await expect(imageUrl).toHaveAccessibleDescription(OFFLINE_ASSET_REASON);
    await expect(page.getByRole('button', { name: 'Import image from URL' })).toBeDisabled();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Show data' }).click();
    await expect(page.getByText(`shape unavailable — ${OFFLINE_QUERY_REASON}`).first()).toBeVisible();
    await page.getByRole('button', { name: 'Show data' }).click();
    seen.push('history, image URL and query notebook reasons');

    await page.getByRole('button', { name: 'Done editing' }).click();
    const first = await saveByDownload(page, path.join(work, `saved-${engineName}.html`));
    downloads[engineName] = first.scheme;
    assert.equal(first.name, path.basename(decodeURIComponent(new URL(core.url).pathname)), `${name}: Save suggests the name the file was opened as`);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
    assert.deepEqual(await violations(page), [], `${name}: CSP violations while editing`);
    seen.push(`Save → ${first.scheme}: download`);

    // ── that saved file, opened on its own ───────────────────────────────────
    const reopened = await watchedPage(asha, sink);
    await reopened.goto(pathToFileURL(path.join(work, `saved-${engineName}.html`)).href);
    await expect(reopened.getByRole('heading', { name: 'Quarterly sales' })).toBeVisible({ timeout: 20_000 });
    await expect(reopened.getByRole('heading', { name: 'Regional sales', exact: true })).toHaveCount(0);
    await expect(reopened.getByRole('alertdialog')).toHaveCount(0); // no crash-buffer offer for a copy just saved
    await reopened.getByRole('button', { name: /^Changes/ }).click();
    const changes = reopened.getByRole('region', { name: 'Changes in this file' });
    await expect(changes).toContainText('Asha');
    await expect(changes).toContainText("Edited text in 'Quarterly sales'");
    await reopened.getByRole('button', { name: /^Changes/ }).click();
    seen.push('reopened: edit and Changes by name');

    // Invalid markup in code view: the validator's reason, and nothing applied.
    await reopened.getByRole('button', { name: 'Edit', exact: true }).click(); // the name is remembered: no prompt
    await expect(reopened.getByRole('dialog', { name: 'What should we call you?' })).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Edit the source' }).click();
    await reopened.locator('.monaco-editor').waitFor({ timeout: 20_000 });
    await reopened.locator('.monaco-editor .view-lines').click();
    await reopened.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await reopened.keyboard.press('Enter');
    // One insertion, not keystrokes: Monaco auto-closes tags as they are typed,
    // and WebKit on Linux lost part of the typed text in CI.
    await reopened.keyboard.insertText('<p>{$missing}</p>');
    await expect(reopened.getByRole('status').filter({ hasText: /not saved — .*\$missing.* refers to nothing declared/ })).toBeVisible({ timeout: 10_000 });
    await expect(saveButton(reopened)).toBeDisabled();
    await expect(reopened.getByRole('button', { name: /^Changes/ })).toHaveText('Changes (1)');
    assert.deepEqual(await violations(reopened), [], `${name}: CSP violations in the reopened copy`);
    seen.push('invalid code refused, not applied');

    // ── Ravi, somewhere else, comments on the copy he was sent ───────────────
    const ravi = await newContext(browser);
    const second = await watchedPage(ravi, sink);
    await second.goto(pathToFileURL(path.join(work, `saved-${engineName}.html`)).href);
    const doc = second.locator('[data-mx-inline-story]');
    await doc.locator(`#${headingId}`).waitFor({ timeout: 20_000 });
    const bubble = second.locator('[data-mx-selection-actions]');
    for (let i = 0; i < 40 && !(await bubble.isVisible().catch(() => false)); i++) {
      await doc.locator(`#${headingId}`).click({ clickCount: 3, timeout: 2000 }).catch(() => {});
      await second.waitForTimeout(250);
    }
    await second.getByRole('button', { name: 'Comment on selected text' }).click();
    await second.getByRole('textbox', { name: 'Annotation comment' }).fill('Is "Quarterly" right for a monthly table?');
    await second.getByRole('button', { name: 'Save annotation' }).click();
    await answerName(second, 'Ravi');
    await expect(doc.locator(`#${headingId}[data-mx-annotated]`)).toHaveCount(1, { timeout: 10_000 });
    await second.getByRole('button', { name: /^Comments/ }).click();
    const thread = second.getByLabel('Annotation thread', { exact: true }).first();
    await expect(thread).toContainText('Ravi');
    await expect(thread).toContainText('monthly table');
    await second.getByRole('textbox', { name: 'Reply to annotation' }).first().fill('Checked: it is the Q3 view.');
    await second.getByRole('button', { name: 'Send reply' }).first().click();
    await expect(thread).toContainText('Checked: it is the Q3 view.');
    await second.getByRole('button', { name: 'Resolve annotation' }).first().click();
    await expect(second.getByLabel('Resolved annotation thread')).toHaveCount(1, { timeout: 10_000 });
    const withThread = await saveByDownload(second, path.join(work, `commented-${engineName}.html`));
    assert.deepEqual(await violations(second), [], `${name}: CSP violations while commenting`);
    const written = savedFile(withThread.html);
    assert.equal(written.threads.length, 1, `${name}: the saved copy carries the thread`);
    assert.equal(written.threads[0].status, 'resolved');
    assert.deepEqual(written.threads[0].thread.map((c) => c.author.label), ['Ravi', 'Ravi']);
    assert.deepEqual(written.journal.map((e) => e.by), ['Asha'], `${name}: Asha's edit travels with the file`);
    seen.push('comment → name prompt → reply → resolve → Save');

    const third = await watchedPage(ravi, sink);
    await third.goto(pathToFileURL(path.join(work, `commented-${engineName}.html`)).href);
    await expect(third.getByRole('heading', { name: 'Quarterly sales' })).toBeVisible({ timeout: 20_000 });
    await third.getByRole('button', { name: /^Comments/ }).click();
    const resolved = third.getByLabel('Resolved annotation thread');
    await expect(resolved).toHaveCount(1, { timeout: 10_000 });
    await expect(resolved).toContainText('Ravi');
    await expect(third.getByLabel('Annotation thread', { exact: true })).toHaveCount(0);
    assert.deepEqual(await violations(third), [], `${name}: CSP violations in the commented copy`);
    seen.push('reopened: resolved thread with the name');

    // ── the save picker, where the browser has one ───────────────────────────
    if (engineName === 'chromium') {
      const picked = await newContext(browser, { picker: true });
      const pickerPage = await watchedPage(picked, sink);
      await pickerPage.goto(core.url);
      await pickerPage.getByRole('button', { name: 'Edit', exact: true }).click();
      await answerName(pickerPage, 'Mei');
      await expect(pickerPage.getByRole('button', { name: 'Edit the source' })).toBeVisible({ timeout: 20_000 });
      await selectHeading(pickerPage, 'Regional'.length);
      await pickerPage.keyboard.type('Picked');
      await expect(saveButton(pickerPage)).toBeEnabled({ timeout: 10_000 });
      await saveButton(pickerPage).click();
      await expect(saveButton(pickerPage)).toBeDisabled({ timeout: 10_000 });
      const { html, suggested } = await pickerPage.evaluate(() => ({ html: window.__written, suggested: window.__pickerName }));
      assert.equal(suggested, path.basename(decodeURIComponent(new URL(core.url).pathname)));
      assert.ok(savedFile(html).source.includes('>Picked sales</h1>'), `${name}: the picker received the edited file`);
      assert.deepEqual(await violations(pickerPage), [], `${name}: CSP violations with the picker`);
      seen.push('save picker written with the file name');
    }

    assert.deepEqual(sink.requests, [], `${name}: network requests`);
    assert.deepEqual(sink.pageErrors, [], `${name}: page errors`);
    console.log(`${name}: ${seen.join(', ')}, 0 requests, 0 CSP violations, 0 page errors — passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`));
    console.log(`${name}: FAILED after [${seen.join(', ')}] — ${error.message}`);
  } finally {
    await browser.close();
  }
}
console.log(`downloads: ${Object.entries(downloads).map(([engineName, scheme]) => `${engineName} ${scheme}:`).join(', ')}`);

if (failures.length) throw new AggregateError(failures, 'Offline file checks failed');
console.log(`offline file gate passed in chromium, firefox and webkit with the ${files.map((f) => f.kind).join(' and ')} bundles, and editing, comments and Save with the core bundle`);
