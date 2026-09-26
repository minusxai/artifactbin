/**
 * THE OFFLINE FILE, OPENED THE WAY A READER OPENS IT: a double-clicked `.html`
 * from file://, in Chromium, Firefox and WebKit, with no server anywhere.
 *
 * Renders the checked-in fixture (scripts/fixtures/offline-file, a small
 * dashboard) through the real lib/offline/file-html writer with the real
 * core and mermaid offline bundles, writes them to a temp dir and asserts, per
 * bundle and engine:
 *  - the title and body render, from inside the file;
 *  - the table shows the snapshot's rows, and changing the Select runs the
 *    query LIVE on the file's own SQLite engine over the rows it holds (the
 *    fixture precomputes nothing for it), under a CSP that admits only
 *    'wasm-unsafe-eval' beyond the inline scripts;
 *  - the text input feeding a query over data the file does NOT hold is
 *    frozen: disabled with OFFLINE_FILTER_REASON (and its hint says so on
 *    focus);
 *  - the <Mutation> button says OFFLINE_MUTATION_REASON, never an access check;
 *  - the Vega chart draws its bars from the snapshot, then from the live run;
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
 *  - still zero requests, CSP violations and page errors on every page — but
 *    one: code view asks for its extras (CodeMirror, prettier) from the file's
 *    origin, which the gate refuses, so it keeps the plain editor and says so,
 *    and "View formatted" is disabled with its reason.
 *
 * Code view ONLINE, per engine: the file's origin is served by the gate
 * (Playwright routes; nothing real is contacted) with the built extras; the
 * SRI-pinned script loads, CodeMirror mounts, "View formatted" formats, and the
 * extras are the one request the file made. In Chromium, tampered bytes are
 * refused by SRI and code view keeps the plain editor.
 *
 * And a file EDITED BY AN AGENT, per engine: the top-level "source" string
 * changed inside the JSON with a JSON round-trip and nothing else. It opens
 * rebuilt from the new source with "Changed outside the file" in Changes; an
 * invalid source keeps the last good render under a banner naming the error.
 *
 * The base URL the gate runner passes is deliberately unused: this gate's
 * whole claim is that no server is needed. Every request to the file's origin
 * is intercepted, so no run ever reaches a real server.
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
  renderArtifactFileHtml, parseArtifactFile, artifactFileCsp, ARTIFACT_FILE_UNSUPPORTED,
  OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON,
} = await import(pathToFileURL(shim).href);
const RICH_EDITOR_OFFLINE = 'The rich code editor needs a connection the first time. Using the plain editor.';
const FORMATTING_OFFLINE = 'Formatting needs a connection.';
const CHANGED_OUTSIDE = 'Changed outside the file';
const HISTORY_REASON = 'Version history lives on artifactbin. Open the live version.';
const NOTHING_TO_SAVE = 'No changes to save';

const manifest = JSON.parse(readFileSync(path.join(APP, 'lib/story-runtime/dist/offline/manifest.json'), 'utf8'));
// The extras this build serves, as a download names them (their hash changes with every build, so the fixture carries none).
const extrasCode = readFileSync(path.join(APP, 'lib/story-runtime/dist/offline', manifest.extras.file));
const file = parseArtifactFile({
  ...JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/offline-file/artifact-file.json'), 'utf8')),
  extras: { path: manifest.extras.path, integrity: manifest.extras.integrity },
});
const extrasUrl = new URL(manifest.extras.path, file.origin).href;
console.log(`extras: ${(manifest.extras.raw / 1024).toFixed(0)} KB raw at ${extrasUrl}`);

/**
 * The file's origin, as the gate serves it: refused (offline), or answering
 * the extras with the headers the real route sends (server/app.ts). Nothing
 * reaches a real server either way.
 */
async function serveOrigin(context, mode) {
  await context.route(`${file.origin}/**`, (route) => {
    if (mode === 'offline' || route.request().url() !== extrasUrl) return route.abort('internetdisconnected');
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' },
      body: mode === 'tampered' ? Buffer.concat([extrasCode, Buffer.from('\n;')]) : extrasCode,
    });
  });
}
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
console.log(`CSP: ${artifactFileCsp(file.origin)}`);

