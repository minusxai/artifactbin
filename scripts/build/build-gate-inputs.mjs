#!/usr/bin/env node
/**
 * WHAT THE BROWSER GATES RUN, AND NOTHING ELSE: the app (SPA, compiled reader, islands, route table,
 * public libraries) and the bundled server they boot (`dist/server.mjs`). Each gate shard builds this
 * itself, in the background while it provisions browsers, instead of waiting for the `build` job and
 * downloading its output.
 *
 *   node scripts/build/build-gate-inputs.mjs
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const started = Date.now();
execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });
console.log(`build-gate-inputs: app and dist/server.mjs in ${((Date.now() - started) / 1000).toFixed(1)}s`);
