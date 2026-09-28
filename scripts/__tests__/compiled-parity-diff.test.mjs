/**
 * THE PARITY GATE'S ONE TOLERANCE (scripts/lib/compiled-parity-diff.mjs): an aria-controls /
 * aria-labelledby difference only where the legacy page's single referenced id is absent from that
 * page — the same rule as the unit helper (services/app/lib/islands/__tests__/kit-parity.ts).
 */
import { describe, expect, it } from 'vitest';
import { diffTrees } from '../lib/compiled-parity-diff.mjs';

const el = (attrs = {}, refs = {}, kids = []) => ({ tag: 'button', attrs, refs, style: { color: 'red' }, box: [0, 0, 10, 10], text: '', kids });
const legacyTab = (controls, status) => [el({ role: 'tab', 'aria-controls': controls }, { 'aria-controls': status })];
const compiledTab = (controls, status) => [el({ role: 'tab', 'aria-controls': controls }, { 'aria-controls': status })];

describe('diffTrees', () => {
  it('accepts a compiled idref that corrects a dangling legacy aria-controls / aria-labelledby', () => {
    const d = diffTrees(legacyTab('G1', 'dangling'), compiledTab('panel-one', 'resolved'));
    expect(d.attrs).toEqual([]);
    expect(d.refs).toEqual([]);
    const panel = (v, s) => [el({ role: 'tabpanel', 'aria-labelledby': v }, { 'aria-labelledby': s })];
    const p = diffTrees(panel('G2', 'dangling'), panel('tab-one', 'resolved'));
    expect([...p.attrs, ...p.refs]).toEqual([]);
  });

  it('reports every other idref difference', () => {
    // The legacy reference resolves: the compiled one must match it exactly.
    expect(diffTrees(legacyTab('panel-one', 'resolved'), compiledTab('panel-two', 'resolved')).attrs).toHaveLength(1);
    expect(diffTrees(legacyTab('panel-one', 'resolved'), compiledTab('panel-one', 'dangling')).refs).toHaveLength(1);
    // Several ids in the legacy value: not the single dangling Radix id the rule is about.
    expect(diffTrees(legacyTab('G1 G2', 'dangling'), compiledTab('panel-one', 'resolved')).attrs).toHaveLength(1);
    // Other idref attributes are never excused.
    const described = (v, s) => [el({ 'aria-describedby': v }, { 'aria-describedby': s })];
    const d = diffTrees(described('G1', 'dangling'), described('hint', 'resolved'));
    expect(d.attrs).toHaveLength(1);
    expect(d.refs).toHaveLength(1);
  });

  it('still reports structure, text, style and box differences', () => {
    const a = [el({}, {}, [el()])];
    const b = [{ ...el({}, {}, []), text: 'x', style: { color: 'blue' }, box: [0, 0, 11, 10] }];
    const d = diffTrees(a, b);
    expect([d.structure.length, d.text.length, d.style.length, d.box.length]).toEqual([1, 1, 1, 1]);
  });
});
