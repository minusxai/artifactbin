/**
 * PR FAST'S NODE BATCH: the full suite's cheap `node` project files, run on every pull request in one shared module
 * graph per worker (vitest.node-batch.config.ts). Run one fresh graph per file, as the `node` project does, each of
 * these would pay its imports for a few milliseconds of tests; shared, a few hundred of them run in seconds. They stay
 * in the `node` project too, so the post-merge full suite (ci.yml's node job) still runs every one of them.
 *
 * Chosen from the recorded CI times (scripts/ci/test-timings.json), not by hand: a `node` file whose recorded time is
 * under `NODE_BATCH_MAX_MS`, that no other pr fast list already runs (the fast module list, the guard and contract
 * tests), that leaves nothing behind in a shared graph (scripts/lib/test-isolation.mjs), and that is not named in
 * `NODE_BATCH_EXCLUDED` below; and, whatever their time, the post-merge failures in `NODE_BATCH_GUARDED`. A file with no
 * recorded time never joins blindly (an unmeasured file can be slow): it joins once a full-suite run has measured it.
 *
 * MAIN MEASURES THEM, NOT A HAND REFRESH. The committed table changes only when someone refreshes it
 * (`node scripts/ci/test-timings.mjs --run <id>`), and main refuses a commit that did not come through a pull request,
 * so no workflow can commit one. Instead `.github/workflows/node-timings.yml`, after each green `ci` push run on main,
 * takes the `node` file times of the last green runs (`--measured`), checks the batch they choose passes in shared
 * graphs, and uploads them as the `NODE_TIMINGS_ARTIFACT` artifact. Every pr fast node runner lays the newest one
 * uploaded before its run began over the committed table (`scripts/ci/ci.mjs node-timings`, `withMeasuredTimes`), so
 * the three runners of one run choose and pack the same batch, and a re-run chooses what the first attempt did.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEAKS_PAST_ITS_FILE } from './test-isolation.mjs';

/** Recorded CI time (ms) under which a `node` file is cheap enough for the batch. */
export const NODE_BATCH_MAX_MS = 200;

/**
 * Cheap files that cannot share a graph although they mock nothing, each with the reason. They still run in the full
 * suite's isolated `node` project.
 */
export const NODE_BATCH_EXCLUDED = Object.freeze({
  // These render through Vega, whose vega-lite build installs `Set.prototype.toJSON` (a "Set(…)" string) for the
  // whole process. In one graph every later file serializes a Set that way: services/utils/__tests__/http.test.ts,
  // which sends one through the JSON transport, failed behind viz-templates.test.ts. The batch's setup refuses a file
  // that changes a builtin prototype (services/app/test/setup/shared-graph.setup.ts), which found these five.
  'services/app/lib/viz/__tests__/envelopes-and-assets.test.ts': 'vega-lite installs Set.prototype.toJSON',
  'services/app/lib/viz/__tests__/plan-vega.test.ts': 'vega-lite installs Set.prototype.toJSON',
  'services/app/lib/viz/__tests__/single-series-legend.test.ts': 'vega-lite installs Set.prototype.toJSON',
  'services/app/lib/viz/__tests__/viz-legend-wrap.test.ts': 'vega-lite installs Set.prototype.toJSON',
  'services/app/lib/viz/__tests__/viz-templates.test.ts': 'vega-lite installs Set.prototype.toJSON',
  // It counts a fresh document's <style> elements; in one graph the component file before it (input.test.ts on
  // #1359's pr fast) has already injected its own into the shared document.
  'services/app/lib/html-components/__tests__/host-styles.test.ts': 'needs a document no other component file wrote',
});

/**
 * `node` files that turned main red after a green pull request (AGENTS.md: every post-merge failure gets a fast-lane
 * guard), in the batch whatever their recorded time. Each must still leave nothing behind in a shared graph.
 */
