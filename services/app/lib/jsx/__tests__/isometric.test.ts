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
  it('accepts compact hollow profiles, curved pipes and an assembly group at the publish boundary', () => {
    const parts = [{ key: 'assembly', kind: 'group', separation: [10, 0, 20], parts: [
      { key: 'cup', kind: 'revolve', origin: [0, 0, 0], profile: [[0, 0], [10, 0], [14, 30], [12, 30], [8, 3], [0, 3]], segments: 24 },
      { key: 'pipe', kind: 'sweep', points: [[0, 0, 30], [0, 20, 30], [30, 20, 10], [30, 0, 10]], curve: 'bezier', radius: 2 },
    ] }];
    expect(errors(`<Isometric title="Mechanism" appearance="outline" motion="smooth" parts={${JSON.stringify(parts)}} spread="$spread" />`)).toEqual([]);
  });
  it.each([
    { key: 'r', kind: 'revolve', origin: [0, 0, 0], profile: [[-1, 0], [2, 3]] },
    { key: 'r', kind: 'revolve', origin: [0, 0, 0], profile: [[1, 0], [2, 3]], axis: [0, 0, 0] },
    { key: 'r', kind: 'revolve', origin: [0, 0, 0], profile: [[1, 0], [2, 3]], segments: 100000 },
    { key: 's', kind: 'sweep', points: [[0, 0, 0], [0, 0, 0]], radius: 2 },
    { key: 's', kind: 'sweep', points: [[0, 0, 0], [0, 0, 20]], curve: 'bezier', radius: 2 },
    { key: 'g', kind: 'group', parts: [{ ...part, separation: [0, 0, 5] }] },
    { key: 'g', kind: 'group', parts: [part, part] },
  ])('refuses invalid generated shapes', shape => expect(isometricError({ ...spec, parts: [shape] })).toMatch(/Isometric/));
  it('bounds the expanded surface budget across the whole scene', () => {
    const shape = { kind: 'sweep', points: [[0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0]], curve: 'bezier', radius: 1, segments: 64, steps: 128 };
    expect(isometricError({ ...spec, parts: [0, 1, 2].map(i => ({ ...shape, key: String(i) })) })).toMatch(/surface/);
  });
  it.each([
    { ...spec, title: '' }, { ...spec, parts: [] }, { ...spec, parts: [part, part] },
    { ...spec, parts: [{ ...part, width: -1 }] }, { ...spec, parts: [{ ...part, x: Infinity }] },
    { ...spec, parts: [{ ...part, tone: 'url(https://example.com/image)' }] },
    { ...spec, parts: [{ ...part, separation: [0, NaN, 0] }] },
    { ...spec, parts: [{ key: 'p', kind: 'prism', points: [[0, 0], [1, 1]], z: 0, height: 2 }] },
    { ...spec, parts: Array.from({ length: 301 }, (_, i) => ({ ...part, key: String(i) })) },
    { ...spec, parts: [{ key: 'ticks', kind: 'line', points: [[0,0,0],[1,0,0]], repeat: {count: 65, rotation: {axis: [0,0,1], degrees: 5}} }] },
    { ...spec, parts: [{ key: 'ticks', kind: 'line', points: [[0,0,0],[1,0,0]], width: 9 }] },
    { ...spec, width: 0 }, { ...spec, elevation: 90 }, { ...spec, spread: 2 },
  ])('refuses malformed or unbounded geometry', value => expect(isometricError(value)).toMatch(/Isometric/));
  it('rejects dynamic geometry and invalid static parts at the real markup boundary', () => {
    expect(errors('<Isometric title="Assembly" parts={$parts} />').length).toBeGreaterThan(0);
    expect(errors('<Isometric title="Assembly" parts={[]} />').length).toBeGreaterThan(0);
  });
});
