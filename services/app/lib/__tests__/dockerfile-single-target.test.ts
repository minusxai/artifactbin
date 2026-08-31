/** ONE image: the Dockerfile has one final stage running server.mjs, and names none of the split-shape entrypoints. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const text = fs.readFileSync(path.resolve(__dirname, '../../../../Dockerfile'), 'utf8');
describe('the Dockerfile', () => {
  it('names no split-shape entrypoint or pruner', () => {
    for (const dead of ['app-only', 'proxy-standalone', 'server.mts', 'provision-split', 'prune-runtime-deps', 'app-lean', 'runtime-lean', 'AS proxy', 'AS app'])
      expect(text, dead).not.toContain(dead);
  });
  it('runs server.mjs as its one final stage', () => {
    expect(text).toMatch(/CMD \["node", ?"server\.mjs"\]/);
    expect((text.match(/^FROM /gm) ?? []).length).toBeLessThanOrEqual(3);
  });
});
