/** A CLI build generates its teaching once: the app's prebuild and the server bundles reuse that generation. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('teaching generation during a build', () => {
  it('runs every build step through the content-verified cache', () => {
    const app = JSON.parse(readFileSync(path.join(ROOT, 'services/app/package.json'), 'utf8'));
    expect(app.scripts.prebuild).toBe('node ../../scripts/lib/generate-teaching.mjs');
    const cli = readFileSync(path.join(ROOT, 'services/cli/scripts/build.mjs'), 'utf8');
    expect(cli).toContain('"../../scripts/lib/generate-teaching.mjs"');
    expect(cli).not.toContain('"scripts/generate-teaching.mjs"');
  });
  it('generates on the first call and reuses that output on the next', () => {
    const run = () => execFileSync(process.execPath, ['scripts/lib/generate-teaching.mjs'], { cwd: ROOT, encoding: 'utf8' });
    run();
    expect(run()).toContain('teaching: cached');
  }, 60_000);
});
