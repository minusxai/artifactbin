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
// `seconds` re-read from CI runs 37122263349, 37118962945 and 37117977312 (the 20-journey set on eight
// shards): the slowest successful `──── name (Ns) ────` line of the three for each gate, a failed first
// attempt excluded (data-journey and offline-file each passed a first attempt once). The comments on
// the rows below record where each gate's timeout was measured; the `seconds` are these CI numbers.
export const GATE_SPECS = Object.freeze([
  // Candidate actual-reader suite; paired original evidence is an explicit run mode.
  { name: 'component-baseline', needsMail: false, seconds: 30, timeoutMs: 300_000 },
  // Local container measurement: 28s; CI scheduling weight pending first run.
  { name: 'html-components', needsMail: false, seconds: 28, timeoutMs: 60_000 },
  // Real Mermaid/WebGL engines: 8s in the local container.
  { name: 'html-rich-components', needsMail: false, seconds: 8, timeoutMs: 180_000 },
  // Actual installed archive/private Save: 20s in the local container.
  { name: 'private-preview-save', needsMail: false, seconds: 20, timeoutMs: 120_000 },
  // Journey gates: each absorbs several former gates; `seconds` measured in
  // scripts/gate-container.mjs (four CPUs, two servers, the four run together).
  // The offline file from file:// and the screenshot comment, Chromium, Firefox and WebKit concurrently in one
  // process (formerly offline-file, -firefox, -webkit and screenshot-comments: three shards' cross-browser setup).
  { name: 'offline-file', browsers: ['chromium', 'firefox', 'webkit'], needsMail: false, seconds: 47, timeoutMs: 90_000 },
  // Guest start, OAuth consent and the login door, claim, fork, folders and CLI acceptance, one persona per leg
  // (formerly simpler-start, oauth-browser, app-flows AUTH, claim-flow, fork, folders and cli-conformance).
  { name: 'accounts-and-workspace', needsMail: true, serialGroup: 'clipboard', seconds: 31, timeoutMs: 70_000 },
  // Native HTML writes and shared data reaching open pages without a reload.
  { name: 'live', needsMail: false, seconds: 19, timeoutMs: 60_000 },
  // One walk over dataflow, local-sql-state, dataset-policies and data-ux (proposal row 10). Its PostgreSQL leg is
  // services/app/lib/datasets/__tests__/postgres-routes.test.ts now, so no gate starts Docker (was 21s with it).
  // Was 21s with it; 22s in one gate container of this change (four CPUs, two servers, eight gates at once).
  { name: 'data-journey', needsMail: false, seconds: 20, timeoutMs: 60_000 },
  // editable-table, roadmap-views and row-images over one account (proposal row 13). Measured 18s in a gate container;
  // 27s in the eight-gate container run that dropped its forged write and second permission flip (was 33s).
  { name: 'datasets-in-documents', needsMail: false, seconds: 30, timeoutMs: 60_000 },
  // full-kit, the compiled handover from hydration, libraries and fonts (proposal row 14). Needs esm.sh.
  // Measured 28s in a gate container.
  { name: 'kit-and-fonts', needsMail: false, seconds: 40, timeoutMs: 90_000 },
  // One journey: the former annotations and comment-targets gates (two lanes in one browser, the fold leg alone).
  { name: 'comments', needsMail: false, serialGroup: 'clipboard', seconds: 19, timeoutMs: 60_000 },
  // One scenario: the link role's delivery to a signed-in stranger and a logged-out visitor (the named-people walk
  // left for vitest and jsdom). 5s in the eight-gate container run, from 14s in the container measure above (was 21s).
  { name: 'collab-roles', needsMail: true, seconds: 8, timeoutMs: 60_000 },
  // One journey: the former export-slice and social-preview gates, plus the one PNG/JPEG/card/?chrome=0 set.
  { name: 'exports', needsMail: false, seconds: 41, timeoutMs: 110_000 },
  // Journey gates (scripts/gates/gate-<name>.mjs headers list what each absorbed). `seconds` measured in one
  // `node scripts/gate-container.mjs reader-shell own-origin-script reading-geometry media` run (4 CPUs, two
  // servers, CI's shape: 66s wall-clock); timeoutMs = max(60s, 3 × seconds), rounded up to ten seconds.
  // reader-shell and media were re-measured in one eight-gate container run of the gate diet (7s and 34s, from 22s
  // and 53s here); the seconds below keep a margin for that run's lighter load. Re-read both from CI.
  { name: 'native-core', needsMail: false, seconds: 10, timeoutMs: 60_000 },
  { name: 'presence', needsMail: true, seconds: 25, timeoutMs: 90_000 },
  { name: 'reader-shell', needsMail: true, seconds: 12, timeoutMs: 60_000 },
  // Drives a server that serves every document on its own origin: the runner's do (APP__PAGES_HOST), so it boots none.
  { name: 'own-origin-script', needsMail: false, seconds: 17, timeoutMs: 60_000 },
  { name: 'reading-geometry', needsMail: false, seconds: 74, timeoutMs: 190_000 },
  { name: 'media', needsMail: false, serialGroup: 'clipboard', seconds: 36, timeoutMs: 110_000 },
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
 * Nine bins retain the existing CI matrix; isolated browser journeys each hold their own bin.
 */
export const CI_GATE_SHARDS = 9;

/** Cross-browser downloads and role journeys keep dedicated bins while their
 * native HTML migrations establish new timings. Every retained gate still runs. */
export const CI_ISOLATED_GATE_GROUPS = Object.freeze([
  Object.freeze(['collab-roles']),
  Object.freeze(['offline-file']),
]);
export const CI_ISOLATED_GATES = Object.freeze(CI_ISOLATED_GATE_GROUPS.flat());

/**
 * How CI's gate shards are packed (scripts/gates.shard.mjs `shardOf`): the isolated pair alone, and the
 * members of a serial group apart, since inside one runner they run one at a time. scripts/gates.mjs and
 * the planning tests pass these same options, so a shard index means one set of gates everywhere.
 */
export const CI_SHARD_OPTIONS = Object.freeze({
  isolated: CI_ISOLATED_GATE_GROUPS,
  serialGroup: (name) => specFor(name).serialGroup,
});

/**
 * The extra a shard pays to install Firefox/WebKit with their system packages: the cross-browser shard's
 * "Install selected gate browsers" step (31s, 36s, 34s; Chromium-only shards 1-2s) plus its browser-debs
 * cache restore (2-3s), the slowest of CI runs 37122263349, 37118962945 and 37117977312: 36s + 2s.
 */
export const CROSS_BROWSER_SETUP_SECONDS = 38;

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