export const NODE_BATCH_GUARDED = Object.freeze([
  // Creation's parent refusal: failed on main after the preflight refused a non-folder parent as the uniform
  // `Invalid parent`, and no pr fast list ran the write path's own file (4.8s recorded, past the batch's cut).
  'services/app/lib/artifacts/__tests__/writes.test.ts',
  // Comment creation's store: failed on main after merge when a comment on an earlier version stopped being refused,
  // and pr fast deferred it past the reached-files budget (2.8s recorded; lib/annotations/store.ts reaches widely).
  'services/app/lib/annotations/__tests__/store.test.ts',
  // The SQL worker pool behind its HTTP shell: a malformed body crashed the service process on main after merge; its
  // process test (services/app/lib/sql/__tests__/service.test.ts) stubs the environment and cannot share a graph.
  'services/sql/__tests__/malformed-requests.test.ts',
  // Viewer-first setup and keyed cancellation are required by governed PostgreSQL endpoints.
  'services/connectors/__tests__/connectors.test.ts',
  'services/connectors/__tests__/postgres-cancel-wire.test.ts',
  'services/connectors/__tests__/postgres-operation.test.ts',
  // The hosted runtime's build: failed on main after merge, and no pr fast list ran it (its watch-mode twin,
  // built-watch.test.ts, is a guard test).
  'services/app/lib/html-runtime/__tests__/build.test.ts',
  // The live dataset channel's events and counts: failed on main after merge.
  'services/app/lib/publish/__tests__/live-data-events.test.ts',
  // The skill's page check, read through its own scripts: failed on main after the skill dropped GraphQL, and the
  // skill's own tests (a guard list) do not cover what the check reports for a page's calls.
  'services/app/lib/html-publication-bundle/__tests__/author-check.test.ts',
  'services/app/lib/html-publication-bundle/__tests__/check-steps.test.ts',
  // The hosted libraries' served URLs: failed on main after the public files moved to `/af/lib/`, in a file too slow
  // for the batch (it bundles Vega); the URL assertion now lives apart.
  'services/app/lib/libraries/__tests__/library-urls.test.ts',
]);

/** The pr fast lists whose files already run on every pull request. */
export const LANE_LISTS = Object.freeze(['fast-tests.json', 'guard-tests.json', 'contract-tests.json']);

/** Every file the pr fast lists already run. @param {string} root the repository root */
export function laneFiles(root) {
  return new Set(LANE_LISTS.flatMap((list) => JSON.parse(readFileSync(path.join(root, 'scripts/ci', list), 'utf8'))));
}

/**
 * The batch: `candidates` (`node` project files, repository-relative) that qualify, sorted.
 * @param {{ timings: { files: Record<string, Record<string, number>> }, candidates: Iterable<string>, lane: Set<string>, read: (file: string) => string }} input
 * @returns {string[]}
 */
export function nodeBatchFiles({ timings, candidates, lane, read }) {
  const recorded = (file) => timings.files.node?.[file] ?? timings.files['node-batch']?.[file];
  const cheap = (file) => { const ms = recorded(file); return ms !== undefined && ms < NODE_BATCH_MAX_MS; };
  return [...candidates].filter((file) => (cheap(file) || NODE_BATCH_GUARDED.includes(file)) && !lane.has(file)
    && !Object.hasOwn(NODE_BATCH_EXCLUDED, file) && !LEAKS_PAST_ITS_FILE.test(read(file))).sort();
}

