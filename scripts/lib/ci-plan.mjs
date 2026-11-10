import { createHash } from 'node:crypto';

/** CI boundary: the jobs ci.yml runs after a merge. Every push to main runs all of them, unless a green run
 * already tested this exact tree (scripts/ci/ci.mjs `plan`), which selects none.
 */
/**
 * Every conditional job in ci.yml, each one runner set the `test` roll-up requires when selected. `integration`
 * (the Docker/Chromium Vitest project) is a job of its own, not steps appended to a node shard: run serially
 * there, it made that one shard the longest job of the run.
 */
export const CI_JOBS = ['checks', 'node', 'integration', 'ui', 'build', 'api', 'gates'];

/** Every job, or none when `testedRun` names the green run that already tested this tree. */
export function planCi({ testedRun = null } = {}) {
  const jobs = Object.fromEntries(CI_JOBS.map((job) => [job, !testedRun]));
  return testedRun ? { full: false, jobs, testedRun, selection: 'tested tree' } : { full: true, jobs, testedRun: null, selection: 'full suite' };
}

/** A selected job must succeed; only an unselected job may be skipped. */
export function checkCiResults(plan, results) {
  return CI_JOBS.filter((job) =>
    results[job] !== 'success' && !(plan.jobs[job] === false && results[job] === 'skipped'));
}

/**
 * WHETHER A TRACKED PATH CAN CHANGE WHAT `build` PRODUCES. The build's output is cached under a hash of
 * every path this accepts (scripts/ci/ci.mjs `build-key`), so a PR whose push changed only tests, gates,
 * workflows or prose restores the last build of the same sources instead of spending ~75s rebuilding
 * them — and the gate shards start their gates without waiting for the build job at all. Narrow on
 * purpose: anything not provably outside the bundle stays in, because a stale hit serves old bytes.
 */
export function isBuildInput(path) {
  if (/(^|\/)__tests__\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path)) return false;
  if (/^(\.github|\.agent|docs|evals)\//.test(path)) return false;
  if (/^scripts\/(gates\/|gates?[-.][^/]*\.mjs$)/.test(path)) return false;
  // How the test shards are packed (scripts/lib/timed-sequencer.mjs) never reaches the bundle.
  if (/^scripts\/(ci\/test-timings\.(json|mjs)|lib\/timed-sequencer\.mjs)$/.test(path)) return false;
  if (/^[^/]+\.md$/.test(path)) return false;
  return true;
}

/**
 * The build cache's key from `git ls-files -s` output: git's own object ids for every build input
 * (`isBuildInput`), so it costs one `ls-files` rather than reading the tree. scripts/ci/ci.mjs
 * `build-key` keys CI's build cache on it; scripts/gate-container.mjs keys its build volume on it.
 * @param {string} stagedIndex  `git ls-files -s` output
 * @returns {{ key: string, inputs: number }}
 */
export function buildKey(stagedIndex) {
  const index = stagedIndex.split('\n').filter((line) => line && isBuildInput(line.slice(line.indexOf('\t') + 1)));
  return { key: createHash('sha256').update(index.join('\n')).digest('hex').slice(0, 32), inputs: index.length };
}

/**
 * WHAT THE TEST GLOBAL SETUP BUILDS FROM. Every Vitest run first asks the server reader's content marker
 * (services/app/scripts/server-reader-cache.mjs) whether `lib/build-assets` and `public/libraries` match this tree,
 * and rebuilds both on a miss (~10s on a runner). CI caches the two directories under a hash of the paths this
 * accepts (scripts/ci/ci.mjs `test-builds-key`): the build tools, the hosted components and libraries, and the source
 * trees the component bundle reads. The key only chooses which entry to restore; the marker still re-hashes every input
 * the last build read, so a path missing here costs a rebuild, never stale bytes.
 * The entry also carries the test database's schema image (services/app/test/setup/schema-image-file.ts), so the
 * schema's sources move the key too: the schema and boot modules, the runner's tables, and the setup that stores the
 * image (the lockfile above covers PGLite). The image's file is named by a hash of the statements themselves, so here
 * too a path missing costs a fresh image, never a stale one.
 */
const TEST_BUILD_INPUTS = /^(?:package-lock\.json|services\/app\/lib\/platform\/(?:schema|db)\.ts|services\/runner\/src\/schema\.ts|services\/app\/test\/setup\/(?:database|schema-image-file)\.ts|services\/app\/package\.json|services\/app\/scripts\/(?:build-server-reader|server-reader-cache|build-libraries|precompress)\.mjs|scripts\/build\/build-html-components\.mjs|scripts\/lib\/(?:html-components-build|component-asset-proof)\.mjs|services\/app\/lib\/(?:html-components|html-component-specs|libraries|dataflow|markdown|mermaid-images|ui-runtime)\/|services\/(?:contracts|utils)\/src\/)/;

/**
 * The test-builds cache key from `git ls-files -s` output, over the paths `TEST_BUILD_INPUTS` accepts, tests excluded.
 * @param {string} stagedIndex  `git ls-files -s` output
 * @returns {{ key: string, inputs: number }}
 */
export function testBuildsKey(stagedIndex) {
  const index = stagedIndex.split('\n').filter((line) => {
    const file = line.slice(line.indexOf('\t') + 1);
    return line && TEST_BUILD_INPUTS.test(file) && !/(^|\/)__tests__\//.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file);
  });
  return { key: createHash('sha256').update(index.join('\n')).digest('hex').slice(0, 32), inputs: index.length };
}
