import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

describe('reader tooling contracts', () => {
  it('does not expose the retired compiled-reader feature flag', () => {
    for (const file of ['services/app/lib/platform/config.ts', '.env.example']) {
      expect(read(file), file).not.toContain('FLAG__COMPILED_READER');
    }
  });
  it('the native reader build command resolves and the reader handover gate remains documented', () => {
    const agents = read('AGENTS.md');
    const app = JSON.parse(read('services/app/package.json'));
    expect(app.scripts['build:reader']).toBe('node scripts/build-server-reader.mjs');
    expect(read('services/app/scripts/build-server-reader.mjs')).toContain('build-html-components.mjs');
    expect(agents).toContain('gate-container.mjs kit-and-fonts');
  });
  it('the page-speed lab enforces size targets', () => {
    expect(read('.github/workflows/page-speed.yml')).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
});