const baseRows = file.snapshot.state.tables.sales.rows;
// What the live query must answer: the held rows, filtered — nothing precomputed says so.
assert.deepEqual(file.snapshot.variants, [], 'the fixture precomputes nothing for the region: the file runs it');
const westRows = file.snapshot.held.sales_data.rows.rows.filter((row) => row.region === 'west');
const failures = [];

for (const { kind, url } of files) for (const [engine_, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const name = `${engine_} (${kind})`;
  const browser = await engine.launch();
  const started = Date.now();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await serveOrigin(context, 'offline');
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

    // The snapshot's rows, then a LIVE query's: the engine loads from the file's own bytes behind the first paint.
    const table = page.getByRole('table').first();
    const bodyRows = table.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
    await expect(bodyRows).toHaveCount(baseRows.length);
    for (const row of baseRows) await expect(table).toContainText(String(row.month));
    await page.waitForTimeout(1000);
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

    console.log(`${name}: title, body, top bar, snapshot rows (${baseRows.length}) → live west query (${westRows.length}), frozen input, mutation reason, chart, 0 requests, 0 CSP violations, 0 page errors, unsupported-browser message — passed in ${((Date.now() - started) / 1000).toFixed(1)}s${consoleErrors.length ? ` (console errors: ${consoleErrors.join(' | ')})` : ''}`);
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
async function newContext(browser, { picker = false, origin = 'offline' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await serveOrigin(context, origin);
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
    assert.deepEqual(sink.requests, [], `${name}: requests before code view`);
    await reopened.getByRole('button', { name: 'Edit the source' }).click();
    // Offline, code view is the plain editor, and says so in place; the one request was its extras.
    const plain = reopened.getByRole('textbox', { name: 'Markup source' });
    await expect(plain).toHaveAccessibleDescription(RICH_EDITOR_OFFLINE, { timeout: 20_000 });
    await expect(reopened.getByText(RICH_EDITOR_OFFLINE, { exact: true })).toBeVisible();
    await expect(reopened.locator('.cm-editor')).toHaveCount(0);
    const viewFormatted = reopened.getByRole('button', { name: 'View formatted' });
    await expect(viewFormatted).toBeDisabled();
    await expect(viewFormatted).toHaveAccessibleDescription(FORMATTING_OFFLINE);
    assert.deepEqual(sink.requests, [extrasUrl], `${name}: code view asked for its extras, once`);
    sink.requests.length = 0;
    seen.push('offline code view: plain editor with its reason, View formatted disabled');
    await plain.fill(`${await plain.inputValue()}\n<p>{$missing}</p>`);
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
// ── code view online: the extras from the file's origin ──────────────────────

for (const [engineName, engine] of ENGINES) {
  const name = `${engineName} (core, code view online)`;
  const browser = await engine.launch();
  const started = Date.now();
  const sink = { requests: [], pageErrors: [] };
  const seen = [];
  try {
    const context = await newContext(browser, { origin: 'online' });
    const page = await watchedPage(context, sink);
    await page.goto(core.url);
    await expect(page.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await answerName(page, 'Lin');
    await expect(page.getByRole('button', { name: 'Edit the source' })).toBeVisible({ timeout: 20_000 });
    assert.deepEqual(sink.requests, [], `${name}: nothing requested before code view`);
    await page.getByRole('button', { name: 'Edit the source' }).click();
    await page.locator('.cm-editor').first().waitFor({ timeout: 30_000 });
    const tag = page.locator('script[data-afbin-extras]');
    await expect(tag).toHaveCount(1);
    assert.equal(await tag.getAttribute('src'), extrasUrl);
    assert.equal(await tag.getAttribute('integrity'), manifest.extras.integrity);
    assert.equal(await tag.getAttribute('crossorigin'), 'anonymous');
    await expect(page.getByText(RICH_EDITOR_OFFLINE)).toHaveCount(0);
    seen.push('SRI script loaded, CodeMirror mounted');
    await page.getByRole('button', { name: 'View formatted' }).click();
    await expect(page.getByText('Formatted preview · read-only')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.cm-editor')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t format' })).toHaveCount(0);
    seen.push('View formatted');
    assert.deepEqual(sink.requests, [extrasUrl], `${name}: the extras were the one request`);
    assert.deepEqual(await violations(page), [], `${name}: CSP violations`);

    if (engineName === 'chromium') {
      // Bytes that do not match the file's hash: refused by SRI, and code view keeps the plain editor.
      const tampered = await newContext(browser, { origin: 'tampered' });
      const other = await watchedPage(tampered, { requests: [], pageErrors: sink.pageErrors });
      await other.goto(core.url);
      await other.getByRole('button', { name: 'Edit', exact: true }).click();
      await answerName(other, 'Lin');
      await other.getByRole('button', { name: 'Edit the source' }).click();
      await expect(other.getByRole('textbox', { name: 'Markup source' })).toHaveAccessibleDescription(RICH_EDITOR_OFFLINE, { timeout: 20_000 });
      await expect(other.locator('.cm-editor')).toHaveCount(0);
      assert.equal(await other.evaluate(() => typeof globalThis.__afbinExtras), 'undefined', `${name}: tampered extras never ran`);
      seen.push('tampered extras refused by SRI');
    }
    assert.deepEqual(sink.pageErrors, [], `${name}: page errors`);
    console.log(`${name}: ${seen.join(', ')}, 0 CSP violations, 0 page errors — passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`));
    console.log(`${name}: FAILED after [${seen.join(', ')}] — ${error.message}`);
  } finally {
    await browser.close();
  }
}

// ── a file edited by an agent: only the top-level "source" changed ────────────

/** What a coding agent does: a JSON round-trip of the `#afbin-file` block, changing `source` and nothing else. */
const agentEdited = (html, edit) => html.replace(
  /(<script type="application\/json" id="afbin-file">)([\s\S]*?)(<\/script>)/,
  (_all, open, json, close) => { const value = JSON.parse(json); value.source = edit(value.source); return `${open}${JSON.stringify(value)}${close}`; },
);
const coreHtml = readFileSync(new URL(core.url), 'utf8');
const agentFiles = {
  valid: path.join(work, 'agent-valid.html'),
  invalid: path.join(work, 'agent-invalid.html'),
};
writeFileSync(agentFiles.valid, agentEdited(coreHtml, (source) => source.replace('Regional sales</h1>', 'Sales, edited by an agent</h1>')));
writeFileSync(agentFiles.invalid, agentEdited(coreHtml, (source) => source.replace('<Button run', '<p>{$missing}</p>\n  <Button run')));

for (const [engineName, engine] of ENGINES) {
  const name = `${engineName} (core, edited by an agent)`;
  const browser = await engine.launch();
  const started = Date.now();
  const sink = { requests: [], pageErrors: [] };
  const seen = [];
  try {
    const context = await newContext(browser);
    const page = await watchedPage(context, sink);
    await page.goto(pathToFileURL(agentFiles.valid).href);
    await expect(page.getByRole('heading', { name: 'Sales, edited by an agent' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Regional sales', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: /^Changes/ }).click();
    await expect(page.getByRole('region', { name: 'Changes in this file' })).toContainText(CHANGED_OUTSIDE);
    await page.getByRole('button', { name: /^Changes/ }).click();
    await expect(saveButton(page)).toBeEnabled();
    const saved = await saveByDownload(page, path.join(work, `agent-saved-${engineName}.html`));
    const written = savedFile(saved.html);
    assert.ok(written.source.includes('>Sales, edited by an agent</h1>'), `${name}: the saved file keeps the agent's text`);
    assert.ok(JSON.stringify(written.island.nodes).includes('Sales, edited by an agent'), `${name}: and the rebuilt render`);
    assert.deepEqual(written.journal.map((e) => e.summary), [CHANGED_OUTSIDE]);
    assert.deepEqual(await violations(page), [], `${name}: CSP violations`);
    seen.push('rebuilt from the new source, journal line, Save writes it');

    const invalid = await watchedPage(context, sink);
    await invalid.goto(pathToFileURL(agentFiles.invalid).href);
    await expect(invalid.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
    const banner = invalid.getByRole('alert').filter({ hasText: 'changed outside this file' });
    await expect(banner).toContainText(/\$missing.* refers to nothing declared/);
    await expect(invalid.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
    await expect(invalid.getByRole('table').first()).toBeVisible();
    assert.deepEqual(await violations(invalid), [], `${name}: CSP violations with an invalid source`);
    seen.push('invalid source: banner with the error over the last good render');

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
console.log(`offline file gate passed in chromium, firefox and webkit with the ${files.map((f) => f.kind).join(' and ')} bundles; editing, comments, Save, code view offline and online, and agent-edited files with the core bundle`);
