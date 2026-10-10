/**
 * THE scripts/ PATHS OTHER REPOSITORIES RUN, COPY OR IMPORT. Beside `downstream-exports.test.ts` (the `@/lib`
 * contract): the private server repository (minusxai/artifactbin-server) checks this tree out as its
 * `toolkit` submodule and runs, sparse-checks-out or imports these paths, and the private evals repository
 * (minusxai/artifactbin-evals, copied into the gitignored `evals/`) imports or mirrors these modules. A move
 * or rename breaks that repository, which no other check here sees: the server pins product main as soon as
 * its `test` job passes, so a move reaches the server's composition before any paired change can merge.
 *
 * Measured read-only on 2026-10-10 against artifactbin-server 9b773aa (toolkit 40d48ec07e7f) and the evals
 * copy; `usedAt` is the consuming file and line there. Removing or changing a row is a change to that
 * contract: do it only together with the named repository.
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SERVER = 'minusxai/artifactbin-server';
const EVALS = 'minusxai/artifactbin-evals';

interface DownstreamPath {
  /** Repository-relative; a trailing `/` is a directory. */
  path: string;
  repo: typeof SERVER | typeof EVALS;
  usedAt: string[];
  /** Files a directory entry must hold for its consumer. */
  holds?: string[];
}

const DOWNSTREAM_SCRIPT_PATHS: DownstreamPath[] = [
  { path: 'scripts/lib/ci-plan.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:293 (sparse-checkout)', 'scripts/ci-plan.mjs:4 (imports isBuildInput)', 'scripts/runtime-build-key.mjs:7 (imports isBuildInput)'] },
  { path: 'scripts/lib/ci-artifact-wait.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:294 (sparse-checkout)', 'scripts/ci/await-ci-artifact.mjs:10 (import)', 'scripts/prefetch-tested-images.mjs:9 (import)', 'test/tested-images.test.mjs:76 (import)'] },
  { path: 'scripts/ci/npm-provenance.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:295 (sparse-checkout; imported by scripts/lib/ci-artifact-wait.mjs)'] },
  { path: 'scripts/ci/npm-driver.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:296 (sparse-checkout)'] },
  { path: 'scripts/ci/ci.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:127 and :221 (`node scripts/ci/ci.mjs lock-fingerprint`, working-directory toolkit)', 'test/tested-images.test.mjs:286'] },
  { path: 'scripts/ci/link-npm-acceptance.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:463 (run, working-directory toolkit)', 'test/tested-images.test.mjs:121'] },
  { path: 'scripts/ci/npm-acceptance/', repo: SERVER, holds: ['package.json', 'package-lock.json'], usedAt: ['.github/workflows/ci.yml:458-459 (cache path, hashFiles of its lock)', '.github/workflows/ci.yml:461 (`npm ci --prefix scripts/ci/npm-acceptance`)'] },
  { path: 'scripts/gate-cli-conformance.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:680 (`node toolkit/scripts/gate-cli-conformance.mjs`)'] },
  { path: 'scripts/lib/ci-elapsed.mjs', repo: SERVER, usedAt: ['.github/workflows/ci.yml:734 (sparse-checkout)', '.github/workflows/ci.yml:746 (run)', 'test/tested-images.test.mjs:249'] },
  { path: 'scripts/build/build-islands.mjs', repo: SERVER, usedAt: ['scripts/build.mjs:15 (run from toolkit/services/app)', 'test/source-runtime.test.mjs:39', 'test/image-inputs.test.mjs:63'] },
  { path: 'scripts/lib/dev-env.mjs', repo: EVALS, usedAt: ['lib/dev-server.ts:27 (imports declaredPort, loadDotEnv, resolvePort)'] },
  { path: 'scripts/lib/dev-runner.mjs', repo: EVALS, usedAt: ['lib/dev-server.ts:68, main.ts:824, __tests__/dev-server.test.ts:98 (not imported: evals reads login codes where it points the dev server)'] },
  { path: 'scripts/lib/shard.mjs', repo: EVALS, usedAt: ['lib/task-set.ts:30 (imports parseShardSpec)'] },
  { path: 'scripts/lib/credential.ts', repo: EVALS, usedAt: ['lib/credential.ts:5 (re-exports it)', 'groups-deployments.ts:52 and scenarios/live-comment-tracking.mjs:48 (dynamic import)'] },
  { path: 'scripts/lib/env.ts', repo: EVALS, usedAt: ['lib/env.ts:2 (re-exports it)', 'groups-deployments.ts:53 and scenarios/live-comment-tracking.mjs:49 (dynamic import)'] },
  { path: 'scripts/lib/slug.ts', repo: EVALS, usedAt: ['lib/slug.ts:2 (re-exports it)'] },
];

/** One line per row whose path is gone, naming the repository that depends on it. */
function missingDownstreamPaths(rows: DownstreamPath[], exists: (path: string, directory: boolean) => boolean): string[] {
  const problems: string[] = [];
  for (const { path, repo, usedAt, holds = [] } of rows) {
    const directory = path.endsWith('/');
    const gone = !exists(path, directory) ? [path] : holds.map((file) => join(path, file)).filter((file) => !exists(file, false));
    for (const missing of gone) problems.push(`${missing} is gone, but ${repo} depends on it (${usedAt.join('; ')}): move it only with a paired change there`);
  }
  return problems;
}

const onDisk = (path: string, directory: boolean) => {
  const full = join(ROOT, path);
  return existsSync(full) && statSync(full).isDirectory() === directory;
};

describe('scripts/ paths other repositories depend on', () => {
  it('lists the server and evals paths once each', () => {
    const paths = DOWNSTREAM_SCRIPT_PATHS.map((row) => row.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(DOWNSTREAM_SCRIPT_PATHS.filter((row) => row.repo === SERVER)).toHaveLength(10);
    expect(DOWNSTREAM_SCRIPT_PATHS.filter((row) => row.repo === EVALS)).toHaveLength(6);
  });

  it('names the repository when a path is moved', () => {
    const moved = (path: string) => path !== 'scripts/lib/ci-plan.mjs' && path !== 'scripts/ci/npm-acceptance/package-lock.json';
    const problems = missingDownstreamPaths(DOWNSTREAM_SCRIPT_PATHS, moved);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^scripts\/lib\/ci-plan\.mjs is gone, but minusxai\/artifactbin-server depends on it \(\.github\/workflows\/ci\.yml:293/);
    expect(problems[1]).toMatch(/^scripts\/ci\/npm-acceptance\/package-lock\.json is gone, but minusxai\/artifactbin-server depends on it/);
  });

  it('every one exists in this tree', () => {
    expect(missingDownstreamPaths(DOWNSTREAM_SCRIPT_PATHS, onDisk).join('\n')).toBe('');
  });
});
