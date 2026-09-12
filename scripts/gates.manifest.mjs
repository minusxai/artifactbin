/**
 * THE GATE MANIFEST — what each browser gate needs, beside the one runner (scripts/gates.mjs).
 *
 * Disk discovery stays (a `gate-*.mjs` cannot go missing); this file adds what discovery cannot see:
 * whether a gate reads the mail sink, whether it needs the generation fixture server, which gates must
 * never overlap, and how long each may run. The runner asserts a BIJECTION between the files on disk and
 * the rows here at startup and refuses to run otherwise — a new gate without a row, or a row without a
 * file, is a failure, not a silent skip.
 *
 * EVERY FIELD IS READ BY THE RUNNER. The shape used to carry `start`, `why` and `needsClipboard` as well,
 * and nothing ever read any of them: `start` drifted until nine `shared` rows never called the shared
 * helper at all, and `needsClipboard` was one-to-one with `serialGroup: 'clipboard'` on all 55 rows. A
 * field no code consults is a second source of truth that cannot be wrong loudly.
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
 * @property {boolean} [needsGenerationFixture]  needs the deterministic model server (lib/generation-fixture)
 * @property {number} timeoutMs       the runner kills the gate past this (integer > 0)
 */

/** @type {readonly GateSpec[]} */
export const GATE_SPECS = Object.freeze([
  { name: 'comment-targets', needsMail: false, timeoutMs: 60_000 },
  { name: 'dataset-policies', needsMail: true, timeoutMs: 60_000 },
  { name: 'generation-mutations', needsMail: false, needsGenerationFixture: true, timeoutMs: 70_000 },
  { name: 'public-home-stars', needsMail: false, serialGroup: 'clipboard', timeoutMs: 60_000 },
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
  { name: 'editable-table', needsMail: true, timeoutMs: 60_000 },
  { name: 'roadmap-views', needsMail: false, timeoutMs: 60_000 },
  { name: 'export-slice', needsMail: false, timeoutMs: 60_000 },
  { name: 'fonts', needsMail: false, timeoutMs: 60_000 },
  { name: 'folders', needsMail: true, timeoutMs: 60_000 },
  { name: 'fork', needsMail: true, timeoutMs: 60_000 },
  { name: 'full-kit', needsMail: false, timeoutMs: 60_000 },
  { name: 'hydration', needsMail: false, timeoutMs: 60_000 },
  { name: 'image-upload', needsMail: false, serialGroup: 'clipboard', timeoutMs: 110_000 },
  { name: 'inplace-edit', needsMail: false, timeoutMs: 180_000 },
  { name: 'layout-shift', needsMail: false, timeoutMs: 80_000 },
  { name: 'link-access', needsMail: true, timeoutMs: 60_000 },
  { name: 'local-sql-state', needsMail: true, timeoutMs: 60_000 },
  { name: 'live-data', needsMail: false, timeoutMs: 60_000 },
  { name: 'live-reader', needsMail: false, timeoutMs: 70_000 },
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
