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
  it('AGENTS.md names the island build and the compiled hydration gate among the commands', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('build:islands');
    expect(agents).toContain('gate-container.mjs kit-and-fonts');
  });
  it('the page-speed lab enforces size targets', () => {
    expect(read('.github/workflows/page-speed.yml')).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
});
