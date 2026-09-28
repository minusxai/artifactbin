/**
 * THE PARITY GATE'S ONE TOLERANCE (scripts/lib/compiled-parity-diff.mjs): an aria-controls /
 * aria-labelledby difference only where the legacy page's single referenced id is absent from that
 * page — the same rule as the unit helper (services/app/lib/islands/__tests__/kit-parity.ts).
 */
import { describe, expect, it } from 'vitest';
import { diffTrees, holdAnimations, stripReaderParam, survivalOf, withoutReaderParam } from '../lib/compiled-parity-diff.mjs';

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

describe('survivalOf', () => {
  const kept = { kept: true, undrawnMermaid: false, avatarReplaced: false };
  const lost = (extra = {}) => ({ kept: false, undrawnMermaid: false, avatarReplaced: false, ...extra });
  it('passes when every served element is kept', () => {
    expect(survivalOf([kept, kept])).toMatchObject({ served: 2, survived: 2, exempt: 0, ok: true });
  });
  it('excuses an undrawn Mermaid placeholder, an Avatar fallback, or a deck thumbnail template with its slide in place', () => {
    expect(survivalOf([kept, lost({ undrawnMermaid: true })])).toMatchObject({ served: 2, survived: 1, exempt: 1, ok: true });
    expect(survivalOf([kept, lost({ avatarReplaced: true })])).toMatchObject({ served: 2, survived: 1, exempt: 1, ok: true });
    expect(survivalOf([kept, lost({ thumbReplaced: true })])).toMatchObject({ served: 2, survived: 1, exempt: 1, ok: true });
    expect(survivalOf([kept, lost()])).toMatchObject({ survived: 1, exempt: 0, ok: false });
    expect(survivalOf([lost({ avatarReplaced: true }), lost()]).ok).toBe(false);
  });
  it('fails a page that served nothing', () => {
    expect(survivalOf([]).ok).toBe(false);
  });
});

describe('the gate\'s reader switch', () => {
  it('removes only reader=legacy|compiled, plain or percent-encoded, keeping every other parameter', () => {
    expect(withoutReaderParam('/login?callbackUrl=%2Fa%2FX%2Fraw%3Freader%3Dlegacy')).toBe('/login?callbackUrl=%2Fa%2FX%2Fraw');
    expect(withoutReaderParam('/login?callbackUrl=%2Fa%2FX%2Fraw%3Freader%3Dcompiled')).toBe('/login?callbackUrl=%2Fa%2FX%2Fraw');
    expect(withoutReaderParam('/login?callbackUrl=%2Fa%2FX%2Fraw%3Freader%3Dcompiled%26region%3DEU')).toBe('/login?callbackUrl=%2Fa%2FX%2Fraw%3Fregion%3DEU');
    expect(withoutReaderParam('/a/x?reader=legacy')).toBe('/a/x');
    expect(withoutReaderParam('/a/x?reader=legacy&region=EU')).toBe('/a/x?region=EU');
    expect(withoutReaderParam('/a/x?region=EU&reader=compiled#top')).toBe('/a/x?region=EU#top');
  });
  it('leaves everything else alone', () => {
    for (const v of ['/a/x?reader=compiledish', 'readers=legacy', '/a/x?reader=other', 'reader=legacy', 'plain text', '/a/x?region=EU']) expect(withoutReaderParam(v)).toBe(v);
  });
  it('applies to every attribute value in a snapshot tree, and to nothing else', () => {
    const tree = [{ tag: 'div', attrs: { id: 'a' }, refs: {}, style: {}, box: [], text: '?reader=legacy', kids: [{ tag: 'a', attrs: { href: '/login?callbackUrl=%2Fa%3Freader%3Dcompiled' }, refs: {}, style: {}, box: [], text: '', kids: [] }] }];
    const out = stripReaderParam(tree);
    expect(out[0].kids[0].attrs.href).toBe('/login?callbackUrl=%2Fa');
    expect(out[0].text).toBe('?reader=legacy');
    expect(out[0].attrs.id).toBe('a');
  });
});

describe('holdAnimations', () => {
  const animation = (iterations, endTime = 1000) => {
    const a = { paused: false, finished: false, currentTime: 437, effect: { getComputedTiming: () => ({ iterations, endTime }) } };
    a.pause = () => { a.paused = true; }; a.finish = () => { a.finished = true; };
    return a;
  };
  it('pauses an infinite animation at time 0 and finishes a finite one, whatever moment each was caught in', () => {
    const pulse = animation(Infinity, Infinity); const fade = animation(1);
    expect(holdAnimations({ getAnimations: () => [pulse, fade] })).toBe(2);
    expect([pulse.paused, pulse.currentTime, pulse.finished]).toEqual([true, 0, false]);
    expect([fade.finished, fade.paused]).toEqual([true, false]);
  });
  it('holds at time 0 an animation that cannot finish', () => {
    const odd = animation(1); odd.finish = () => { throw new Error('InvalidStateError'); };
    holdAnimations({ getAnimations: () => [odd] });
    expect([odd.paused, odd.currentTime]).toEqual([true, 0]);
  });
  it('is self-contained, so the gate can run it in the page', () => {
    expect(holdAnimations.toString()).not.toMatch(/\b(?:import|require)\b/);
  });
});
