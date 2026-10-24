import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { semanticSnapshot, semanticDifferences, tabsParityFixtures, tabsInteractionCases } from '../lib/component-parity.mjs';
const oracle = JSON.parse(readFileSync(new URL('../../services/app/lib/islands/__tests__/fixtures/react-oracle.json', import.meta.url),'utf8'));
const snapshot = html => semanticSnapshot(new JSDOM(html).window.document);
describe('component semantic parity', () => {
  it('uses real recorded React fixtures for both retained Tabs variants', () => {
    for (const fixture of tabsParityFixtures()) {
      expect(fixture.reference.kind).toBe('recorded-react-ssr');
      expect(oracle[fixture.reference.key]).toBeTypeOf('string');
      expect(snapshot(oracle[fixture.reference.key])).toEqual([
        {role:'tablist',name:'',orientation:'horizontal',focused:false},
        {role:'tab',name:'One',selected:true,disabled:false,focused:false},
      ]);
    }
  });
  it('ignores implementation tags/classes/ids but catches changed names and selection', () => {
    const old = snapshot(oracle[tabsParityFixtures()[0].reference.key]);
    const candidate = snapshot('<af-tabs-list role="tablist"><af-tabs-trigger role="tab" aria-selected="true">One</af-tabs-trigger></af-tabs-list>');
    expect(semanticDifferences(old,candidate)).toEqual([]);
    candidate[1].selected = false; candidate[1].name = 'Wrong';
    expect(semanticDifferences(old,candidate).join('\n')).toMatch(/name: expected "One"/);
    expect(semanticDifferences(old,candidate).join('\n')).toMatch(/selected: expected true/);
  });
  it('detects focus, panel visibility, disabled state, missing nodes and orientation regressions', () => {
    const expected = tabsInteractionCases[1].expected;
    const actual = expected.map(node => ({...node}));
    actual[0].orientation='vertical'; actual[2].disabled=false; actual[3].focused=false; actual[4].hidden=false;
    expect(semanticDifferences(expected,actual).length).toBe(4);
    expect(semanticDifferences(expected,actual.slice(1)).join('\n')).toContain('node count');
  });
  it('resolves authored panel labels without requiring generated IDs to match', () => {
    expect(snapshot('<button id="x" role="tab" aria-selected="true">One</button><section role="tabpanel" aria-labelledby="x" hidden></section>')[1]).toMatchObject({name:'One',hidden:true});
  });
});
