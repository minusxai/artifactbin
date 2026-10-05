/**
 * Gate: THE OFFLINE FILE AND THE SCREENSHOT COMMENT, IN THREE ENGINES AT ONCE.
 *
 * A double-clicked `.html` from file:// shares no server with anything, so Chromium, Firefox and WebKit open it
 * CONCURRENTLY, one lane per engine, in this one process (it was three gates on three shards, each paying for
 * the cross-browser install). Each engine's lane, in order:
 *
 * READING (the downloaded file, no server anywhere):
 *  - the title and body render, from inside the file;
 *  - the table shows the snapshot's rows, and changing the Select runs the query LIVE on the file's own SQLite
 *    engine over the rows it holds (the fixture precomputes nothing for it), under a CSP that admits only
 *    'wasm-unsafe-eval' beyond the inline scripts;
 *  - the text input feeding a query over data the file does NOT hold is frozen: disabled with
 *    OFFLINE_FILTER_REASON (and its hint says so on focus);
 *  - the <Mutation> button says OFFLINE_MUTATION_REASON, never an access check;
 *  - the Vega chart draws its bars from the snapshot, then from the live run;
 *  - a browser without DecompressionStream gets the plain "needs a current browser" message;
 *  - nothing but file:/data: is requested, no Content-Security-Policy violation fires (a blocked fetch never
 *    reaches the request log, so this is the check that would catch one), and no page error is thrown.
 *
 * EDITING (lib/offline/file-backend, lib/offline/solid-entry): Save starts disabled; Edit asks "What should we
 * call you?"; a heading edited in place marks the file unsaved and Save downloads it; what needs artifactbin says
 * why in place (history, image URL, the query notebook); the saved file reopens with the edit and "Changes" by
 * name; invalid markup in code view is refused; a second reader comments on the saved copy, replies, resolves and
 * saves, and that copy reopens with the thread; Chromium's save picker is written to (stubbed). Code view offline
 * asks for its extras once from the file's origin, which is refused, so it keeps the plain editor and says so.
 *
 * CODE VIEW ONLINE: the file's origin is served by the gate (Playwright routes; nothing real is contacted) with
 * the built extras; the SRI-pinned script loads, CodeMirror mounts, "View formatted" formats, and the extras are
 * the one request. In Chromium, tampered bytes are refused by SRI and code view keeps the plain editor.
 *
 * EDITED BY AN AGENT: the top-level "source" changed inside the JSON and nothing else. It opens rebuilt with
 * "Changed outside the file" in Changes; an invalid source keeps the last good render under a banner.
 *
 * WHICH ENGINES TRAVEL: a prose file carries no document module, a Mermaid file carries Mermaid and neither SQLite
 * nor Vega, and both open from file:// under the same network refusal.
 *
 * THE SCREENSHOT COMMENT (formerly gate-screenshot-comments): Chromium's real tab capture at DPR 1 and 2.2 (the crop
 * corner is the content's pixel), the upload fallback in Firefox and WebKit, the brush, and the comment's
 * screenshot persisting through a reload. The document is framed on its own origin on the gate's server.
 *
 *   usage: node scripts/gates/gate-offline-file.mjs [base]
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { firefox, webkit } from 'playwright';
import { expect } from 'playwright/test';
import sharp from 'sharp';
import { createChecker } from './lib/assert.mjs';
import { lane } from './lib/lane.mjs';
import { launchChromium, PAGES_HOST } from './lib/browser.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { documentLocator } from './lib/page-facts.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { startDocument, becomeOwner } from '../lib/start-doc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'services/app');
const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('offline-file');
/** Chromium through the one launcher (lib/browser.mjs); the other two engines need no host mapping for file://. */
const ENGINES = [['chromium', { launch: (options) => launchChromium(options) }], ['firefox', firefox], ['webkit', webkit]];
const work = path.join(os.tmpdir(), `afbin-offline-gate-${process.pid}`);
mkdirSync(work, { recursive: true });
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

// ── one download, before any browser opens it ────────────────────────────────

// The bundle, built if this checkout has not built it (a no-op on a cache hit).
execFileSync(process.execPath, ['scripts/build-offline.mjs', '--cache'], { cwd: APP, stdio: 'inherit' });

// The real writer and constants, bundled for Node rather than re-implemented here.
const shim = path.join(work, 'file-html.mjs');
await esbuild.build({
  stdin: { contents: "export * from './lib/offline/file-html'; export * from './lib/offline/file-format';", resolveDir: APP, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: shim, alias: { '@': APP }, logLevel: 'warning',
});
const {
  parseArtifactFile, artifactFileCsp, ARTIFACT_FILE_UNSUPPORTED,
  OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON,
} = await import(pathToFileURL(shim).href);
const RICH_EDITOR_OFFLINE = 'The rich code editor needs a connection the first time. Using the plain editor.';
const FORMATTING_OFFLINE = 'Formatting needs a connection.';
const CHANGED_OUTSIDE = 'Changed outside the file';
const HISTORY_REASON = 'Version history lives on artifactbin. Open the live version.';
const NOTHING_TO_SAVE = 'No changes to save';

const manifest = JSON.parse(readFileSync(path.join(APP, 'lib/build-assets/offline/manifest.json'), 'utf8'));
// The extras this build serves, as a download names them (their hash changes with every build, so the fixture carries none).
const extrasCode = readFileSync(path.join(APP, 'lib/build-assets/offline', manifest.extras.file));
const token = (await connectAgent(BASE)).token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const publish = async (body) => {
  const response = await fetch(`${BASE}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify(body) });
  const answer = await response.json();
  if (response.status !== 201) throw new Error(`publish → ${response.status} ${JSON.stringify(answer)}`);
  return answer.id;
};
const download = async (id) => {
  const response = await fetch(`${BASE}/a/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error(`download ${id} → ${response.status} ${await response.text()}`);
  return response.text();
};
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/offline-file/artifact-file.json'), 'utf8'));
const heldRows = fixture.snapshot.held.sales_data.rows.rows;
const salesId = await publish({ dataset: heldRows, visibility: 'unlisted', access: 'readwrite' });
const targetsId = await publish({ dataset: heldRows, visibility: 'unlisted', access: 'read' });
const source = readFileSync(path.join(ROOT, 'scripts/fixtures/offline-file/dashboard.jsx'), 'utf8')
  .replace('ref:Ds1a2b', `ref:${salesId}`).replace('ref:Tg9z8y', `ref:${targetsId}`);
const exported = await download(await publish({ markup: source, visibility: 'unlisted' }));
const FILE_JSON = /(<script type="application\/json" id="afbin-file">)([\s\S]*?)(<\/script>)/;
const file = parseArtifactFile(JSON.parse(FILE_JSON.exec(exported)[2]));
// Authored global CSS must affect the document, never the first-party controls.
file.css.author += '\nbutton { border-radius: 0 !important; font: 40px serif !important; } header { height: 91px !important; }';
// The second dataset is intentionally not held by this copy. Its free-text
// filter is frozen while the first import remains live in SQLite.
file.snapshot.frozen = ['note'];
delete file.snapshot.held.targets_data;
file.island.dataflow.hold = ['sales_data'];
const extrasUrl = new URL(manifest.extras.path, file.origin).href;
console.log(`extras: ${(manifest.extras.raw / 1024).toFixed(0)} KB raw at ${extrasUrl}`);

// One downloaded file carries this document's compiled module and engines.
const coreHtml = exported.replace(FILE_JSON, (_all, open, _json, close) => `${open}${JSON.stringify(file).replace(/</g, '\\u003c')}${close}`);
const corePath = path.join(work, 'Regional sales (solid).jsx.html');
writeFileSync(corePath, coreHtml);
const coreUrl = pathToFileURL(corePath).href;
console.log(`solid file: ${(Buffer.byteLength(coreHtml) / 1024).toFixed(0)} KB`);
console.log(`CSP: ${artifactFileCsp(file.origin)}`);

const baseRows = file.snapshot.state.tables.sales.rows;
// What the live query must answer: the held rows, filtered — nothing precomputed says so.
check(Array.isArray(file.snapshot.variants) && file.snapshot.variants.length === 0, 'the fixture precomputes nothing for the region: the file runs it');
const westRows = heldRows.filter((row) => row.region === 'west');
const headingId = /<h1 [^>]*id="([^"]+)"/.exec(file.source)[1];

