/**
 * PR FAST'S NODE BATCH: the full suite's cheap `node` project files, run on every pull request in one shared module
 * graph per worker (vitest.node-batch.config.ts). Run one fresh graph per file, as the `node` project does, each of
 * these would pay its imports for a few milliseconds of tests; shared, a few hundred of them run in seconds. They stay
 * in the `node` project too, so the post-merge full suite (ci.yml's node job) still runs every one of them.
 *
 * Chosen from the recorded CI times (scripts/ci/test-timings.json), not by hand: a `node` file whose recorded time is
 * under `NODE_BATCH_MAX_MS`, that no other pr fast list already runs (the fast module list, the guard and contract
 * tests), that leaves nothing behind in a shared graph (scripts/lib/test-isolation.mjs), and that is not named in
 * `NODE_BATCH_EXCLUDED` below; and, whatever their time, the post-merge failures in `NODE_BATCH_GUARDED`. A file with no recorded time joins once a full-suite run has measured it
 * (`node scripts/ci/test-timings.mjs --run <id>`).
 */
import { readFileSync } from 'node:fs';
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
});

/**
 * `node` files that turned main red after a green pull request (AGENTS.md: every post-merge failure gets a fast-lane
 * guard), in the batch whatever their recorded time. Each must still leave nothing behind in a shared graph.
 */
export const NODE_BATCH_GUARDED = Object.freeze([
  // The hosted runtime's build: failed on main after merge, and no pr fast list ran it (its watch-mode twin,
  // built-watch.test.ts, is a guard test).
  'services/app/lib/html-runtime/__tests__/build.test.ts',
  // The live dataset channel's events and counts: failed on main after merge.
  'services/app/lib/publish/__tests__/live-data-events.test.ts',
  // The skill's page check, read through its own scripts: failed on main after the skill dropped GraphQL, and the
  // skill's own tests (a guard list) do not cover what the check reports for a page's calls.
  'services/app/lib/html-publication-bundle/__tests__/author-check.test.ts',
  'services/app/lib/html-publication-bundle/__tests__/check-steps.test.ts',
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
