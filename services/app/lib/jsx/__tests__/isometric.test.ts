import { describe, expect, it } from 'vitest';
import { isometricError } from '../isometric-spec';
import { validateJsx } from '../validate';
import { STORY_HTML_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '../component-names';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
const part = { key: 'base', kind: 'slab', x: 0, y: 0, z: 0, width: 100, depth: 60, height: 8 };
const spec = { title: 'Assembly', parts: [part] };
const errors = (source: string) => validateJsx(parseJsxOrThrow(source).nodes, { components: STORY_UI_COMPONENT_NAME_LIST, allowedHtmlTags: STORY_HTML_TAGS, stylePolicy: 'no-inline-style' });
describe('Isometric publish contract', () => {
  it('accepts a static assembly and a reactive separation control', () => {
    expect(isometricError(spec)).toBeNull();
    expect(errors(`<Isometric title="Assembly" parts={${JSON.stringify([part])}} spread="$spread" />`)).toEqual([]);
  });
  it.each([
    { ...spec, title: '' }, { ...spec, parts: [] }, { ...spec, parts: [part, part] },
    { ...spec, parts: [{ ...part, width: -1 }] }, { ...spec, parts: [{ ...part, x: Infinity }] },
    { ...spec, parts: [{ ...part, tone: 'url(https://example.com/image)' }] },
    { ...spec, parts: [{ ...part, separation: [0, NaN, 0] }] },
    { ...spec, parts: [{ key: 'p', kind: 'prism', points: [[0, 0], [1, 1]], z: 0, height: 2 }] },
    { ...spec, parts: Array.from({ length: 301 }, (_, i) => ({ ...part, key: String(i) })) },
    { ...spec, width: 0 }, { ...spec, elevation: 90 }, { ...spec, spread: 2 },
  ])('refuses malformed or unbounded geometry', value => expect(isometricError(value)).toMatch(/Isometric/));
  it('rejects dynamic geometry and invalid static parts at the real markup boundary', () => {
    expect(errors('<Isometric title="Assembly" parts={$parts} />').length).toBeGreaterThan(0);
    expect(errors('<Isometric title="Assembly" parts={[]} />').length).toBeGreaterThan(0);
  });
});