/** What a coding agent does: a JSON round-trip of the `#afbin-file` block, changing `source` and nothing else. */
const agentEdited = (html, edit) => html.replace(FILE_JSON, (_all, open, json, close) => {
  const value = JSON.parse(json); value.source = edit(value.source);
  return `${open}${JSON.stringify(value).replace(/</g, '\\u003c')}${close}`;
});
const agentFiles = {
  valid: path.join(work, 'agent-valid.html'),
  invalid: path.join(work, 'agent-invalid.html'),
  query: path.join(work, 'agent-query.html'),
};
writeFileSync(agentFiles.valid, agentEdited(coreHtml, (s) => s.replace('Regional sales</h1>', 'Sales, edited by an agent</h1><section id="offline-added-section"><h2>Added offline section</h2><p>Structure travels with the saved file.</p></section>')));
writeFileSync(agentFiles.invalid, agentEdited(coreHtml, (s) => s.replace('<Button run', '<p>{$missing}</p>\n  <Button run')));
writeFileSync(agentFiles.query, agentEdited(coreHtml, (s) => s.replace('select region, month, revenue from sales_data.rows where', 'select region, month, revenue * 2 as revenue from sales_data.rows where')));

// The compiled page decides which engines travel with each file. A prose
// document has no browser module; a Mermaid document can draw without SQLite
// or Vega. Both must still open from file:// under the same network refusal.
const engineFiles = [];
for (const [label, markup] of [
  ['prose', '<h1>Offline prose</h1><p>A file that needs no document engine.</p>'],
  ['mermaid', '<h1>Offline diagram</h1><Mermaid title="Flow" code={"flowchart TD\\n A[Draft] --> B[Saved]"} />'],
]) {
  const html = await download(await publish({ markup, visibility: 'unlisted' }));
  const code = /<script type="application\/octet-stream" id="afbin-compiled-code">([^<]*)<\/script>/.exec(html)?.[1];
  const packed = code ? gunzipSync(Buffer.from(code, 'base64')).toString('utf8') : '';
  check(!!code === (label === 'mermaid'), `${label}: compiled document module`);
  check(!/id="afbin-wasm"/.test(html), `${label}: no SQLite engine`);
  check(!/Axes cannot be shared in concatenated/.test(packed), `${label}: no Vega engine`);
  if (label === 'mermaid') check(/mermaidAPI/.test(packed), 'Mermaid carries its drawing engine');
  const target = path.join(work, `${label}.html`);
  writeFileSync(target, html);
  console.log(`${label} file: ${Buffer.byteLength(html)} raw / ${brotliCompressSync(html).length} br bytes`);
  engineFiles.push({ label, url: pathToFileURL(target).href });
}

