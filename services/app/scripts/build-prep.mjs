import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));

// `--cache`: both skip when their content-verified marker matches this tree (the test global setup
// keys them the same way), so a build after a test run, or CI's restored test builds, reuses them.
const steps = [
  { cwd: APP, args: ['scripts/build-server-reader.mjs', '--cache'] },
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
