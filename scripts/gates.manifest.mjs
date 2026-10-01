/**
 * THE GATE MANIFEST — what each browser gate needs, beside the one runner (scripts/gates.mjs).
 *
 * Disk discovery stays (a `gate-*.mjs` cannot go missing); this file adds what discovery cannot see:
 * whether a gate reads the mail sink, which gates must
 * never overlap, and how long each may run. The runner asserts a BIJECTION between the files on disk and
 * the rows here at startup and refuses to run otherwise — a new gate without a row, or a row without a
 * file, is a failure, not a silent skip.
 *
 * EVERY FIELD IS READ BY THE RUNNER. A field no code consults is a second source of truth that cannot
 * be wrong loudly — which is why the rows carry nothing the runner does not read.
 *
 * TIMEOUTS ARE A MEASUREMENT, not a guess: `timeoutMs = max(60_000, 3 × measured seconds)`, rounded up to
 * the next ten seconds. Three times, because a gate sharing a machine with five others is slower than one
 * run alone; the floor, because a cold start is most of a short gate's time. The numbers below were taken
 * one gate at a time on one server (`node scripts/gates.mjs --servers=1 --only=<name>`). CI's shards are
 * balanced on `seconds` instead (see `shardWeight`): the gate's measured CI time, re-read from a run's logs.
 *
 * @typedef {object} GateSpec
 * @property {string} name            `gate-<name>.mjs`
 * @property {boolean} needsMail      reads a login code from the mail sink
 * @property {string} [serialGroup]   gates in the same group never run concurrently, even across servers
 * @property {string[]} [browsers]    engines required by the default gate invocation; defaults to Chromium
 * @property {number} seconds         measured CI duration under two-server load — the shard weight
 * @property {number} timeoutMs       the runner kills the gate past this (integer > 0)
 */

/** @type {readonly GateSpec[]} */
export const GATE_SPECS = Object.freeze([
  { name: 'screenshot-comments', browsers: ['chromium', 'firefox', 'webkit'], needsMail: false, seconds: 25, timeoutMs: 150_000 },
  // Needs no server: opens rendered offline files from file:// in all three engines (reading, editing,
  // comments, Save, code view offline and online, agent-edited files). Measured 42–44s in the
  // playwright:v1.62.1-noble image on a laptop and 39s on macOS; CI runners are slower (an earlier,
  // smaller version overran 60s there), so the budget is ~5x the measured run.
  { name: 'offline-file', browsers: ['chromium', 'firefox', 'webkit'], needsMail: false, seconds: 59, timeoutMs: 240_000 },
  { name: 'cli-conformance', needsMail: true, seconds: 13, timeoutMs: 180_000 },
  { name: 'browser-sessions', needsMail: false, seconds: 31, timeoutMs: 150_000 },
  { name: 'chart-width', needsMail: false, seconds: 7, timeoutMs: 90_000 },
  { name: 'testusers', needsMail: true, seconds: 11, timeoutMs: 60_000 },
  { name: 'comment-targets', needsMail: false, seconds: 18, timeoutMs: 60_000 },
  { name: 'dataset-policies', needsMail: true, seconds: 9, timeoutMs: 60_000 },
  { name: 'app-home', needsMail: false, serialGroup: 'clipboard', seconds: 2, timeoutMs: 120_000 },
  { name: 'seamless-navigation', needsMail: true, seconds: 7, timeoutMs: 60_000 },
  { name: 'managed-iframe', needsMail: false, seconds: 22, timeoutMs: 60_000 },
  { name: 'libraries', needsMail: false, seconds: 11, timeoutMs: 60_000 },
  { name: 'postgres-datasets', needsMail: true, seconds: 15, timeoutMs: 60_000 },
  { name: 'annotations', needsMail: false, seconds: 21, timeoutMs: 60_000 },
  { name: 'app-flows', needsMail: true, seconds: 66, timeoutMs: 210_000 },
  { name: 'claim-flow', needsMail: true, seconds: 9, timeoutMs: 60_000 },
  { name: 'collab-edit', needsMail: true, seconds: 40, timeoutMs: 100_000 },
  { name: 'data-ux', needsMail: false, seconds: 17, timeoutMs: 60_000 },
  { name: 'dataflow', needsMail: true, seconds: 15, timeoutMs: 60_000 },
  // Split three ways (the engine, the human path around it, every way out) from one 118s script on CI
  // run 36838282615 that held a runner to itself and set the run's critical path. The three seconds
  // are the sections' estimated shares until a CI run measures them.
  { name: 'editor-v2', needsMail: false, serialGroup: 'clipboard', seconds: 60, timeoutMs: 200_000 },
  { name: 'editor-path', needsMail: true, seconds: 35, timeoutMs: 150_000 },
  { name: 'editor-exits', needsMail: false, seconds: 25, timeoutMs: 120_000 },
  { name: 'editable-table', needsMail: true, seconds: 30, timeoutMs: 120_000 },
  { name: 'roadmap-views', needsMail: false, seconds: 11, timeoutMs: 60_000 },
  { name: 'export-slice', needsMail: false, seconds: 11, timeoutMs: 60_000 },
  { name: 'fonts', needsMail: false, seconds: 39, timeoutMs: 150_000 },
  { name: 'folders', needsMail: true, seconds: 18, timeoutMs: 60_000 },
  { name: 'fork', needsMail: true, seconds: 9, timeoutMs: 60_000 },
  { name: 'full-kit', needsMail: false, seconds: 35, timeoutMs: 60_000 },
  { name: 'hydration', needsMail: true, seconds: 26, timeoutMs: 190_000 },
  { name: 'image-upload', needsMail: false, serialGroup: 'clipboard', seconds: 38, timeoutMs: 110_000 },
  // Measured 11s in CI, including 32 uploads and scrolling 1,000 lazy images.
  { name: 'row-images', needsMail: false, seconds: 13, timeoutMs: 60_000 },
  { name: 'inplace-edit', needsMail: false, seconds: 62, timeoutMs: 180_000 },
  { name: 'layout-shift', needsMail: false, seconds: 41, timeoutMs: 140_000 },
  { name: 'link-access', needsMail: true, seconds: 7, timeoutMs: 60_000 },
  { name: 'local-sql-state', needsMail: true, seconds: 8, timeoutMs: 60_000 },
  { name: 'live-data', needsMail: false, seconds: 11, timeoutMs: 60_000 },
  { name: 'live-reader', needsMail: false, seconds: 30, timeoutMs: 70_000 },
  // Publishes three documents, waits for the background harvest (four surface/mode loads, each drawn
  // twice when new), then loads 14 pages across ~35 kinds. Measured 42s alone against a dev server.
  { name: 'mermaid-prerender', needsMail: false, seconds: 61, timeoutMs: 130_000 },
  { name: 'mobile', needsMail: false, seconds: 23, timeoutMs: 100_000 },
  { name: 'oauth-browser', needsMail: true, seconds: 5, timeoutMs: 60_000 },
  { name: 'reading-chrome', needsMail: false, seconds: 22, timeoutMs: 90_000 },
  { name: 'reader-chrome', needsMail: true, serialGroup: 'clipboard', seconds: 24, timeoutMs: 110_000 },
  { name: 'web-assets', needsMail: true, seconds: 16, timeoutMs: 60_000 },
  { name: 'pdf', needsMail: false, seconds: 2, timeoutMs: 60_000 },
  { name: 'script-slice', needsMail: false, seconds: 18, timeoutMs: 70_000 },
  { name: 'secure-arch', needsMail: true, seconds: 16, timeoutMs: 60_000 },
  { name: 'shell-seo', needsMail: false, seconds: 2, timeoutMs: 60_000 },
  { name: 'social-preview', needsMail: false, seconds: 25, timeoutMs: 80_000 },
  { name: 'simpler-start', needsMail: false, serialGroup: 'clipboard', seconds: 2, timeoutMs: 60_000 },
  { name: 'visibility', needsMail: true, seconds: 8, timeoutMs: 60_000 },
  { name: 'viz-editor', needsMail: true, seconds: 58, timeoutMs: 130_000 },
]);

