/**
 * The suite builds the story runtime before it runs — ONCE, for the whole
 * vitest process, whatever invoked it.
 *
 * Standalone document rendering (lib/story/document.ts) loads a prebuilt CJS
 * bundle through `createRequire`, outside the web bundle. That bundle is a build artifact and is gitignored,
 * so a fresh checkout does not have one — and a suite that assumes it exists
 * fails with `Cannot find module .../story-ssr.cjs` on every document test.
 *
 * That assumption used to live in package.json's `pretest` hook, which only
 * fires for `npm test`. CI runs the projects directly (`npx vitest run
 * --project=api --shard=…`), so it never fired there and every document test
 * failed on every push while the same suite was green on a laptop that had
 * built the bundle at some point. The dependency belongs to the SUITE, not to
 * one way of starting it, so it lives here: `npx vitest`, a watch run, an IDE
 * runner and a CI shard all get the same guarantee.
 *
 * Runs on EVERY vitest invocation (a fresh `npx vitest`, a watch re-run, an IDE
 * runner, a CI shard), so it is cached: `--cache` makes the script hash its
 * inputs against a marker beside the output bundle and skip the ~0.8s esbuild
 * pass when nothing that feeds the bundle has changed, rebuilding on any change
 * (see scripts/build-story-runtime.mjs). stdio is inherited rather than
 * discarded so the one-line skip/build verdict is visible — a silent build is
 * how a stale or absent bundle went unnoticed before.
 */
import { execFileSync } from 'child_process';
import path from 'path';

export default function buildStoryRuntime(): void {
  const appRoot = path.resolve(__dirname, '../..');
  execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-story-runtime.mjs'), '--cache'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
}
