/**
 * THE GATE MANIFEST — what each browser gate needs, beside the one runner (scripts/gates.mjs).
 *
 * Disk discovery stays (a `gate-*.mjs` cannot go missing); this file adds what discovery cannot see: how a gate
 * starts, whether it reads the mail sink, whether it drives the clipboard (one browser at a time), which gates must
 * never overlap, and how long each may run. The runner asserts a BIJECTION between the files on disk and the rows
 * here at startup and refuses to run otherwise — a new gate without a row, or a row without a file, is a failure,
 * not a silent skip.
 *
 * Timeouts keep a cold-start floor and use the slower outside-sandbox observation from implementation and review:
 * `timeoutMs = max(60_000, 3 * 1000 * max(implementer seconds, orchestrator max seconds))`. Both measurements stay
 * beside every row so the budget remains auditable rather than becoming an unexplained constant.
 *
 * @typedef {object} GateSpec
 * @property {string} name            `gate-<name>.mjs`
 * @property {'shared'|'custom'|'none'} start  `shared` = boots its document through lib/start-doc.mjs; `custom` = its own
 *                                    identity/setup path (say why); `none` = needs no document
 * @property {string} [why]           REQUIRED when start !== 'shared': the one sentence that justifies the exception
 * @property {boolean} needsMail      reads a login code from the mail sink
 * @property {boolean} needsClipboard drives the real clipboard — such gates share one serial group
 * @property {string} [serialGroup]   gates in the same group never run concurrently, even across servers
 * @property {number} timeoutMs       the runner kills the gate past this (integer > 0)
 */

