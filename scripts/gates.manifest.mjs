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
 * one gate at a time on one server (`node scripts/gates.mjs --servers=1 --only=<name>`) — and they are the
 * weight `gates.shard.mjs` balances CI's shards on, so re-measuring a gate re-balances them.
 *
 * @typedef {object} GateSpec
 * @property {string} name            `gate-<name>.mjs`
 * @property {boolean} needsMail      reads a login code from the mail sink
 * @property {string} [serialGroup]   gates in the same group never run concurrently, even across servers
 * @property {string[]} [browsers]    engines required by the default gate invocation; defaults to Chromium
 * @property {number} timeoutMs       the runner kills the gate past this (integer > 0)
 */

/** @type {readonly GateSpec[]} */
export const GATE_SPECS = Object.freeze([
  { name: 'screenshot-comments', browsers: ['chromium', 'firefox', 'webkit'], needsMail: false, timeoutMs: 150_000 },
  // Needs no server: opens rendered offline files from file:// in all three engines (reading, editing,
  // comments, Save, code view offline and online, agent-edited files). Measured 42–44s in the
  // playwright:v1.62.1-noble image on a laptop and 39s on macOS; CI runners are slower (an earlier,
  // smaller version overran 60s there), so the budget is ~5x the measured run.
  { name: 'offline-file', browsers: ['chromium', 'firefox', 'webkit'], needsMail: false, timeoutMs: 240_000 },
  { name: 'cli-conformance', needsMail: true, timeoutMs: 180_000 },
  // Publishes the six page-speed fixtures and the kitchen sink through a bearer token, then loads each
  // on today's renderer and on the compiled reader (`?reader=compiled`) and compares the story element by
  // element (docs/phase2-architecture.md §12). Against a server without the compiled path it records the
  // skip and exits in seconds; the budget is for the comparison run (~14 loads plus settling).
  { name: 'compiled-parity', needsMail: false, timeoutMs: 150_000 },
  { name: 'browser-sessions', needsMail: false, timeoutMs: 150_000 },
  { name: 'testusers', needsMail: true, timeoutMs: 60_000 },
  { name: 'comment-targets', needsMail: false, timeoutMs: 60_000 },
  { name: 'dataset-policies', needsMail: true, timeoutMs: 60_000 },
  { name: 'app-home', needsMail: false, serialGroup: 'clipboard', timeoutMs: 120_000 },
  { name: 'seamless-navigation', needsMail: true, timeoutMs: 60_000 },
  { name: 'managed-iframe', needsMail: false, timeoutMs: 60_000 },
  { name: 'libraries', needsMail: false, timeoutMs: 60_000 },
  { name: 'postgres-datasets', needsMail: true, timeoutMs: 60_000 },
  { name: 'annotations', needsMail: false, timeoutMs: 60_000 },
  { name: 'app-flows', needsMail: true, timeoutMs: 210_000 },
  { name: 'claim-flow', needsMail: true, timeoutMs: 60_000 },
  { name: 'collab-edit', needsMail: true, timeoutMs: 100_000 },
  { name: 'data-ux', needsMail: false, timeoutMs: 60_000 },
  { name: 'dataflow', needsMail: true, timeoutMs: 60_000 },
  { name: 'editor-v2', needsMail: true, serialGroup: 'clipboard', timeoutMs: 310_000 },
  { name: 'editable-table', needsMail: true, timeoutMs: 120_000 },
  { name: 'roadmap-views', needsMail: false, timeoutMs: 60_000 },
  { name: 'export-slice', needsMail: false, timeoutMs: 60_000 },
  { name: 'fonts', needsMail: false, timeoutMs: 150_000 },
  { name: 'folders', needsMail: true, timeoutMs: 60_000 },
  { name: 'fork', needsMail: true, timeoutMs: 60_000 },
  { name: 'full-kit', needsMail: false, timeoutMs: 60_000 },
  { name: 'hydration', needsMail: true, timeoutMs: 190_000 },
  { name: 'image-upload', needsMail: false, serialGroup: 'clipboard', timeoutMs: 110_000 },
  // Measured 11s in CI, including 32 uploads and scrolling 1,000 lazy images.
  { name: 'row-images', needsMail: false, timeoutMs: 60_000 },
  { name: 'inplace-edit', needsMail: false, timeoutMs: 180_000 },
  { name: 'layout-shift', needsMail: false, timeoutMs: 140_000 },
  { name: 'link-access', needsMail: true, timeoutMs: 60_000 },
  { name: 'local-sql-state', needsMail: true, timeoutMs: 60_000 },
  { name: 'live-data', needsMail: false, timeoutMs: 60_000 },
  { name: 'live-reader', needsMail: false, timeoutMs: 70_000 },
  // Publishes three documents, waits for the background harvest (four surface/mode loads, each drawn
  // twice when new), then loads 14 pages across ~35 kinds. Measured 42s alone against a dev server.
  { name: 'mermaid-prerender', needsMail: false, timeoutMs: 130_000 },
  { name: 'mobile', needsMail: false, timeoutMs: 100_000 },
  { name: 'oauth-browser', needsMail: true, timeoutMs: 60_000 },
  { name: 'reading-chrome', needsMail: false, timeoutMs: 90_000 },
  { name: 'reader-chrome', needsMail: true, serialGroup: 'clipboard', timeoutMs: 110_000 },
  { name: 'web-assets', needsMail: true, timeoutMs: 60_000 },
  { name: 'pdf', needsMail: false, timeoutMs: 60_000 },
  { name: 'script-slice', needsMail: false, timeoutMs: 70_000 },
  { name: 'secure-arch', needsMail: true, timeoutMs: 60_000 },
  { name: 'shell-seo', needsMail: false, timeoutMs: 60_000 },
  { name: 'social-preview', needsMail: false, timeoutMs: 80_000 },
  { name: 'simpler-start', needsMail: false, serialGroup: 'clipboard', timeoutMs: 60_000 },
  { name: 'visibility', needsMail: true, timeoutMs: 60_000 },
  { name: 'viz-editor', needsMail: true, timeoutMs: 130_000 },
]);