/**


 * Scripts named `gate-*.mjs` that RUN gates rather than being one: scripts/gate-container.mjs runs a
 * set in a Linux container. Discovery leaves them out, so they need no row and never run as a gate.
 */
export const GATE_RUNNERS = Object.freeze(['container']);

/** The gate names among a directory's file names: `gate-<name>.mjs`, less the runners. */
export function gateNamesOnDisk(fileNames) {
  return fileNames
    .filter((file) => file.startsWith('gate-') && file.endsWith('.mjs'))
    .map((file) => file.slice('gate-'.length, -'.mjs'.length))
    .filter((name) => !GATE_RUNNERS.includes(name))
    .sort();
}

/**
 * Disk ↔ manifest bijection. Throws ONE error naming every file without a row and every row without a file
 * (sorted, both lists), returns silently when they match. Pure: the runner calls it with `readdirSync`'s names.
 * @param {readonly string[]} diskNames  gate names on disk (without `gate-`/`.mjs`)
 * @param {readonly GateSpec[]} specs
 */
export function checkManifest(diskNames, specs) {
  const disk = new Set(diskNames);
  const manifest = new Set(specs.map((spec) => spec.name));
  const missing = [...disk].filter((name) => !manifest.has(name)).sort();
  const orphan = [...manifest].filter((name) => !disk.has(name)).sort();
  if (missing.length === 0 && orphan.length === 0) return;
  const facts = [];
  if (missing.length > 0) facts.push(`missing manifest rows: ${missing.join(', ')}`);
  if (orphan.length > 0) facts.push(`orphan manifest rows: ${orphan.join(', ')}`);
  throw new Error(`Gate manifest does not match disk (${facts.join('; ')})`);
}

/** The row for one gate, or throws naming it. @param {string} name */
export function specFor(name) {
  const spec = GATE_SPECS.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(`Gate manifest has no row for: ${name}`);
  return spec;
}

/** Browser installation plan for exactly the gates this runner will execute. */
export function browsersFor(names) {
  return [...new Set(names.flatMap(name => specFor(name).browsers ?? ['chromium']))].sort();
}


/**
 * The gate matrix's total shard count in `.github/workflows/ci.yml` (the `gates` job). Keep this in
 * step with the workflow's shard count — scripts/__tests__/ci-plan.test.mjs checks the matrix against it.
 * Ten bins of ~70s of wall each (two servers per runner) from ~1,250s of measured gate work, down from
 * twenty-four bins packed by timeout, which gave a 13s gate a runner of its own.
 */
export const CI_GATE_SHARDS = 10;

/** The extra a shard pays to apt-install Firefox/WebKit system packages: 91s on CI run 35740918148. */
export const CROSS_BROWSER_SETUP_SECONDS = 91;

/**
 * A gate's weight for packing CI shards: its MEASURED seconds (`seconds`, read from the CI logs'
 * `──── name (Ns) ────` lines), not its timeout. Timeouts are 3x a measurement with a 60s floor, so
 * packing by them gave cli-conformance (13s), hydration (26s) and screenshot-comments (25s) a whole
 * runner each. A gate that needs Firefox or WebKit also carries the shard's browser setup.
 */
export function shardWeight(name) {
  const spec = specFor(name);
  return spec.seconds + (browsersFor([name]).some(browser => browser !== 'chromium') ? CROSS_BROWSER_SETUP_SECONDS : 0);
}