/** @type {readonly GateSpec[]} */
export const GATE_SPECS = Object.freeze([
  // measured: implementer 9s; orchestrator 7s
  { name: 'annotations', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 66s; orchestrator 71s
  { name: 'app-flows', start: 'shared', needsMail: true, needsClipboard: false, timeoutMs: 213_000 },
  // measured: implementer 5s; orchestrator 6s
  { name: 'claim-flow', start: 'shared', needsMail: true, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 25s; orchestrator 25s
  {
    name: 'collab-edit', start: 'custom',
    why: 'Uses two logged-in browser contexts and one mail sink to prove editor collaboration and immediate demotion.',
    needsMail: true, needsClipboard: false, timeoutMs: 75_000,
  },
  // measured: implementer 55s; orchestrator 55s
  { name: 'concurrent-edit', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 165_000 },
  // measured: implementer 8s; orchestrator 10s
  { name: 'data-ingest', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 4s (1s warm); orchestrator pending
  { name: 'data-table-height', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 6s; orchestrator 7s
  { name: 'data-ux', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 4s; orchestrator 83s
  {
    name: 'dataflow', start: 'custom',
    why: 'Publishes its own dataset and dataflow documents, then logs in a private reader to exercise direct and relayed queries.',
    needsMail: true, needsClipboard: false, timeoutMs: 249_000,
  },
  // measured: implementer 9s; orchestrator 8s
  { name: 'deck-chrome', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 34s; orchestrator 33s
  { name: 'editor-exit', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 102_000 },
  // measured: implementer 35s; orchestrator 36s
  { name: 'editor-flow', start: 'shared', needsMail: true, needsClipboard: false, timeoutMs: 108_000 },
  // measured: orchestrator 30s, including two readers, owner relay and PNG export
  { name: 'editable-table', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 120_000 },
  // Table/DAG/Sprint navigation and sprint creation through the shared dialog.
  { name: 'roadmap-views', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 120_000 },
  // measured: implementer 2s; orchestrator 2s
  {
    name: 'email-login', start: 'custom',
    why: 'Runs the real email-code login and OAuth-session seam using its own Resend-compatible mail sink.',
    needsMail: true, needsClipboard: false, timeoutMs: 60_000,
  },
  // measured: implementer 8s; orchestrator 13s
  { name: 'export-slice', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 5s; orchestrator 5s
  { name: 'fonts', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 40s; orchestrator pending
  {
    name: 'folders', start: 'custom',
    why: 'Needs two logged-in contexts and a stranger over ONE public folder: the owner\u2019s shell, an invited editor, and the document served top-level.',
    needsMail: true, needsClipboard: false, timeoutMs: 120_000,
  },
  // measured: implementer 5s; orchestrator 5s
  {
    name: 'fork', start: 'custom',
    why: 'Drives two browser contexts and logs the second in ON the /login page the fork anchor produced — the callbackUrl round trip is the thing under test, so the shared start helper (which navigates to /login itself) would throw it away.',
    needsMail: true, needsClipboard: false, timeoutMs: 60_000,
  },
  // measured: implementer 17s; orchestrator 23s
  { name: 'full-kit', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 69_000 },
  // measured: implementer 7s; orchestrator 7s
  { name: 'hydration', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 11s; orchestrator 14s
  {
    name: 'image-upload', start: 'shared', needsMail: false, needsClipboard: true, serialGroup: 'clipboard',
    timeoutMs: 60_000,
  },
  // measured: implementer 36s; orchestrator 36s
  { name: 'inplace-edit', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 108_000 },
  // measured: implementer 39s; orchestrator 39s
  { name: 'layout-shift', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 117_000 },
  // measured: implementer 2s; orchestrator 2s
  {
    name: 'link-access', start: 'custom',
    why: 'Exercises the share menu general-access seam with its own owner, stranger, and logged-out identity setup.',
    needsMail: true, needsClipboard: false, timeoutMs: 60_000,
  },
  // measured: implementer 3s; orchestrator 7s
  { name: 'live-data', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 20s; orchestrator 20s
  { name: 'live-reader', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 27s (F4 adds a fourth, touch-enabled context); orchestrator 9s (pre-F4)
  { name: 'mobile', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 81_000 },
  // measured: implementer 1s; orchestrator 1s
  {
    name: 'oauth-browser', start: 'custom',
    why: 'Clicks the OAuth consent form in a real browser and receives the authorization code at a real callback listener.',
    needsMail: true, needsClipboard: false, timeoutMs: 60_000,
  },
  // measured: implementer 15s; orchestrator 17s
  { name: 'reading-chrome', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 16s; orchestrator pending
  {
    name: 'reader-chrome', start: 'custom',
    why: 'The byline is the AUTHOR\'s handle, so the document has to be owned: it logs an owner in, claims a token to publish under it, and forks a copy for the provenance line — none of which the anonymous shared start helper produces.',
    needsMail: true, needsClipboard: true, serialGroup: 'clipboard', timeoutMs: 60_000,
  },
  // measured: implementer 11s; orchestrator 10s
  {
    name: 'real-paste', start: 'shared', needsMail: false, needsClipboard: true, serialGroup: 'clipboard',
    timeoutMs: 60_000,
  },
  // measured: implementer 1s; orchestrator 2s
  { name: 'ref-image', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 10s
  { name: 'bound-assets', start: 'shared', needsMail: true, needsClipboard: false, timeoutMs: 60_000 },
  { name: 'web-assets', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 90_000 },
  // measured: implementer 20s; orchestrator pending
  {
    name: 'pdf', start: 'shared',
    needsMail: false, needsClipboard: false, timeoutMs: 60_000,
  },
  // measured: implementer 16s; orchestrator 17s
  { name: 'script-slice', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 25s; orchestrator 26s
  {
    name: 'secure-arch', start: 'custom',
    why: 'Creates logged-in owner and stranger sessions plus a session-less reader to exercise the browser security seams.',
    needsMail: true, needsClipboard: false, timeoutMs: 78_000,
  },
  // measured: implementer 4s; orchestrator 4s
  { name: 'shell-seo', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 14s
  { name: 'social-preview', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 3s; orchestrator 3s
  {
    name: 'simpler-start', start: 'custom',
    why: 'Creates the one-line human-to-agent handoff from the home page and validates the independent start-link protocol.',
    needsMail: false, needsClipboard: true, serialGroup: 'clipboard', timeoutMs: 60_000,
  },
  // measured: implementer 4s; orchestrator 4s
  { name: 'viewport-units', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
  // measured: implementer 4s; orchestrator 4s
  {
    name: 'visibility', start: 'custom',
    why: 'Logs in an owner through the mail sink to prove private iframe delivery, canonical URL healing, and sharing UI changes.',
    needsMail: true, needsClipboard: false, timeoutMs: 60_000,
  },
  // measured: implementer 41s; orchestrator 43s
  { name: 'viz-editor', start: 'shared', needsMail: true, needsClipboard: false, timeoutMs: 129_000 },
  // measured: implementer 6s; orchestrator 8s
  { name: 'web-import', start: 'shared', needsMail: false, needsClipboard: false, timeoutMs: 60_000 },
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
