/**
 * The suite builds the story runtime ONCE per vitest process, whatever invoked it — `npx vitest`,
 * a watch re-run, an IDE runner or a CI shard — because the prebuilt CJS bundle SSR loads is a
 * gitignored build input the suite owns, not one way of starting it. `--cache` hashes the bundle's
 * inputs against a marker beside it and skips the esbuild pass when nothing changed; stdio is
 * inherited so the one-line skip/build verdict stays visible.
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
