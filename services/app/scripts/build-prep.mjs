/**
 * Runs the three build steps `vite build` depends on but that do not depend on EACH OTHER — the
 * server-rendering/offline assets (lib/build-assets), the shared island bundle (public/islands) and
 * the generated route table (server/routes.generated.ts) — concurrently instead of in sequence. Each
 * writes to its own output path and reads only from the source tree, never another's output (verified
 * by inspection, not by a shared lock), so running them together is safe and saves whichever of the
 * three is not the slowest (the island build is the long pole: ~40s against the others' ~10s and
 * under 1s). `vite build` itself still runs after, in package.json's `build` script, because it
 * consumes all three.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = join(APP, '../..');

// `--cache`: both skip when their content-verified marker matches this tree (the test global setup
// keys them the same way), so a build after a test run, or CI's restored test builds, reuses them.
const steps = [
  { cwd: APP, args: ['scripts/build-server-reader.mjs', '--cache'] },
  { cwd: REPO, args: ['scripts/build-islands.mjs', '--cache'] },
  { cwd: APP, args: ['scripts/generate-routes.mjs'] },
];

const run = ({ cwd, args }) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${args.join(' ')} exited with ${signal ?? code}`));
  });
});

const results = await Promise.allSettled(steps.map(run));
const failed = results.filter((result) => result.status === 'rejected');
if (failed.length) {
  for (const result of failed) console.error(result.reason?.message ?? result.reason);
  process.exit(1);
}