/**
 * THE PULL REQUEST'S OWN NODE FILES, beyond the batch (scripts/ci/node-affected.mjs chooses them on every pr fast node
 * runner; vitest.node-batch.config.ts runs them in `node-batch-isolated`, one fresh graph per file, as the `node`
 * project does). The batch alone left a new file with no recorded time, and every slower file a change reached, to the
 * post-merge suite. Now, ONE BUDGET (`budgetMs`) for both, so the node runners' time is bounded however many files a
 * change edits: each file weighs its recorded time (a file without one weighs the `node` median) and its import
 * (`NODE_ISOLATED_FILE_MS`):
 *  - `must`: the `node` files the change adds or edits that no pr fast part already runs, spent first, shortest first
 *    (a new file, unrecorded, at the median). Until 2026-11-20 every one ran whatever the budget: a change editing 172
 *    test files took pr fast to 72s (#1433's first attempt), and that change went in as six pull requests;
 *  - `affected`: then the slower files whose import graph reaches a changed file (scripts/lib/test-graph.mjs, the same
 *    selection `npm test` makes), the change's closest tests first, then shortest, while they fit what `must` left.
 *    Closest is not fewest imports from any changed file: a file most tests import (the contracts
 *    index) is one import from dozens of them, and those outbid the few tests of a module whose code changed, two
 *    imports from it (#1345 deferred lib/annotations' own store test so, and main went red). A file ranks by the
 *    fewest reached files within its distance of some changed file it reaches (`nearest`): the files nearer a narrow
 *    change than it is, and itself. One changed file still orders nearest first. A rerun trigger
 *    (vitest.config.ts, a package.json) reaches every file at distance Infinity, none nearer: it adds none of them,
 *    since a budget's worth of the shortest is an arbitrary subset on a cold module cache (#1339's runners: 27-36s);
 *  - `deferred`: the edited and reached files over the budget (`deferredOwn`: the edited ones among them), named on the
 *    run. The full suite still runs every one after merge.
 * @param {{ timings: { files: Record<string, Record<string, number>> }, changed: Iterable<string>, affected: Iterable<{ file: string, distance: number, nearest: Record<string, number> }>, candidates: Set<string>, batch: Set<string>, lane: Set<string>, budgetMs: number }} input
 * @returns {{ must: string[], affected: string[], deferred: string[], deferredOwn: string[] }}
 */
