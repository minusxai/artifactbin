// The cwd contract (P3 §B.4): the app's cwd is its package dir. Eight modules
// read process.cwd() — lib/story/document.ts, lib/story/runtime-asset.ts,
// lib/skills/tree.ts, lib/data/story/story-guidance.ts, lib/data/story/story-css.server.ts,
// server/app.ts — so the runners (scripts/dev.mjs, scripts/gates.mjs, evals/lib/server.ts)
// and this setup all hand them services/app as the cwd.
process.chdir(process.env.APP_PACKAGE_ROOT ?? path.resolve(import.meta.dirname, '../..')); // cwd = services/app

// Trimmed from minusx test/setup/vitest.setup.ts — the engine has no DB or
// orchestrator here.
import { vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// The object store's bytes go to a dir PER WORKER. The default
// (`.artifact-objects` in the repo) is shared by every parallel test file and
// by any dev server running alongside — and keys are content-addressed, so two
// workers writing the same key at once let a third read a half-written file
// (`Unexpected end of JSON input` out of `loadDatasetRows`, seen roughly one
// run in three). Set before any module reads it: `lib/config` samples the
// environment at import, and setup files run first.
process.env.OBJECT_STORE__LOCAL_DIR ??= path.join(os.tmpdir(), `artifact-objects-test-${process.pid}`);

/**
 * THE SUITE IS A COMPOSITION ROOT TOO. The app receives its services by
 * injection (`lib/services`) and never decides for itself where DuckDB or
 * Chromium run — so if nothing registers them here, every test that touches
 * SQL gets `service_unavailable` and every export a 503. `server.mts` does
 * this for the running server; this does it for the suite.
 *
 * SQL is registered EAGERLY and costs nothing: the engine imports
 * `@duckdb/node-api` lazily, on the first query, so a test file that never
 * runs SQL never loads the native module. It is given the app's own caps, so
 * the suite is bounded exactly as the server is.
 *
 * The BROWSER is registered LAZILY, and that is deliberate. Its `./local`
 * entry imports Playwright at module scope, this file runs for EVERY test file
 * in all three projects (with a fresh module registry each time), and the
 * handful of tests that shoot a page would have made the other few hundred pay
 * to load a browser driver — under jsdom too. So it stands in with a service
 * that resolves the real one on the first render and never before: nothing to
 * launch, nothing to close, for a suite that never asks for a picture.
 */
const { setServices } = await import('@/lib/services');
const { MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } = await import('@/lib/config');
const { createSql } = await import('@artifactbin/sql/local');

let localBrowser: import('@artifactbin/contracts').BrowserService | undefined;
const browser = async () => (localBrowser ??= (await import('@artifactbin/browser/local')).createBrowser());

setServices({
  sql: createSql({ maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS }),
  browser: {
    render: async (request) => (await browser()).render(request),
    // Never launches one just to close it: `resetExportRenderer` runs in
    // suites that took no picture at all.
    close: async () => { await localBrowser?.close?.(); localBrowser = undefined; },
  },
});
