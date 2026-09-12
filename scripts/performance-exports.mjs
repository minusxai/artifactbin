/** Module contention measurement (fake browser, isolated local storage). The browser delay is synthetic;
 * storage and the export admission/cache implementation are real. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const scratch = mkdtempSync(path.join(tmpdir(), 'artifactbin-export-performance-'));
const script = path.join(root, '.performance-export.ts');
mkdirSync(path.dirname(output), { recursive: true });
try {
  writeFileSync(script, `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { renderArtifactImage, exportStoreKey, resetExportRenderer } from './services/app/lib/export';
import { objectStore } from './services/app/lib/object-store';
import { setServices } from './services/app/lib/services';
console.log('Starting export contention samples');
const samples = [];
for (let i = 0; i < 7; i++) {
  await resetExportRenderer();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  setServices({ browser: { render: async () => { entered(); await new Promise(resolve => setTimeout(resolve, 1000)); return { ok: true, mime: 'image/png', bytes: new Uint8Array([137,80,78,71]) }; } } });
  const stored = { id: 'stored-' + i, version: 1 };
  await objectStore().put(exportStoreKey(stored, 'png', 'full'), Buffer.from([137,80,78,71]), 'image/png');
  const opts = { pageUrl: () => 'http://localhost/fixture', target: 'body' };
  const cold = renderArtifactImage({ id: 'cold-' + i, version: 1 }, 'png', opts);
  await started;
  const start = performance.now();
  const hit = await renderArtifactImage(stored, 'png', opts);
  samples.push(performance.now() - start);
  assert(hit.ok);
  assert((await cold).ok);
}
writeFileSync(process.argv[2], JSON.stringify({ syntheticBrowserDelayMs: 1000, storage: 'local object store with its normal read cache', repetitions: 7, storedHitMs: samples }, null, 2));
console.log('Saved seven export contention samples');
// This disposable module harness has no server lifecycle to own imported timers.
process.exit(0);
`);
  execFileSync(path.join(root, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(root, 'tsconfig.json'), script, output], {
    cwd: path.join(root, 'services/app'), stdio: 'inherit', timeout: 30000, env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      OBJECT_STORE__LOCAL_DIR: scratch, DATABASE_URL: 'pglite://memory',
      AUTH__SECRET: 'fixture-only-performance-secret',
    },
  });
} finally {
  rmSync(script, { force: true }); rmSync(scratch, { recursive: true, force: true });
}
