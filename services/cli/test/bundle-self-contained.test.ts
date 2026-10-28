/**
 * THE BUNDLE RUNS ALONE. `dist/afbin.mjs` is served as a platform binary by a local not-installed eval
 * leg and copied into run homes: one file, no `node_modules` beside it. It declared the SQLite engine
 * external and imported it at load, so that file could not even print `--version`. Built here with the
 * build's own options, into a directory Node cannot resolve a package from, and asked to run a local
 * query — the path that needs the engine's wasm.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { cliBundle } from '../scripts/bundle-options.mjs';

const CLI = fileURLToPath(new URL('..', import.meta.url));

test('the bundled CLI runs a local SQLite query with nothing installed beside it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afbin-bundle-alone-'));
  try {
    await build({ ...cliBundle({ afbin: join(CLI, 'src/main.ts') }), outdir: dir, absWorkingDir: CLI, logLevel: 'silent' });
    await writeFile(join(dir, 'rides.csv'), 'mode,minutes\nbus,36\nbike,29\n');
    await writeFile(join(dir, 'fastest.sql'), 'select mode from public.rows order by minutes limit 1');
    const run = await promisify(execFile)(process.execPath, [join(dir, 'afbin.mjs'), 'query', 'rides.csv', '--input', 'fastest.sql', '--json'], {
      cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ARTIFACTBIN_HOME: join(dir, '.artifactbin'), ARTIFACTBIN_SKILLS: 'off', NO_COLOR: '1' },
    });
    assert.match(run.stdout, /"bike"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
