/**
 * THE OFFLINE FILE, OPENED THE WAY A READER OPENS IT: a double-clicked `.html`
 * from file://, in Chromium, Firefox and WebKit, with no server anywhere.
 *
 * Renders the checked-in fixture (scripts/fixtures/offline-file, a small
 * dashboard) through the real lib/offline/file-html writer with the real
 * core offline bundle, writes it to a temp dir and asserts, per engine:
 *  - the title and body render, from inside the file;
 *  - the table shows the snapshot's rows, and changing the Select swaps to
 *    the precomputed variant's rows;
 *  - the frozen text input is disabled with OFFLINE_FILTER_REASON (and its
 *    hint says so on focus);
 *  - the <Mutation> button says OFFLINE_MUTATION_REASON, never an access check;
 *  - the Vega chart draws its bars from the snapshot, then from the variant;
 *  - nothing but file:/data: is requested, no Content-Security-Policy
 *    violation fires (a blocked fetch never reaches the request log, so this
 *    is the check that would catch one), and no page error is thrown.
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
const { renderArtifactFileHtml, parseArtifactFile, ARTIFACT_FILE_CSP, OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON } = await import(pathToFileURL(shim).href);

const file = parseArtifactFile(JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/offline-file/artifact-file.json'), 'utf8')));
const manifest = JSON.parse(readFileSync(path.join(APP, 'lib/story-runtime/dist/offline/manifest.json'), 'utf8'));
const code = readFileSync(path.join(APP, 'lib/story-runtime/dist/offline', manifest.bundles[file.bundle].file)).toString('base64');
const htmlPath = path.join(work, 'Regional sales.html');
writeFileSync(htmlPath, renderArtifactFileHtml({ file, code }));
const url = pathToFileURL(htmlPath).href;
console.log(`file: ${(Buffer.byteLength(readFileSync(htmlPath)) / 1024).toFixed(0)} KB (${file.bundle} bundle), CSP: ${ARTIFACT_FILE_CSP}`);

const baseRows = file.snapshot.state.tables.sales.rows;
const westRows = file.snapshot.variants.find((v) => v.values.region === 'west').tables.sales.rows;
const failures = [];

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
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
    console.log(`${name}: title, body, top bar, snapshot rows (${baseRows.length}) → west variant (${westRows.length}), frozen input, mutation reason, chart, 0 requests, 0 CSP violations, 0 page errors — passed in ${((Date.now() - started) / 1000).toFixed(1)}s${consoleErrors.length ? ` (console errors: ${consoleErrors.join(' | ')})` : ''}`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`));
    console.log(`${name}: FAILED — ${error.message}`);
  } finally {
    await browser.close();
  }
}
if (failures.length) throw new AggregateError(failures, 'Offline file checks failed');
console.log('offline file gate passed in chromium, firefox and webkit');
