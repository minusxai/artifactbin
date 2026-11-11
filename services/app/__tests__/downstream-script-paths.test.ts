/**
 * THE scripts/ PATHS OTHER REPOSITORIES RUN, COPY OR IMPORT. Beside `downstream-exports.test.ts` (the `@/lib`
 * contract): the private server repository (minusxai/artifactbin-server) checks this tree out as its
 * `toolkit` submodule and runs, sparse-checks-out or imports these paths, and the private evals repository
 * (minusxai/artifactbin-evals, copied into the gitignored `evals/`) imports or mirrors these modules. A move
 * or rename breaks that repository, which no other check here sees: the server pins product main as soon as
 * its `test` job passes, so a move reaches the server's composition before any paired change can merge.
 *
 * Measured read-only on 2026-11-03 against artifactbin-server 6a10ac0 (toolkit dadea08bad34) and
 * artifactbin-evals 9c5618b, with the server's build paths added on 2026-11-10 at 80fc0cd; `usedAt` is the consuming file and line there. Removing or changing a row is a
 * change to that contract: do it only together with the named repository.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  /** Names the consumer imports from this file: removing or renaming one breaks it as a moved file does. */
  exports?: string[];
}

const DOWNSTREAM_SCRIPT_PATHS: DownstreamPath[] = [
  { path: 'services/app/scripts/migrate-legacy-pages.ts', repo: SERVER, usedAt: ['scripts/build-source.mjs (bundles the privileged maintenance CLI into the app image)'] },
  { path: 'services/app/testing/native-acceptance.mjs', repo: SERVER, usedAt: ['scripts/accept-native-html.mjs:10 (imports the scenario from toolkit/services/app/testing/native-acceptance.mjs)', '.github/workflows/ci.yml native-html (runs it)'] },
  { path: 'scripts/build/build-islands.mjs', repo: SERVER, usedAt: ['scripts/build.mjs:7 (run from toolkit/services/app)', 'test/source-runtime.test.mjs:44'] },
  { path: 'scripts/build/html-core.mjs', repo: SERVER, exports: ['prebuiltPreviewAssets'], usedAt: ['scripts/build-native-core.mjs:38 (imports prebuiltPreviewAssets from toolkit/scripts/build/html-core.mjs)', 'test/native-core.test.mjs:33 (reads it)'] },
  // The server's native build test imports these by name through its bundle. Removing `buildPreviewDatasets` here on
  // 2026-11-11 (the skill dropped GraphQL) failed the server's composition for five pins and held every deploy.
  { path: 'services/app/lib/skills/preview-assets.server.ts', repo: SERVER, exports: ['compactSkillScript', 'buildPreviewParser', 'buildToolboxPlatform'], usedAt: ['test/native-core.test.mjs:34 (re-exports them by name from the bundled entry)'] },
  // A setup file, not a script: the server's suite lists it behind an existsSync, so a move would only drop its in-memory
  // database seam there, silently. It stays importable alone, with no provided schemaImageDir, env or build step.
  { path: 'services/app/test/setup/database.ts', repo: SERVER, usedAt: ['vitest.config.ts setupFiles (toolkit/services/app/test/setup/database.ts, guarded by existsSync; read 2026-11-10)'] },
  // Read on 2026-11-10 at artifactbin-server 80fc0cd: what its build and composition reach by path beyond the rows above.
  { path: 'services/app/scripts/copy-assets.mjs', repo: SERVER, usedAt: ['scripts/build.mjs:5 (runs it from the toolkit root for the native build)'] },
  { path: 'services/app/scripts/build-server-reader.mjs', repo: SERVER, usedAt: ['scripts/build.mjs:6 (runs it from toolkit/services/app)'] },
  { path: 'services/app/lib/html-runtime/build.server.ts', repo: SERVER, usedAt: ['scripts/build-native-core.mjs:9,33 (imports the runtime build)'] },
  { path: 'services/runner/src/', repo: SERVER, holds: ['model.mjs', 'runner-worker.mjs', 'server.ts'], usedAt: ['services/runner/application.ts:1 (imports model.mjs)', 'scripts/build-source.mjs:35 (copies every .mjs beside the worker)', 'scripts/source-api.mjs:14 (aliases src/server.ts)'] },
  { path: 'services/sql/src/', repo: SERVER, holds: ['pool-worker.ts', 'server.ts'], usedAt: ['scripts/build-source.mjs:40 (emits pool-worker beside the bundle)', 'scripts/source-api.mjs:14'] },
  { path: 'services/browser/src/', repo: SERVER, holds: ['upload-gateway-server.ts', 'server.ts'], usedAt: ['scripts/build-source.mjs:41 (bundles the upload gateway)', 'services/browser/main.mjs:1', 'scripts/source-api.mjs:14'] },
  { path: 'services/events/src/server.ts', repo: SERVER, usedAt: ['scripts/source-api.mjs:14 (aliases @artifactbin/events/server)'] },
  { path: 'services/app/skills/artifactbin/SKILL.md', repo: SERVER, usedAt: ['scripts/source-runtime.mjs:43 (refuses to copy app assets without it)'] },
  { path: 'services/app/scripts/system-font-packages.mjs', repo: SERVER, usedAt: ['scripts/native-runtime-cache.mjs:41 (keys the runtime cache by the fonts it installs)'] },
  { path: 'services/app/lib/html-systems/font-manifest.json', repo: SERVER, usedAt: ['scripts/native-runtime-cache.mjs:42 and the install action (cache key)'] },
  { path: 'vite.config.mts', repo: SERVER, usedAt: ['vite.config.mts:2 (extends the toolkit configuration)'] },
  { path: 'tsconfig.json', repo: SERVER, usedAt: ['tsconfig.json:2 (extends it)', 'scripts/build-source.mjs'] },
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

/** One line per name a consumer imports that its file no longer exports. */
function missingDownstreamExports(rows: DownstreamPath[], read: (path: string) => string): string[] {
  const problems: string[] = [];
  for (const { path, repo, usedAt, exports = [] } of rows) {
    if (!exports.length) continue;
    const source = read(path);
    for (const name of exports)
      if (!new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${name}\\b`).test(source))
        problems.push(`${path} no longer exports ${name}, but ${repo} imports it (${usedAt.join('; ')}): remove it only with a paired change there`);
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
    expect(DOWNSTREAM_SCRIPT_PATHS.filter((row) => row.repo === SERVER)).toHaveLength(18);
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

  it('names the repository when a name it imports is removed, and every such name is exported here', () => {
    const withoutParser = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/export async function buildPreviewParser\b/, 'async function buildPreviewParser');
    expect(missingDownstreamExports(DOWNSTREAM_SCRIPT_PATHS, withoutParser)).toEqual([expect.stringMatching(/^services\/app\/lib\/skills\/preview-assets\.server\.ts no longer exports buildPreviewParser, but minusxai\/artifactbin-server imports it/)]);
    expect(missingDownstreamExports(DOWNSTREAM_SCRIPT_PATHS, (path) => readFileSync(join(ROOT, path), 'utf8')).join('\n')).toBe('');
  });
});
