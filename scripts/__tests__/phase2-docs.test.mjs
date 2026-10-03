// DESTINATION: scripts/__tests__/phase2-docs.test.mjs
/**
 * THE DOCS FOLLOW THE SHIPPED READER: the serving/security doc, the contributor commands and the
 * size-target check all describe Phase 2 as it is once it is on.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

describe('documentation', () => {
  it('docs/serving-and-security.md describes the compiled reader, its CSP and the fallback', () => {
    const doc = read('docs/serving-and-security.md');
    expect(doc).toMatch(/compiled reader/i);
    expect(doc).not.toContain('FLAG__COMPILED_READER');
    expect(doc).toMatch(/x-mx-reader/);
    expect(doc).toMatch(/script-src 'self'/);
    for (const file of ['services/app/lib/platform/config.ts', '.env.example', 'docs/phase2-architecture.md']) {
      expect(read(file), file).not.toContain('FLAG__COMPILED_READER');
    }
  });
  it('AGENTS.md names the island build and the compiled hydration gate among the commands', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('build:islands');
    expect(agents).toContain('gate-container.mjs kit-and-fonts');
  });
  it('the size targets block the lab once Phase 2 is on', () => {
    expect(read('.github/workflows/page-speed.yml')).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
  it('the architecture spec records the shipped state, not a plan', () => {
    const spec = read('docs/phase2-architecture.md');
    expect(spec).toMatch(/^Status: shipped/m);
  });
});