export function nodeAffectedFiles({ timings, changed, affected, candidates, batch, lane, budgetMs }) {
  const runsElsewhere = (file) => !candidates.has(file) || batch.has(file) || lane.has(file);
  const node = timings.files.node ?? {};
  const values = Object.values(node).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : NODE_BATCH_MAX_MS;
  const weight = (file) => (node[file] ?? median) + NODE_ISOLATED_FILE_MS;
  const own = [...new Set(changed)].filter((file) => !runsElsewhere(file));
  const must = [], deferredOwn = [];
  let spent = 0;
  for (const file of own.sort((a, b) => weight(a) - weight(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    if (spent + weight(file) <= budgetMs) { must.push(file); spent += weight(file); } else deferredOwn.push(file);
  }
  must.sort();
  const competing = [...affected].filter(({ file }) => !runsElsewhere(file) && !own.includes(file));
  // Each changed file's distances to the files competing for the budget, to count how many lie within a distance.
  const around = new Map();
  for (const { nearest } of competing) for (const [changed, steps] of Object.entries(nearest)) around.set(changed, [...(around.get(changed) ?? []), steps]);
  const within = (changed, steps) => around.get(changed).filter((other) => other <= steps).length;
  const rank = ({ distance, nearest }) => distance === Infinity ? Infinity : Math.min(...Object.entries(nearest).map(([changed, steps]) => within(changed, steps)));
  const reached = competing.map((entry) => ({ ...entry, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.distance - b.distance || weight(a.file) - weight(b.file) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const chosen = [], deferred = [...deferredOwn];
  for (const { file, distance } of reached) {
    if (chosen.includes(file) || deferred.includes(file)) continue;
    if (distance !== Infinity && spent + weight(file) <= budgetMs) { chosen.push(file); spent += weight(file); } else deferred.push(file);
  }
  return { must, affected: chosen, deferred: deferred.sort(), deferredOwn: deferredOwn.sort() };
}

/**
 * What a file of `node-batch-isolated` costs beyond its recorded time: the table holds a file's tests alone, and each of
 * these imports a fresh module graph first. Weighed by recorded time alone, a full budget of reached files (60, ~90s
 * recorded) took the node runners' Vitest step to 19-33s against ~18s predicted (pr fast run 44310861237). At 2s, an
 * api-isolated file's import, 19 edited files added 66s to the five runners' Vitest steps against 38s weighed, 3.5s
 * each beyond their 1.2s of tests (run 44775452083 against 44775468359, 2026-11-20): 4s.
 */
export const NODE_ISOLATED_FILE_MS = 4000;

/**
 * Time (ms) the change's own and reached files may add to pr fast's seven node runners, summed over all of them, each
 * weighed with its import. With the batch alone the slowest of five runners' Vitest step took 11-15s (21s once); with
 * 90s of reached files it took 21-29s and a node runner was a run's last job (pr fast runs 44767515214-44773563049,
 * 2026-11-20). 45s, about eleven files at 4s of import each, over seven runners keeps the slowest near 15s, its job
 * near 30s. What does not fit runs after merge.
 */
export const NODE_AFFECTED_BUDGET_MS = 45_000;

/** Where a node runner writes its choice (repository-relative), for vitest.node-batch.config.ts to read. */
export const NODE_AFFECTED_FILE = 'tmp/node-affected.json';

/** The files a runner chose (`must` then `affected`); none when it wrote no choice, as in a local run. @param {string} root */
export function readNodeAffected(root) {
  const file = path.join(root, NODE_AFFECTED_FILE);
  if (!existsSync(file)) return [];
  const { must, affected } = JSON.parse(readFileSync(file, 'utf8'));
  if (![must, affected].every((list) => Array.isArray(list) && list.every((entry) => typeof entry === 'string'))) throw new Error(`${NODE_AFFECTED_FILE} is not a file list`);
  return [...must, ...affected];
}

/** The full suite's projects the timings table records (scripts/ci/test-timings.mjs `RECORDED` adds its lenses). */
export const FULL_SUITE_PROJECTS = Object.freeze(['api', 'api-isolated', 'node', 'ui', 'islands', 'integration', 'integration-databases']);

/** The artifact `.github/workflows/node-timings.yml` uploads: main's measured `node` file times (`{ runs, files: { node } }`). */
export const NODE_TIMINGS_ARTIFACT = 'node-batch-timings';

/**
 * The committed table with main's measured `node` times laid over it, ADD-ONLY for the batch: a measured time replaces
 * the recorded one, except that a file the recorded table already makes cheap stays cheap (its recorded time is kept)
 * when a measurement puts it over the cut. Measurements add files to the batch, never take one out of the lane: a slow
 * draw of the runners (one file 10 ms recorded, 818 ms measured) must not drop coverage, and moving a file out is a
 * reviewed edit of the committed table. A measured file leaves any other full-suite project it was recorded under.
 * @param {{ files: Record<string, Record<string, number>> }} timings the committed table
 * @param {{ files?: { node?: Record<string, number> } }} measured
 */
export function withMeasuredTimes(timings, measured) {
  const files = Object.fromEntries(Object.entries(timings.files).map(([project, times]) => [project, { ...times }]));
  const node = (files.node ??= {});
  for (const [file, ms] of Object.entries(measured.files?.node ?? {})) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`measured time of ${file} is not a duration: ${ms}`);
    const recorded = node[file] ?? files['node-batch']?.[file];
    if (recorded !== undefined && recorded < NODE_BATCH_MAX_MS && ms >= NODE_BATCH_MAX_MS) continue;
    node[file] = ms;
    // Measured in main's `node` project, it runs there: a record under another full-suite project is stale.
    for (const project of FULL_SUITE_PROJECTS) if (project !== 'node') delete files[project]?.[file];
  }
  return { ...timings, files };
}

/**
 * Which uploaded `NODE_TIMINGS_ARTIFACT` a pr fast run reads: the newest live one main's own workflow uploaded no later
 * than `before` (the run's creation, the same for its every runner and attempt), so a measurement landing mid-run never
 * splits one run's runners over two tables. `null` when none qualifies: the committed table chooses alone.
 * @param {Array<{ id: number, name: string, expired: boolean, created_at: string, workflow_run?: { head_branch?: string, repository_id?: number, head_repository_id?: number } }>} artifacts
 * @param {string} before an ISO time
 */
export function measuredArtifact(artifacts, before) {
  const limit = Date.parse(before);
  if (Number.isNaN(limit)) throw new Error(`not a time: ${before}`);
  return artifacts
    .filter((artifact) => artifact.name === NODE_TIMINGS_ARTIFACT && artifact.expired === false
      && artifact.workflow_run?.head_branch === 'main' && artifact.workflow_run.head_repository_id === artifact.workflow_run.repository_id
      && Date.parse(artifact.created_at) <= limit)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0] ?? null;
}
