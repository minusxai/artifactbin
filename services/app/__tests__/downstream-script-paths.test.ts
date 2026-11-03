/**
 * THE scripts/ PATHS OTHER REPOSITORIES RUN, COPY OR IMPORT. Beside `downstream-exports.test.ts` (the `@/lib`
 * contract): the private server repository (minusxai/artifactbin-server) checks this tree out as its
 * `toolkit` submodule and runs, sparse-checks-out or imports these paths, and the private evals repository
 * (minusxai/artifactbin-evals, copied into the gitignored `evals/`) imports or mirrors these modules. A move
 * or rename breaks that repository, which no other check here sees: the server pins product main as soon as
 * its `test` job passes, so a move reaches the server's composition before any paired change can merge.
 *
 * Measured read-only on 2026-11-03 against artifactbin-server 6a10ac0 (toolkit dadea08bad34) and
 * artifactbin-evals 9c5618b; `usedAt` is the consuming file and line there. Removing or changing a row is a
 * change to that contract: do it only together with the named repository.
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
  { path: 'services/app/testing/native-acceptance.mjs', repo: SERVER, usedAt: ['scripts/accept-native-html.mjs:10 (imports the scenario from toolkit/services/app/testing/native-acceptance.mjs)', '.github/workflows/ci.yml native-html (runs it)'] },
  { path: 'scripts/build/build-islands.mjs', repo: SERVER, usedAt: ['scripts/build.mjs:7 (run from toolkit/services/app)', 'test/source-runtime.test.mjs:44'] },
  { path: 'scripts/build/html-core.mjs', repo: SERVER, usedAt: ['scripts/build-native-core.mjs:38 (imports prebuiltPreviewAssets from toolkit/scripts/build/html-core.mjs)', 'test/native-core.test.mjs:33 (reads it)'] },
  { path: 'scripts/lib/dev-env.mjs', repo: EVALS, usedAt: ['lib/dev-server.ts:18 (imports declaredPort, loadDotEnv, resolvePort)'] },
  { path: 'scripts/lib/shard.mjs', repo: EVALS, usedAt: ['lib/task-set.ts:30 (imports parseShardSpec)'] },
  { path: 'scripts/lib/env.ts', repo: EVALS, usedAt: ['lib/env.ts:2 (re-exports it)'] },
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
    expect(DOWNSTREAM_SCRIPT_PATHS.filter((row) => row.repo === SERVER)).toHaveLength(3);
    expect(DOWNSTREAM_SCRIPT_PATHS.filter((row) => row.repo === EVALS)).toHaveLength(4);
  });

  it('names the repository when a path is moved', () => {
    const moved = (path: string) => path !== 'scripts/build/build-islands.mjs' && path !== 'scripts/lib/shard.mjs';
    const problems = missingDownstreamPaths(DOWNSTREAM_SCRIPT_PATHS, moved);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^scripts\/build\/build-islands\.mjs is gone, but minusxai\/artifactbin-server depends on it \(scripts\/build\.mjs/);
    expect(problems[1]).toMatch(/^scripts\/lib\/shard\.mjs is gone, but minusxai\/artifactbin-evals depends on it/);
  });

  it('every one exists in this tree', () => {
    expect(missingDownstreamPaths(DOWNSTREAM_SCRIPT_PATHS, onDisk).join('\n')).toBe('');
  });
});
