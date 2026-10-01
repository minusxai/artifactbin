#!/usr/bin/env node
/**
 * WHAT THE BROWSER GATES RUN, AND NOTHING ELSE: the app (SPA, compiled reader, islands, route table,
 * public libraries), the bundled server they boot (`dist/server.mjs`) and the CLI bundle the
 * conformance, session and test-user gates drive (`services/cli/dist/afbin.mjs`).
 *
 * `npm run build -w services/cli` builds those too, then spends ~20s more on what no gate reads: the
 * CLI's type declarations and the host runtime `afbin serve` ships (two more server bundles, the
 * preview build, 4,400 copied files and their archive). Each gate shard builds this subset itself,
 * in the background while it provisions browsers, instead of waiting for the `build` job's whole CLI
 * build and downloading it. The bundle options are the CLI's own (services/cli/scripts/bundle-options.mjs),
 * so the bytes match what `build.mjs` writes.
 *
 *   node scripts/build-gate-inputs.mjs
 */
import { execFileSync } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { cliBundle } from '../services/cli/scripts/bundle-options.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'services/cli');

const started = Date.now();
// The app build (its prebuild generates the CLI teaching the bundle imports) and dist/server.mjs.
execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });
await build({ ...cliBundle({ afbin: 'src/main.ts', index: 'src/index.ts' }), absWorkingDir: cli, outdir: 'dist' });
await chmod(join(cli, 'dist/afbin.mjs'), 0o755);
console.log(`build-gate-inputs: app, dist/server.mjs and services/cli/dist/afbin.mjs in ${((Date.now() - started) / 1000).toFixed(1)}s`);
