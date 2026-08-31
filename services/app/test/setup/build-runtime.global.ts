/**
 * The suite builds the story runtime before it runs — ONCE, for the whole
 * vitest process, whatever invoked it.
 *
 * The document is SERVED, not re-rendered in the app (lib/story/document.ts):
 * SSR loads a prebuilt CJS bundle through `createRequire`, deliberately
 * outside the Next graph. That bundle is a build artifact and is gitignored,
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
 * Cheap enough to do unconditionally (~150ms, esbuild): a staleness check
 * would be the same cost and could be wrong, and a stale bundle means testing
 * a runtime nobody is shipping.
 */
import { execFileSync } from 'child_process';
import path from 'path';

export default function buildStoryRuntime(): void {
  const appRoot = path.resolve(__dirname, '../..');
  execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-story-runtime.mjs')], {
    cwd: appRoot,
    stdio: 'ignore',
  });
}
