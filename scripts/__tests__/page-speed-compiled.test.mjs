// DESTINATION: scripts/__tests__/page-speed-compiled.test.mjs
/**
 * THE LAB MEASURES THE COMPILED READER (docs/phase2-architecture.md §11): the page-speed fixtures gain
 * the kitchen sink ("every component", target 2), the head build is measured with the compiled reader
 * on, and the size-target check sees every fixture it judges.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SPEED_FIXTURES, publishPageSpeedFixtures } from '../fixtures/page-speed/index.mjs';
import { SIZE_TARGETS } from '../build/size-targets.mjs';

const root = path.resolve(import.meta.dirname, '../..');

describe('the fixtures', () => {
  it('include the kitchen sink, painted when its chart is drawn', () => {
    const kitchen = PAGE_SPEED_FIXTURES.find((f) => f.key === 'kitchen');
    expect(kitchen).toBeTruthy();
    expect(kitchen.painted).toEqual({ charts: 1 });
  });
  it('publish the kitchen sink\'s refs (dataset, recipe, image, pdf) before the document that names them', async () => {
    const bodies = [];
    await publishPageSpeedFixtures(async (body) => { bodies.push(body); return { id: `id${bodies.length}` }; });
    const kitchen = bodies.find((b) => b.title === 'Perf G kitchen sink');
    expect(kitchen).toBeTruthy();
    const index = bodies.indexOf(kitchen);
    expect(bodies.slice(0, index).some((b) => b.viz)).toBe(true);
    expect(bodies.slice(0, index).some((b) => b.pdf)).toBe(true);
    expect(kitchen.markup).not.toContain('{{');
  });
  it('are every fixture the size targets judge', () => {
    const keys = new Set(PAGE_SPEED_FIXTURES.map((f) => f.key));
    for (const target of SIZE_TARGETS) for (const key of [...target.fixtures, ...target.optional]) expect(keys.has(key), key).toBe(true);
  });
});

describe('the lab run', () => {
  const loads = readFileSync(path.join(root, 'scripts/ci/performance-loads.mjs'), 'utf8');
  it('boots the measured server without a legacy reader switch, so the head measures Phase 2', () => {
    expect(loads).not.toContain('FLAG__COMPILED_READER');
  });
  it('the workflow judges the size targets on the head', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/page-speed.yml'), 'utf8');
    expect(workflow).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
});
