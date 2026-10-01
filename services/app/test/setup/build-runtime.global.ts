/**
 * The suite builds the story runtime ONCE per vitest process, whatever invoked it — `npx vitest`,
 * a watch re-run, an IDE runner or a CI shard — because the prebuilt CJS bundle SSR loads is a
 * gitignored build input the suite owns, not one way of starting it. `--cache` hashes the bundle's
 * inputs against a marker beside it and skips the esbuild pass when nothing changed; that marker is
 * checked HERE first, in-process, so a hit costs no build process (and none of the builders' imports).
 *
 * The shared island build (scripts/build-islands.mjs) is the same kind of input — the compiler and
 * the assembler read public/islands/manifest.json — so every test process gets it the same way. So is
 * the CLI's generated teaching, which source consumers import: its content-verified cache makes the
 * call free when `npm test` already generated it (scripts/lib/generate-teaching.mjs).
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { generateTeaching } from '../../../../scripts/lib/generate-teaching.mjs';
import { serverReaderFresh } from '../../scripts/server-reader-cache.mjs';

export default async function buildStoryRuntime(): Promise<void> {
  const appRoot = path.resolve(__dirname, '../..');
  await generateTeaching();
  if (serverReaderFresh()) console.log('build-server-reader: inputs unchanged, skipping rebuild (cache hit)');
  else execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-server-reader.mjs'), '--cache'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [path.resolve(appRoot, '../../scripts/build-islands.mjs'), '--cache'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
}
