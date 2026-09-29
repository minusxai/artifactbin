import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { largeFixture } from '../../p3-onetree/large-fixture.mjs';

const root = path.resolve(import.meta.dirname, '../../../../../..');
const probe = (large = false) => JSON.parse(execFileSync(process.execPath, ['services/app/lib/islands/p3-onetree/probe.mjs', ...(large ? ['--large'] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim());

describe('one tree Solid probe', () => {
  it('keeps static DOM and activates a sibling live control', () => {
    const result = probe();
    for (const kind of ['placeholder', 'sibling-placeholder']) {
      expect(result.variants[kind].exception).toBeNull();
      expect(result.variants[kind].warnings).toEqual([]);
      expect(Object.values(result.variants[kind].identity)).toEqual([true, true, true, true]);
      expect(result.variants[kind].keysAfter).toBe(result.variants[kind].keysBefore);
    }
    expect(result.variants.placeholder.sizes.hasStaticText).toBe(false);
    expect(result.variants['sibling-placeholder'].switchPressed).toBe('true');
    expect(result.variants['nested-placeholder'].switchPressed).toBe('false');
  }, 120_000);

  it('keeps 1,100 giant static rows outside the client module', () => {
    const fixture = largeFixture();
    expect(fixture.rowCount).toBe(1_100);
    expect(Buffer.byteLength(fixture.source)).toBeGreaterThan(11_000_000);
    const result = probe(true);
    expect(result.module.raw).toBeLessThan(10_000);
    expect(result.hydration).toMatchObject({ identity: { lastRow: true, lastPanel: true, lastTab: true }, selected: 'active', visible: true, lastRowPreserved: true, switchPressed: 'true', warnings: [], exception: null });
    expect(result.hydration.keysAfter).toBe(result.hydration.keysBefore);
  }, 120_000);
});