/**
 * THE COMPILED LEGS (docs/phase2-architecture.md §10, w3-behaviour). The behavioural gates run a second
 * time against the compiled reader: the leg `<gate>@compiled` is the same file, run with
 * `GATE_READER=compiled` against servers booted with `FLAG__COMPILED_READER=on` (every reader page is the
 * compiled one wherever a compile exists), so wave 4 deletes the legacy reader behind gates that already
 * pass without it. A leg is sharded and timed like any gate (its own `timeoutMs`, measured the same way).
 *
 * A `disabled` leg is wired — `--only=<gate>@compiled` runs it — but not in the default set, with the
 * reason it cannot pass yet. Every leg names a gate on disk (`checkLegs`).
 *
 * @typedef {object} CompiledLeg
 * @property {string} gate          the gate it runs again (`gate-<gate>.mjs`)
 * @property {number} timeoutMs     the runner kills the leg past this
 * @property {string} [disabled]    why the leg is not in the default set yet
 */
export const COMPILED = '@compiled';

/** @type {readonly CompiledLeg[]} */
export const COMPILED_LEGS = Object.freeze([
  { gate: 'live-data', timeoutMs: 60_000 },
  { gate: 'full-kit', timeoutMs: 90_000 },
  { gate: 'export-slice', timeoutMs: 60_000 },
  { gate: 'layout-shift', timeoutMs: 140_000 },
  { gate: 'live-reader', timeoutMs: 70_000 },
  { gate: 'hydration', timeoutMs: 190_000, disabled: 'its takeover legs 1–3 assert React hydrating the legacy inline story; the compiled takeover (leg 4) already runs in the plain gate on ?reader=compiled' },
  { gate: 'reader-chrome', timeoutMs: 110_000 },
  { gate: 'reading-chrome', timeoutMs: 110_000 },
  { gate: 'dataflow', timeoutMs: 60_000, disabled: 'the compiled page runs no in-browser SQLite engine yet (IslandPageData carries no `hold`/`sqliteWasm`): six checks assert the page engine' },
]);

/** `<gate>@compiled` → `<gate>`; a gate name is itself. */
export const gateOf = (name) => (name.endsWith(COMPILED) ? name.slice(0, -COMPILED.length) : name);
export const isCompiledLeg = (name) => name.endsWith(COMPILED);
/** The legs a default run includes, by name. */
export const compiledLegNames = ({ all = false } = {}) => COMPILED_LEGS.filter((leg) => all || !leg.disabled).map((leg) => `${leg.gate}${COMPILED}`);

/** Every leg names a gate on disk, once. Throws naming the strays. @param {readonly string[]} diskNames */
export function checkLegs(diskNames, legs = COMPILED_LEGS) {
  const stray = legs.filter((leg) => !diskNames.includes(leg.gate)).map((leg) => leg.gate);
  const twice = legs.map((leg) => leg.gate).filter((gate, i, all) => all.indexOf(gate) !== i);
  if (stray.length || twice.length) throw new Error(`Compiled legs do not match disk (${[stray.length ? `no gate for: ${stray.join(', ')}` : '', twice.length ? `named twice: ${twice.join(', ')}` : ''].filter(Boolean).join('; ')})`);
}

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

/** The row for one gate (a compiled leg: its gate's row, with the leg's name and timeout), or throws naming it. @param {string} name */
export function specFor(name) {
  const spec = GATE_SPECS.find((candidate) => candidate.name === gateOf(name));
  if (!spec) throw new Error(`Gate manifest has no row for: ${name}`);
  if (!isCompiledLeg(name)) return spec;
  const leg = COMPILED_LEGS.find((candidate) => candidate.gate === spec.name);
  if (!leg) throw new Error(`Gate manifest has no compiled leg for: ${name}`);
  return { ...spec, name, timeoutMs: leg.timeoutMs };
}

/** Browser installation plan for exactly the gates this runner will execute. */
export function browsersFor(names) {
  return [...new Set(names.flatMap(name => specFor(name).browsers ?? ['chromium']))].sort();
}

/**
 * Cross-browser system setup measured 91s on CI run 35740918148. Match the
 * timeout-based balancer's 3x scale (90s × 3) without changing gate deadlines.
 * Charging each cross-browser gate is conservative if several share a shard.
 */
export function shardWeight(name) {
  const spec = specFor(name);
  return spec.timeoutMs + (browsersFor([name]).some(browser => browser !== 'chromium') ? 270_000 : 0);
}