// ── the browser side, shared by every lane ───────────────────────────────────

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
/** A page that records what must stay empty: requests off the file, CSP violations, page errors. */
async function watchedPage(context, sink) {
  const page = await context.newPage();
  page.on('request', (request) => { if (!/^(file|data|blob):/.test(request.url())) sink.requests.push(request.url()); });
  page.on('pageerror', (error) => sink.pageErrors.push(error.stack ?? String(error)));
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
const violations = (page) => page.evaluate(() => window.__cspViolations ?? []);
const empty = (list) => Array.isArray(list) && list.length === 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => JSON.stringify(value).slice(0, 300);

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
async function saveByDownload(page, to, shortcut = false) {
  const [download] = await Promise.all([page.waitForEvent('download'), shortcut ? page.keyboard.press('Control+s') : page.getByRole('button', { name: 'Save', exact: true }).click()]);
  await download.saveAs(to);
  const scheme = download.url().split(':')[0];
  // The saved copy is the same shell with the same code: it parses, and it is a complete file.
  const html = readFileSync(to, 'utf8');
  if (!/<script type="application\/octet-stream" id="afbin-code">/.test(html)) throw new Error('the saved file is not a complete file');
  return { html, scheme, name: download.suggestedFilename() };
}
const savedFile = (html) => parseArtifactFile(JSON.parse(FILE_JSON.exec(html)[2]));
const saveButton = (page) => page.getByRole('button', { name: 'Save', exact: true });
const openedAs = path.basename(decodeURIComponent(new URL(coreUrl).pathname));

// ── one engine's lane ────────────────────────────────────────────────────────

/** Reading the downloaded file. */
async function reading(engineName, browser) {
  const name = `${engineName} (solid)`;
  const { step, run } = lane(check, name);
  const started = Date.now();
  await run(async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await serveOrigin(context, 'offline');
    const page = await context.newPage();
    const requests = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on('request', (request) => { if (!/^(file|data):/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await page.goto(coreUrl);

    await step('title and body, from inside the file', async () => {
      await expect(page.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Revenue by region and month')).toBeVisible();
      await expect(page.getByRole('status')).toHaveCount(0); // the "Opening …" placeholder is gone
    });
    check((await page.title()) === file.metadata.title, `${name}: document title`);
    await step('the top bar says offline copy, data as of, and links the live version', async () => {
      const bar = page.getByRole('banner', { name: 'Page bar' });
      await expect(bar).toContainText(file.metadata.title);
      await expect(bar).toContainText('Offline');
      const metrics = await page.getByRole('button', { name: 'Comment', exact: true }).evaluate(button => ({ height: button.getBoundingClientRect().height, radius: getComputedStyle(button).borderRadius, fontSize: getComputedStyle(button).fontSize, barHeight: button.closest('header').getBoundingClientRect().height, shadow: button.getRootNode() instanceof ShadowRoot }));
      check(metrics.shadow && metrics.barHeight === 44 && metrics.height === 36 && metrics.radius === '8px' && metrics.fontSize !== '40px', `${name}: shared protected chrome metrics ${JSON.stringify(metrics)}`);
      await page.getByRole('button', { name: 'Open artifact controls', exact: true }).click();
      const controls = page.getByRole('region', { name: 'Artifact controls' });
      await expect(controls).toContainText('Data as of');
      await expect(controls.getByRole('link', { name: 'Open live version' })).toHaveAttribute('href', file.liveUrl);
      await page.getByRole('button', { name: 'Dismiss Offline copy' }).click();
    });

    // The chart draws, from the same rows: one bar per month, summed.
    const chart = page.getByLabel('Question embed').first();
    const expectBars = async (rows) => {
      const sums = new Map();
      for (const row of rows) sums.set(row.month, (sums.get(row.month) ?? 0) + row.revenue);
      await expect(chart.locator('[data-mx-chart-state="ready"]')).toHaveCount(1, { timeout: 20_000 });
      await expect(chart.locator('.mark-rect path')).toHaveCount(sums.size);
      for (const [month, sum] of sums) await expect(chart.locator(`[aria-label="month: ${month}; Sum of revenue: ${sum}"]`)).toHaveCount(1);
    };
    await step('the chart draws its bars from the snapshot', () => expectBars(baseRows));

    // The snapshot's rows, then a LIVE query's: the engine loads from the file's own bytes behind the first paint.
    const table = page.getByRole('table').first();
    const bodyRows = table.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
    await step(`the table shows the snapshot's rows (${baseRows.length})`, async () => {
      await expect(bodyRows).toHaveCount(baseRows.length);
      for (const row of baseRows) await expect(table).toContainText(String(row.month));
    });
    await page.waitForTimeout(1000);
    await step(`changing the Select runs the query live (${westRows.length} west rows)`, async () => {
      await page.getByRole('button', { name: 'Region', exact: true }).click();
      await page.getByRole('option', { name: 'west', exact: true }).click();
      await expect(bodyRows).toHaveCount(westRows.length);
    });
    const notWest = (await bodyRows.allTextContents()).filter((text) => !/west/.test(text));
    check(notWest.length === 0, `${name}: a filtered row is not west: ${notWest.join(' | ')}`);
    await step('the chart redraws from the live run', () => expectBars(westRows));

    await step('the frozen Value: disabled, described, and its hint shows the reason', async () => {
      const frozen = page.getByRole('textbox', { name: 'Region pattern' });
      await expect(frozen).toBeDisabled();
      await expect(frozen).toHaveAttribute('aria-description', OFFLINE_FILTER_REASON);
      await page.locator(`[tabindex="0"][aria-description="${OFFLINE_FILTER_REASON}"]`).focus();
      await expect(page.getByRole('tooltip')).toContainText(OFFLINE_FILTER_REASON);
    });

    await step('the write: refused by name, never "Checking edit access…"', async () => {
      const add = page.getByRole('button', { name: 'Add a row' });
      await expect(add).toBeDisabled();
      await expect(add).toHaveAttribute('aria-description', OFFLINE_MUTATION_REASON);
      await expect(page.getByText(OFFLINE_MUTATION_REASON, { exact: true })).toHaveCount(0);
      await page.locator('[data-slot="tooltip-trigger"]').filter({ has: add }).click();
      await expect(page.getByRole('tooltip')).toHaveText(OFFLINE_MUTATION_REASON);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(page.getByText('Checking edit access…')).toHaveCount(0);
    });

    // Nothing left the file.
    const csp = await violations(page);
    check(empty(requests), `${name}: network requests ${show(requests)}`);
    check(empty(csp), `${name}: CSP violations ${show(csp)}`);
    check(empty(pageErrors), `${name}: page errors ${show(pageErrors)}`);
    // A browser without DecompressionStream: the boot script's plain message, and nothing else runs.
    const old = await context.newPage();
    const oldErrors = [];
    old.on('pageerror', (error) => oldErrors.push(String(error)));
    await old.addInitScript(() => { delete globalThis.DecompressionStream; });
    await old.goto(coreUrl);
    await step('unsupported-browser message without DecompressionStream', async () => {
      await expect(old.getByRole('alert')).toHaveText(ARTIFACT_FILE_UNSUPPORTED);
      await expect(old.getByRole('heading', { name: 'Regional sales' })).toBeVisible();
    });
    check(empty(oldErrors), `${name}: page errors without DecompressionStream ${show(oldErrors)}`);
    check.note(`${name}: reading in ${((Date.now() - started) / 1000).toFixed(1)}s${consoleErrors.length ? ` (console errors: ${consoleErrors.join(' | ')})` : ''}`);
    await context.close();
  });
}

/** Editing, commenting and saving, from file://. Returns the download's URL scheme. */
async function editing(engineName, browser) {
  const name = `${engineName} (solid, editing)`;
  const { step, run } = lane(check, name);
  const sink = { requests: [], pageErrors: [] };
  await run(async () => {
    // ── Asha edits the heading and saves ─────────────────────────────────────
    const asha = await newContext(browser);
    const page = await watchedPage(asha, sink);
    await page.goto(coreUrl);
    await step('Save starts disabled: "No changes to save"', async () => {
      await expect(page.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
      await expect(saveButton(page)).toBeDisabled();
      await expect(saveButton(page)).toHaveAccessibleDescription(NOTHING_TO_SAVE);
    });
    await step('edit in place: name prompt, heading edited, unsaved, Save enabled', async () => {
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await answerName(page, 'Asha');
      await expect(page.getByRole('tab', { name: 'Edit the source' })).toBeVisible({ timeout: 20_000 });
      await selectHeading(page, 'Regional'.length);
      // One edit transaction keeps WebKit's selection stable while the offline editor rerenders.
      await page.keyboard.insertText('Quarterly');
      await expect(page.getByRole('heading', { name: 'Quarterly sales' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible({ timeout: 10_000 });
      await expect(saveButton(page)).toBeEnabled();
    });

    // What needs artifactbin says so where its control is.
    await step('history, image URL and query notebook reasons', async () => {
      const history = page.getByRole('button', { name: 'History' }).first();
      await expect(history).toBeDisabled();
      await expect(history).toHaveAccessibleDescription(HISTORY_REASON);
      await page.getByRole('button', { name: 'Insert', exact: true }).click();
      await page.getByRole('button', { name: 'Image…' }).click();
      const imageUrl = page.getByRole('textbox', { name: 'Image URL' });
      await expect(imageUrl).toBeDisabled();
      await expect(imageUrl).toHaveAccessibleDescription(OFFLINE_ASSET_REASON);
      await expect(page.getByRole('button', { name: 'Import image from URL' })).toBeDisabled();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('tab', { name: 'Show data' }).click();
      await expect(page.getByText(`shape unavailable — ${OFFLINE_QUERY_REASON}`).first()).toBeVisible();
      await page.getByRole('tab', { name: 'Edit on the page' }).click();
    });

    const saved = path.join(work, `saved-${engineName}.html`);
    const first = await step('Save downloads the file, then nothing is unsaved', async () => {
      const result = await saveByDownload(page, saved, true);
      await page.getByRole('button', { name: 'Done editing' }).click();
      await expect(saveButton(page)).toBeDisabled();
      await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
      return result;
    });
    check.note(`${engineName}: Save → ${first.scheme}: download`);
    check(first.name === openedAs, `${name}: Save suggests the name the file was opened as`);
    check(empty(await violations(page)), `${name}: CSP violations while editing`);

    // ── that saved file, opened on its own ───────────────────────────────────
    const reopened = await watchedPage(asha, sink);
    await reopened.goto(pathToFileURL(saved).href);
    await step('reopened: the edit, and Changes by name', async () => {
      await expect(reopened.getByRole('heading', { name: 'Quarterly sales' })).toBeVisible({ timeout: 20_000 });
      await expect(reopened.getByRole('heading', { name: 'Regional sales', exact: true })).toHaveCount(0);
      await expect(reopened.getByRole('alertdialog')).toHaveCount(0); // no crash-buffer offer for a copy just saved
      await reopened.getByRole('button', { name: 'Open artifact controls' }).click();
      await reopened.getByRole('button', { name: /^Changes/ }).click();
      const changes = reopened.getByRole('region', { name: 'Changes in this file' });
      await expect(changes).toContainText('Asha');
      await expect(changes).toContainText("Edited text in 'Quarterly sales'");
      await reopened.getByRole('button', { name: /^Changes/ }).click();
      await reopened.getByRole('button', { name: 'Dismiss Offline copy' }).click();
    });

    // Invalid markup in code view: the validator's reason, and nothing applied.
    await step('the name is remembered: no prompt', async () => {
      await reopened.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(reopened.getByRole('dialog', { name: 'What should we call you?' })).toHaveCount(0);
    });
    check(empty(sink.requests), `${name}: requests before code view ${show(sink.requests)}`);
    const plain = reopened.getByRole('textbox', { name: 'Markup source' });
    await step('offline code view: plain editor with its reason, View formatted disabled', async () => {
      await reopened.getByRole('tab', { name: 'Edit the source' }).click();
      // Offline, code view is the plain editor, and says so in place; the one request was its extras.
      await expect(plain).toHaveAccessibleDescription(RICH_EDITOR_OFFLINE, { timeout: 20_000 });
      await expect(reopened.getByText(RICH_EDITOR_OFFLINE, { exact: true })).toBeVisible();
      await expect(reopened.locator('.cm-editor')).toHaveCount(0);
      const viewFormatted = reopened.getByRole('button', { name: 'View formatted' });
      await expect(viewFormatted).toBeDisabled();
      await expect(viewFormatted).toHaveAccessibleDescription(FORMATTING_OFFLINE);
    });
    check(same(sink.requests, [extrasUrl]), `${name}: code view asked for its extras, once ${show(sink.requests)}`);
    sink.requests.length = 0;
    await step('invalid code refused, not applied', async () => {
      await plain.fill(`${await plain.inputValue()}\n<p>{$missing}</p>`);
      await expect(reopened.getByRole('status').filter({ hasText: /not saved — .*\$missing.* refers to nothing declared/ })).toBeVisible({ timeout: 10_000 });
      await expect(saveButton(reopened)).toBeEnabled();
      const rejected = await plain.inputValue();
      await saveButton(reopened).click();
      await expect(reopened.getByRole('alert').filter({ hasText: 'Fix the source before saving' })).toBeVisible();
      await expect(plain).toHaveValue(rejected);
      await expect(reopened.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
      await reopened.getByRole('button', { name: 'Open artifact controls' }).click();
      await expect(reopened.getByRole('button', { name: /^Changes/ })).toHaveText('Changes (1)');
    });
    await step('phone source and comments share the viewport without overflowing the toolbar', async () => {
      await reopened.getByRole('button', { name: 'Dismiss Offline copy' }).click();
      const desktop = reopened.viewportSize();
      const sourceBeforeResize = await plain.inputValue();
      await reopened.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => reopened.evaluate(() => innerWidth)).toBe(390);
      for (const label of ['Page bar', 'Editor toolbar']) {
        const bounds = await reopened.getByRole('banner', { name: label }).boundingBox();
        check(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, `${name}: ${label} fits the phone viewport`);
      }
      await reopened.getByRole('button', { name: 'Comment', exact: true }).click();
      await expect(reopened.getByRole('dialog', { name: 'Annotation sidebar' })).toBeVisible();
      await expect(plain).toBeVisible();
      const reservation = await reopened.getByRole('region', { name: 'Source pane' }).evaluate(panel => ({ right: panel.style.right, margin: document.body.style.marginRight }));
      check(reservation.right === '0px' && reservation.margin !== '320px', `${name}: phone source remains full width beside the comments sheet`);
      await reopened.keyboard.press('Escape');
      await expect(reopened.getByRole('dialog', { name: 'Annotation sidebar' })).toHaveCount(0);
      await expect(plain).toHaveValue(sourceBeforeResize);
      await reopened.setViewportSize(desktop);
    });
    check(empty(await violations(reopened)), `${name}: CSP violations in the reopened copy`);

    // ── Ravi, somewhere else, comments on the copy he was sent ───────────────
    const ravi = await newContext(browser);
    const second = await watchedPage(ravi, sink);
    await second.goto(pathToFileURL(saved).href);
    const doc = second.locator('[data-mx-inline-story]');
    const commented = path.join(work, `commented-${engineName}.html`);
    const withThread = await step('comment → name prompt → reply → resolve → Save', async () => {
      await doc.locator(`#${headingId}`).waitFor({ timeout: 20_000 });
      const bubble = second.locator('[data-mx-selection-actions]');
      for (let i = 0; i < 40 && !(await bubble.isVisible().catch(() => false)); i++) {
        await doc.locator(`#${headingId}`).click({ clickCount: 3, timeout: 2000 }).catch(() => {});
        await second.waitForTimeout(250);
      }
      await second.getByRole('button', { name: 'Comment on selected text' }).click();
      await answerName(second, 'Ravi');
      await second.getByRole('textbox', { name: 'Annotation comment' }).fill('Is "Quarterly" right for a monthly table?');
      await second.getByRole('button', { name: 'Save annotation' }).click();
      await expect(doc.locator(`#${headingId}[data-mx-annotated]`)).toHaveCount(1, { timeout: 10_000 });
      if (!(await second.getByRole('complementary', { name: 'Annotation sidebar' }).isVisible().catch(() => false))) await second.getByRole('button', { name: 'Comment', exact: true }).click();
      const thread = second.getByLabel('Annotation thread', { exact: true }).first();
      await expect(thread).toContainText('Ravi');
      await expect(thread).toContainText('monthly table');
      if (!(await second.getByRole('textbox', { name: 'Reply to annotation' }).isVisible().catch(() => false))) await second.getByRole('button', { name: 'Open annotation thread' }).first().click();
      await second.getByRole('textbox', { name: 'Reply to annotation' }).first().fill('Checked: it is the Q3 view.');
      await second.getByRole('button', { name: 'Send reply' }).first().click();
      await expect(thread).toContainText('Checked: it is the Q3 view.');
      await second.getByRole('button', { name: 'Resolve annotation' }).first().click();
      await expect(second.getByLabel('Resolved annotation thread')).toHaveCount(1, { timeout: 10_000 });
      return saveByDownload(second, commented);
    });
    check(empty(await violations(second)), `${name}: CSP violations while commenting`);
    const written = savedFile(withThread.html);
    check(written.threads.length === 1, `${name}: the saved copy carries the thread`);
    check(written.threads[0]?.status === 'resolved', `${name}: the saved thread is resolved`);
    check(same(written.threads[0]?.thread.map((c) => c.author.label), ['Ravi', 'Ravi']), `${name}: both comments carry Ravi's name`);
    check(same(written.journal.map((e) => e.by), ['Asha']), `${name}: Asha's edit travels with the file`);

    const third = await watchedPage(ravi, sink);
    await third.goto(pathToFileURL(commented).href);
    await step('reopened: resolved thread with the name', async () => {
      await expect(third.getByRole('heading', { name: 'Quarterly sales' })).toBeVisible({ timeout: 20_000 });
      await third.getByRole('button', { name: 'Comment', exact: true }).click();
      const resolved = third.getByLabel('Resolved annotation thread');
      await expect(resolved).toHaveCount(1, { timeout: 10_000 });
      await expect(resolved).toContainText('Ravi');
      await expect(third.getByLabel('Annotation thread', { exact: true })).toHaveCount(0);
    });
    check(empty(await violations(third)), `${name}: CSP violations in the commented copy`);

    // ── the save picker, where the browser has one ───────────────────────────
    if (engineName === 'chromium') {
      const picked = await newContext(browser, { picker: true });
      const pickerPage = await watchedPage(picked, sink);
      await pickerPage.goto(coreUrl);
      await step('save picker written with the file name', async () => {
        await pickerPage.getByRole('button', { name: 'Edit', exact: true }).click();
        await answerName(pickerPage, 'Mei');
        await expect(pickerPage.getByRole('tab', { name: 'Edit the source' })).toBeVisible({ timeout: 20_000 });
        await selectHeading(pickerPage, 'Regional'.length);
        await pickerPage.keyboard.type('Picked');
        await expect(saveButton(pickerPage)).toBeEnabled({ timeout: 10_000 });
        await pickerPage.keyboard.press('Control+s');
        await expect(saveButton(pickerPage)).toBeDisabled({ timeout: 10_000 });
      });
      const { html, suggested } = await pickerPage.evaluate(() => ({ html: window.__written, suggested: window.__pickerName }));
      check(suggested === openedAs, `${name}: the picker suggests the name the file was opened as`);
      check(typeof html === 'string' && savedFile(html).source.includes('>Picked sales</h1>'), `${name}: the picker received the edited file`);
      check(empty(await violations(pickerPage)), `${name}: CSP violations with the picker`);
      await picked.close();
    }

    check(empty(sink.requests), `${name}: network requests ${show(sink.requests)}`);
    check(empty(sink.pageErrors), `${name}: page errors ${show(sink.pageErrors)}`);
    await asha.close();
    await ravi.close();
  });
}

/** Code view online: the extras from the file's origin. */
async function codeViewOnline(engineName, browser) {
  const name = `${engineName} (solid, code view online)`;
  const { step, run } = lane(check, name);
  const sink = { requests: [], pageErrors: [] };
  await run(async () => {
    const context = await newContext(browser, { origin: 'online' });
    const page = await watchedPage(context, sink);
    await page.goto(coreUrl);
    await step('Edit opens with the name prompt', async () => {
      await expect(page.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await answerName(page, 'Lin');
      await expect(page.getByRole('tab', { name: 'Edit the source' })).toBeVisible({ timeout: 20_000 });
    });
    check(empty(sink.requests), `${name}: nothing requested before code view ${show(sink.requests)}`);
    await step('SRI script loaded, CodeMirror mounted', async () => {
      await page.getByRole('tab', { name: 'Edit the source' }).click();
      await page.locator('.cm-editor').first().waitFor({ timeout: 30_000 });
      await expect(page.locator('script[data-afbin-extras]')).toHaveCount(1);
      await expect(page.getByText(RICH_EDITOR_OFFLINE)).toHaveCount(0);
    });
    const tag = page.locator('script[data-afbin-extras]');
    check((await tag.getAttribute('src')) === extrasUrl, `${name}: the extras script is the build's own URL`);
    check((await tag.getAttribute('integrity')) === manifest.extras.integrity, `${name}: the extras script is pinned by its SRI hash`);
    check((await tag.getAttribute('crossorigin')) === 'anonymous', `${name}: the extras script is loaded crossorigin=anonymous`);
    await step('View formatted', async () => {
      await page.getByRole('button', { name: 'View formatted' }).click();
      await expect(page.getByText('Formatted preview · read-only')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.cm-editor')).toHaveCount(2, { timeout: 20_000 });
      await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t format' })).toHaveCount(0);
    });
    check(same(sink.requests, [extrasUrl]), `${name}: the extras were the one request ${show(sink.requests)}`);
    check(empty(await violations(page)), `${name}: CSP violations`);
    await context.close();

    if (engineName === 'chromium') {
      // Bytes that do not match the file's hash: refused by SRI, and code view keeps the plain editor.
      const tampered = await newContext(browser, { origin: 'tampered' });
      const other = await watchedPage(tampered, { requests: [], pageErrors: sink.pageErrors });
      await other.goto(coreUrl);
      await step('tampered extras refused by SRI: code view keeps the plain editor', async () => {
        await other.getByRole('button', { name: 'Edit', exact: true }).click();
        await answerName(other, 'Lin');
        await other.getByRole('tab', { name: 'Edit the source' }).click();
        await expect(other.getByRole('textbox', { name: 'Markup source' })).toHaveAccessibleDescription(RICH_EDITOR_OFFLINE, { timeout: 20_000 });
        await expect(other.locator('.cm-editor')).toHaveCount(0);
      });
      check(await other.evaluate(() => typeof globalThis.__afbinExtras) === 'undefined', `${name}: tampered extras never ran`);
      await tampered.close();
    }
    check(empty(sink.pageErrors), `${name}: page errors ${show(sink.pageErrors)}`);
  });
}

/** A file edited by an agent: only the top-level "source" changed. */
async function editedByAnAgent(engineName, browser) {
  const name = `${engineName} (solid, edited by an agent)`;
  const { step, run } = lane(check, name);
  const sink = { requests: [], pageErrors: [] };
  await run(async () => {
    const context = await newContext(browser);
    const page = await watchedPage(context, sink);
    await page.goto(pathToFileURL(agentFiles.valid).href);
    const saved = await step('rebuilt from the new source, journal line, Save writes it', async () => {
      await expect(page.getByRole('heading', { name: 'Sales, edited by an agent' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Added offline section' })).toBeVisible();
      await expect(page.locator('#offline-added-section')).toContainText('Structure travels with the saved file.');
      await page.getByRole('button', { name: 'Region', exact: true }).click();
      await page.getByRole('option', { name: 'west', exact: true }).click();
      await expect(page.getByRole('table').first().getByRole('row').filter({ hasNot: page.getByRole('columnheader') })).toHaveCount(westRows.length);
      await expect(page.getByRole('heading', { name: 'Regional sales', exact: true })).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
      await page.getByRole('button', { name: 'Open artifact controls' }).click();
      await page.getByRole('button', { name: /^Changes/ }).click();
      await expect(page.getByRole('region', { name: 'Changes in this file' })).toContainText(CHANGED_OUTSIDE);
      await page.getByRole('button', { name: /^Changes/ }).click();
      await page.getByRole('button', { name: 'Dismiss Offline copy' }).click();
      await expect(saveButton(page)).toBeEnabled();
      return saveByDownload(page, path.join(work, `agent-saved-${engineName}.html`));
    });
    const written = savedFile(saved.html);
    check(written.source.includes('>Sales, edited by an agent</h1>'), `${name}: the saved file keeps the agent's text`);
    check(JSON.stringify(written.island.nodes).includes('Added offline section'), `${name}: added structure is retained in the saved snapshot`);
    const savedPage = await watchedPage(context, sink);
    await savedPage.goto(pathToFileURL(path.join(work, `agent-saved-${engineName}.html`)).href);
    await expect(savedPage.getByRole('heading', { name: 'Added offline section' })).toBeVisible({ timeout: 20_000 });
    await savedPage.close();
    check(JSON.stringify(written.island.nodes).includes('Sales, edited by an agent'), `${name}: and the rebuilt render`);
    check(same(written.journal.map((e) => e.summary), [CHANGED_OUTSIDE]), `${name}: the journal says the file was changed outside`);
    check(empty(await violations(page)), `${name}: CSP violations`);

    const invalid = await watchedPage(context, sink);
    await invalid.goto(pathToFileURL(agentFiles.invalid).href);
    await step('invalid source: banner with the error over the last good render', async () => {
      await expect(invalid.getByRole('heading', { name: 'Regional sales' })).toBeVisible({ timeout: 20_000 });
      const banner = invalid.getByRole('alert').filter({ hasText: 'changed outside this file' });
      await expect(banner).toContainText(/\$missing.* refers to nothing declared/);
      await expect(invalid.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
      await expect(invalid.getByRole('table').first()).toBeVisible();
    });
    check(empty(await violations(invalid)), `${name}: CSP violations with an invalid source`);

    const changedQuery = await watchedPage(context, sink);
    await changedQuery.goto(pathToFileURL(agentFiles.query).href);
    await step('changed query: no stale rows', async () => {
      await expect(changedQuery.getByText(OFFLINE_QUERY_REASON, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(changedQuery.getByRole('table').first().getByText('2026-07')).toHaveCount(0);
    });
    check(empty(await violations(changedQuery)), `${name}: CSP violations after an agent changes the query`);

    check(empty(sink.requests), `${name}: network requests ${show(sink.requests)}`);
    check(empty(sink.pageErrors), `${name}: page errors ${show(sink.pageErrors)}`);
    await context.close();
  });
}

/** The prose and Mermaid files: which engines travel, and an offline paint. */
async function engineChoice(engineName, browser) {
  for (const { label, url } of engineFiles) {
    const name = `${engineName} ${label}`;
    const { step, run } = lane(check, name);
    await run(async () => {
      const context = await browser.newContext();
      await serveOrigin(context, 'offline');
      const page = await context.newPage();
      const requests = [], pageErrors = [];
      page.on('request', (request) => { if (!/^(file|data):/.test(request.url())) requests.push(request.url()); });
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations ??= [];
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
      }));
      await page.goto(url);
      await step('offline paint', async () => {
        await expect(page.getByRole('heading', { name: label === 'prose' ? 'Offline prose' : 'Offline diagram' })).toBeVisible({ timeout: 20_000 });
        if (label === 'mermaid') await expect(page.locator('[data-mx-mermaid-state="ready"]')).toHaveCount(1, { timeout: 20_000 });
      });
      const csp = await violations(page);
      check(empty(requests), `${name}: network requests ${show(requests)}`);
      check(empty(pageErrors), `${name}: page errors ${show(pageErrors)}`);
      check(empty(csp), `${name}: CSP violations ${show(csp)}`);
      await context.close();
    });
  }
}

/** A real packaged CLI, deliberately started without selecting any workspace file. */
async function emptyPreview(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'unselected.jsx'), '<p>Do not expose this file</p>');
  const child = spawn(process.execPath, [path.join(ROOT, 'services/cli/dist/afbin.mjs'), 'preview', '--port', '0', '--json'], {
    cwd: directory, env: { ...process.env, HOME: directory, ARTIFACTBIN_HOME: path.join(directory, '.client'), ARTIFACTBIN_TOKEN: '', ARTIFACTBIN_REFRESH_TOKEN: '', ARTIFACTBIN_SKILLS: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const closed = new Promise((resolve) => child.once('exit', resolve));
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(force); }
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(Error(`Empty preview did not start: ${errors.slice(-1000)}`)), 30_000);
      const fail = (error) => { clearTimeout(deadline); reject(error); };
      child.once('error', fail);
      child.once('exit', (code) => fail(Error(`Empty preview exited ${code}: ${errors.slice(-1000)}`)));
      child.stdout.on('data', (chunk) => {
        output += chunk;
        for (const line of output.split('\n')) {
          try {
            const value = JSON.parse(line);
            if (typeof value.url === 'string' && Array.isArray(value.files) && value.files.length === 0) {
              clearTimeout(deadline); resolve(value.url); return;
            }
          } catch { /* wait for a complete JSON line */ }
        }
      });
    });
    return { url, close };
  } catch (error) { await close(); throw error; }
}

// Gate caches intentionally omit the CLI's hosted-app runtime. This gate also exercises preview,
// so prepare its narrower runtime once, before the three browser lanes start concurrently.
if (!existsSync(path.join(ROOT, 'services/cli/dist/runtime/bootstrap.cjs'))) {
  execFileSync(process.execPath, ['scripts/build/build-preview-gate-inputs.mjs'], { cwd: ROOT, stdio: 'inherit' });
}

/** Explicit file:// handoff into the existing editor, without granting the file network access. */
async function connecting(engineName, browser) {
  const { step, run } = lane(check, `${engineName} (portable file → empty preview)`);
  const directory = path.join(work, `connect-${engineName}`);
  const server = await emptyPreview(directory);
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = [];
  const browserEvents = [];
  context.on('requestfailed', request => browserEvents.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
  context.on('response', response => { if (/\/(?:bundle|draft|save)(?:\/|$)/.test(new URL(response.url()).pathname)) browserEvents.push({ type: 'response', url: response.url(), status: response.status() }); });
  context.on('page', (opened) => { opened.on('pageerror', (error) => errors.push(String(error))); opened.on('console', message => { if (['error', 'warning'].includes(message.type())) browserEvents.push({ type: 'console', level: message.type(), text: message.text() }); }); });
  page.on('pageerror', (error) => errors.push(String(error)));
  const prose = engineFiles.find((entry) => entry.label === 'prose');
  const originalPath = fileURLToPath(prose.url);
  const originalHtml = readFileSync(originalPath, 'utf8');
  try {
    await run(async () => {
      await page.goto(prose.url);
      await expect(page.getByRole('heading', { name: 'Offline prose' })).toBeVisible({ timeout: 20_000 });
      await step('edit and comment stay unsaved in the original file', async () => {
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await answerName(page, 'Local reviewer');
        await page.getByRole('heading', { name: 'Offline prose' }).evaluate((heading) => {
          (heading.closest('.ProseMirror') ?? heading).focus({ preventScroll: true });
          const text = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode();
          const selection = window.getSelection();
          selection.removeAllRanges(); selection.setBaseAndExtent(text, 0, text, text.textContent.length);
        });
        await page.keyboard.insertText('Connected prose');
        await page.getByRole('button', { name: 'Done editing' }).click();
        await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible().catch(async (error) => {
          throw new Error(`editor feedback: ${JSON.stringify(await page.evaluate(() => ({feedback: [...document.querySelectorAll('[role="status"], [role="alert"]')].map(node => node.textContent), buttons: [...document.querySelectorAll('button')].map(node => node.textContent)})))}; ${error.message}`);
        });
        await expect(page.getByRole('heading', { name: 'Connected prose' })).toBeVisible();
        await page.getByRole('heading', { name: 'Connected prose' }).evaluate((heading) => {
          const range = document.createRange(); range.selectNodeContents(heading);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        });
        await page.getByRole('button', { name: 'Comment on selected text' }).click();
        await page.getByRole('textbox', { name: 'Annotation comment' }).fill('This comment must travel to the local editor.');
        await page.getByRole('button', { name: 'Save annotation' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
      });
      let popup;
      await step('connect offers the copy, then explicit import opens the existing editor', async () => {
        await page.getByRole('button', { name: 'Connect to server', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Connect to server', exact: true });
        await dialog.getByRole('textbox', { name: 'Server address' }).fill(server.url);
        [popup] = await Promise.all([page.waitForEvent('popup'), dialog.getByRole('button', { name: 'Connect', exact: true }).click()]);
        await expect(popup.getByRole('button', { name: 'Import and open', exact: true })).toBeEnabled({ timeout: 20_000 });
        await expect(popup.getByRole('heading', { name: 'Import an HTML file', exact: true })).toHaveCount(1);
        await expect(popup.getByRole('banner', { name: 'Page bar' })).toHaveCount(1);
        await expect(popup.getByRole('main')).toHaveCount(1);
        const brand = popup.getByRole('banner', { name: 'Page bar' }).locator('img');
        await brand.evaluate(image => image.decode());
        check(await brand.evaluate(image => image.naturalWidth > 0 && image.getBoundingClientRect().width === 28), `${engineName}: receiver displays the shared embedded brand`);
        const headingTop = await popup.getByRole('heading', { name: 'Import an HTML file', exact: true }).evaluate(heading => heading.getBoundingClientRect().top);
        check(headingTop >= 100, `${engineName}: receiver uses shared form-page spacing below its bar`);
        // The handoff is an offer. There is no filesystem write until this confirmation.
        check(!readFileSync(path.join(directory, 'unselected.jsx'), 'utf8').includes('Connected'), `${engineName}: unselected source unchanged`);
        await popup.getByRole('textbox', { name: 'Workspace file', exact: true }).fill('connected.jsx');
        await popup.getByRole('button', { name: 'Import and open', exact: true }).click();
        await expect(popup.getByRole('heading', { name: 'Connected prose' })).toBeVisible({ timeout: 20_000 });
        await expect(popup.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Open server editor', exact: true })).toBeVisible();
      });
      await step('comments travel and server source edits persist in the workspace copy', async () => {
        let sourceBeforeInput, sourceAfterInput;
        try {
        const response = await fetch(`${server.url}/editor`, { method: 'POST', headers: { origin: server.url, 'content-type': 'application/json' }, body: JSON.stringify({ file: 'connected.jsx', operation: 'annotations.list', status: 'open' }) });
        check(response.ok, `${engineName}: imported comments can be read through the existing backend`);
        const threads = await response.json();
        check(threads.some((thread) => thread.thread?.some((comment) => comment.body === 'This comment must travel to the local editor.')), `${engineName}: unsaved comment retained`);
        await popup.getByRole('button', { name: 'Edit', exact: true }).click();
        await popup.getByRole('tab', { name: 'Edit the source', exact: true }).click();
        await popup.locator('.cm-editor').waitFor();
        const source = popup.getByRole('textbox', { name: 'Markup source' });
        const beforeSource = sourceBeforeInput = await source.evaluate(node => 'value' in node ? node.value : node.textContent);
        if (!beforeSource.includes('Connected prose')) throw new Error(`Source editor does not contain the imported heading: ${JSON.stringify(beforeSource)}`);
        // Match a user pasting into the focused editor; WebKit fill() left CM DOM unchanged.
        await popup.bringToFront();
        await source.click();
        await source.press('ControlOrMeta+a');
        await popup.keyboard.insertText(beforeSource.replace('Connected prose', 'Saved on the server'));
        sourceAfterInput = await source.evaluate(node => 'value' in node ? node.value : node.textContent);
        // Native contenteditable changes reach CodeMirror's model through its DOM observer.
        // Observe the real source adapter and projection before asking Done to persist that model.
        await expect(popup.getByRole('status').filter({ hasText: /^Unsaved$/ })).toBeVisible();
        await expect(popup.getByRole('heading', { name: 'Saved on the server' })).toBeVisible();
        check(empty(await violations(popup)), `${engineName}: preview editor retains strict CSP without violations`);
        await popup.getByRole('button', { name: 'Done editing', exact: true }).click();
        await expect(popup.getByRole('heading', { name: 'Saved on the server' })).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => readFileSync(path.join(directory, 'connected.jsx'), 'utf8')).toContain('Saved on the server');
        check(true, `${engineName}: full server editor writes imported JSX`);
        await expect(page.getByRole('heading', { name: 'Connected prose' })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
        check(readFileSync(originalPath, 'utf8') === originalHtml, `${engineName}: original HTML remains unchanged`);
        check(empty(await violations(page)), `${engineName}: connection needs no CSP relaxation`);
        check(empty(errors), `${engineName}: no connection/editor page errors ${show(errors)}`);
        } catch (error) {
          const snapshot = await popup.evaluate(() => {
            const roots = [document, ...Array.from(document.querySelectorAll('[data-trusted-ui]')).flatMap(host => host.shadowRoot ? [host.shadowRoot] : [])];
            const nodes = selector => roots.flatMap(root => Array.from(root.querySelectorAll(selector)));
            const describe = node => ({ tag: node.tagName, label: node.getAttribute('aria-label'), text: 'value' in node ? node.value : node.textContent, visible: node.getClientRects().length > 0 });
            let active = document.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            return { url: location.href, ready: document.documentElement.getAttribute('data-mx-ready'), active: active ? describe(active) : null,
              tabs: nodes('[role="tab"]').map(node => ({ ...describe(node), selected: node.getAttribute('aria-selected') })),
              statuses: nodes('[role="status"], [role="alert"]').map(describe), sources: nodes('[aria-label="Markup source"]').map(describe),
              editors: nodes('.cm-editor').map(node => ({ ...describe(node), html: node.outerHTML.slice(0, 12000) })),
              headings: nodes('h1,h2').map(describe), csp: window.__cspViolations ?? [] };
          }).catch(reason => ({ snapshotError: String(reason) }));
          const documentResponse = await fetch(`${server.url}/document?file=connected.jsx`);
          const saved = documentResponse.ok ? await documentResponse.json() : { status: documentResponse.status };
          check.note(`${engineName} Preview diagnostic: ${JSON.stringify({ sourceBeforeInput, sourceAfterInput, snapshot, server: { body: saved.body, revision: saved.revision, title: saved.metadata?.title }, errors, browserEvents })}`);
          throw error;
        }
      });
    });
  } finally { await context.close(); await server.close(); }
}

// ── the screenshot comment, on the gate's server ─────────────────────────────

const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 220, g: 30, b: 30 } } }).png().toBuffer();

/** Real tab capture in Chromium; the upload fallback elsewhere; brush; persisted through a reload. */
async function screenshotComment(engineName, dpr, selectionWidth, selectionHeight) {
  const name = `${engineName} (DPR ${dpr}) screenshot comment`;
  const { step, must, run } = lane(check, name);
  let browser;
  await run(async () => {
    // Each case needs an unannotated pixel reference; prior comments paint overlays.
    const seed = await startDocument(BASE);
    const published = await fetch(`${BASE}/api/artifacts/${seed.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${seed.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Screenshot capture gate', markup: '<Helmet><style>{`#capturebox{width:400px;height:240px;background:rgb(220,30,30);margin:100px 40px}`}</style></Helmet><div id="capturebox"><p>Screenshot capture fixture</p></div>', visibility: 'unlisted' }) });
    must(published.ok, `publish: ${published.status}`);
    const docHost = `${Buffer.from(seed.id, 'utf8').toString('hex')}.${PAGES_HOST}`;
    // The app is at app.lvh.me and the document on <hex id>.lvh.me (lib/browser.mjs): Chromium is told the mapping by
    // flag, Firefox by its resolver prefs; WebKit has neither and resolves lvh.me (public DNS: loopback).
    const local = [new URL(BASE).hostname, PAGES_HOST, docHost].join(',');
    // Both origins are plain http here, which is not a secure context off localhost: screen capture needs one (as it
    // has in production, over https), so Chromium is told to treat these two as secure.
    const secure = [new URL(BASE).origin, `http://${docHost}:${new URL(BASE).port}`].join(',');
    browser = engineName === 'chromium'
      ? await launchChromium({ channel: 'chromium', args: [`--unsafely-treat-insecure-origin-as-secure=${secure}`, '--enable-usermedia-screen-capturing', '--auto-select-tab-capture-source-by-title=Screenshot capture gate', '--allow-http-screen-capture', '--autoplay-policy=no-user-gesture-required'] })
      : engineName === 'firefox'
        ? await firefox.launch({ firefoxUserPrefs: { 'network.dns.localDomains': local, 'network.dns.forceResolve': '127.0.0.1' } })
        : await webkit.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.addInitScript(() => { window.__captureTrace = []; const native = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices); if (native) navigator.mediaDevices.getDisplayMedia = async (...args) => { try { const stream = await native(...args); window.__captureTrace.push({ event: 'stream', surface: stream.getVideoTracks()[0]?.getSettings().displaySurface }); const reference = document.createElement('video'); reference.muted = true; reference.srcObject = stream; window.__captureReference = reference; void reference.play(); return stream; } catch (e) { window.__captureTrace.push({ event: 'error', message: e.message }); throw e; } }; });
    await becomeOwner(page, BASE, seed.token);
    await page.goto(`${BASE}/a/${seed.id}`);
    // The document is framed on its own origin; the rail, tools and composer are the app page's.
    const doc = documentLocator(page);
    await step('Select is the default comment tool', async () => {
      await doc.locator('#capturebox').waitFor();
      await openArtifactControls(page);
      await page.getByRole('button', { name: 'Toggle comments', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
    check(same(await page.evaluate(() => window.__captureTrace), []), `${name}: Select must not request screen sharing`);
    await step('the Screenshot tool is active', async () => {
      await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Screenshot tool active' })).toHaveText(/drag an area/, { timeout: 20000 });
    });
    const box = await doc.locator('#capturebox').boundingBox();
    must(box, 'the capture box has a box');
    let referencePixel = [220, 30, 30];
    if (engineName === 'chromium') {
      await step('the tab capture stream plays', () => expect.poll(() => page.evaluate(() => window.__captureReference?.readyState ?? 0)).toBeGreaterThanOrEqual(2));
      referencePixel = await page.evaluate(({ x, y }) => { const v = window.__captureReference, c = document.createElement('canvas'); c.width = innerWidth; c.height = innerHeight; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return Array.from(c.getContext('2d').getImageData(x + 35, y + 65, 1, 1).data).slice(0, 3); }, box);
    }
    await page.mouse.move(box.x + 30, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 30 + selectionWidth, box.y + 60 + selectionHeight, { steps: 12 }); await page.mouse.up();
    const selectionFinished = Date.now();
    if (engineName !== 'chromium') {
      await step('without capture, Save waits for an uploaded screenshot', async () => {
        await expect(page.getByLabel('Save annotation', { exact: true })).toBeDisabled();
        await page.getByLabel('Upload screenshot', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: input });
      });
    }
    const editor = page.getByRole('dialog', { name: 'Annotation composer', exact: true });
    const canvas = editor.getByLabel('Screenshot drawing canvas');
    await step('the composer opens on the screenshot', async () => {
      try { await editor.waitFor({ timeout: 20000 }); } catch (error) { console.error(name, { alerts: await page.getByRole('alert').allTextContents(), status: await page.getByRole('status').allTextContents(), trace: await page.evaluate(() => window.__captureTrace), timings: await page.evaluate(() => performance.getEntriesByType('measure').filter(e => e.name.startsWith('comment-screenshot:')).map(e => e.toJSON())), composer: await page.getByRole('dialog', { name: 'Annotation composer' }).count() }); throw error; }
      await expect(canvas).toHaveAttribute('aria-busy', 'false');
      await editor.getByLabel('Annotation comment', { exact: true }).pressSequentially(`Screenshot from ${engineName} at DPR ${dpr}`);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Use screenshot' })).toHaveCount(0);
    });
    if (engineName === 'chromium') check.note(`chromium (DPR ${dpr}): release-to-editor ${Date.now() - selectionFinished}ms; crop/encode ${await page.evaluate(() => performance.getEntriesByName('comment-screenshot:capture').at(-1)?.duration.toFixed(1))}ms`);
    // Exact crop corner must contain content, not a selection outline or app panel.
    const pixel = await canvas.evaluate(c => Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data));
    check(pixel.slice(0, 3).every((value, i) => Math.abs(value - referencePixel[i]) <= 3), `${name}: content pixel ${pixel}; unmarked reference ${referencePixel}`);
    await step('the brush paints a stroke', async () => {
      await editor.getByLabel('Brush color', { exact: true }).fill('#00ff00');
      await editor.getByLabel('Brush thickness').fill('8');
      const drawing = await canvas.boundingBox();
      if (!drawing) throw new Error('the drawing canvas has no box');
      await page.mouse.move(drawing.x + 30, drawing.y + 30); await page.mouse.down(); await page.mouse.move(drawing.x + 130, drawing.y + 50, { steps: 10 }); await page.mouse.up();
      await expect(editor.getByRole('button', { name: 'Undo stroke' })).toBeEnabled();
      // Strokes paint on requestAnimationFrame; wait for the pixels, not just the undo button.
      await expect.poll(() => canvas.evaluate(c => { const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 30 && pixels[i + 1] > 200 && pixels[i + 2] < 30) count++; return count; })).toBeGreaterThan(100);
      await expect(editor.getByLabel('Annotation comment', { exact: true })).toHaveValue(`Screenshot from ${engineName} at DPR ${dpr}`);
    });
    await step('the comment saves and its screenshot persists through a reload', async () => {
      await page.getByLabel('Save annotation', { exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Annotation composer' })).toHaveCount(0);
      await page.reload();
      await openArtifactControls(page); await page.getByRole('button', { name: 'Toggle comments', exact: true }).click();
      await expect(doc.locator('#capturebox')).toHaveCSS('background-color', 'rgb(220, 30, 30)');
      await page.getByRole('img', { name: 'Screenshot attached to comment' }).last().waitFor();
    });
    const thumbnail = page.getByRole('img', { name: 'Screenshot attached to comment' }).last();
    await step('persisted thumbnail', async () => {
      // Visibility precedes image decoding; wait for the persisted bytes, not only the img element.
      await expect.poll(() => thumbnail.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    });
    await step('the screenshot opens', async () => {
      await page.getByRole('button', { name: 'Open comment screenshot' }).last().click();
      await expect(page.getByRole('dialog', { name: 'Comment screenshot' })).toBeVisible();
    });
  });
  await browser?.close();
}

// ── the three engines, concurrently ──────────────────────────────────────────

const SCREENSHOT_CASES = { chromium: [[1, 200, 100], [2.2, 235, 235]], firefox: [[1, 200, 100]], webkit: [[1, 200, 100]] };
const started = Date.now();
await Promise.all(ENGINES.map(async ([engineName, engine]) => {
  const at = Date.now();
  const browser = await engine.launch();
  try {
    await reading(engineName, browser);
    await editing(engineName, browser);
    await codeViewOnline(engineName, browser);
    await editedByAnAgent(engineName, browser);
    await engineChoice(engineName, browser);
    await connecting(engineName, browser);
  } finally {
    await browser.close();
  }
  for (const [dpr, width, height] of SCREENSHOT_CASES[engineName]) await screenshotComment(engineName, dpr, width, height);
  check.note(`${engineName} lane: ${((Date.now() - at) / 1000).toFixed(1)}s`);
}));
check.note(`three engines in ${((Date.now() - started) / 1000).toFixed(1)}s`);
check.done();
