/**
 * A Value travels in the link unless its author says otherwise. Form drafts and
 * script-set flags are the two uses that must not: a shared link carried a half
 * typed expense, and a `guest` flag set by a script came back on every reload.
 * `url={false}` keeps a Value out of the address in both directions, and
 * `reset="…"` on a Mutation names the Values to clear once the write succeeds.
 */
import { describe, expect, it } from 'vitest';
import { type JsxElement } from '@/lib/jsx';
import { parseMutationDecl, parseValueDecl, type Dataflow } from '@/lib/story/dataflow';
import { readUrlValues, urlValueParams, writeUrlValues } from '@/lib/story/url-values';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const el = (source: string): JsxElement => parseJsxOrThrow(source).nodes[0] as JsxElement;

describe('<Value url={false}>', () => {
  it('parses onto the declaration, and is absent by default', () => {
    const off = parseValueDecl(el('<Value name="draft" type="string" url={false} />'));
    expect(off.ok && off.decl).toMatchObject({ kind: 'scalar', name: 'draft', url: false });
    const plain = parseValueDecl(el('<Value name="region" type="string" />'));
    expect(plain.ok && 'url' in plain.decl).toBe(false);
    const on = parseValueDecl(el('<Value name="region" type="string" url={true} />'));
    expect(on.ok && 'url' in on.decl).toBe(false);
  });

  it('is refused on a table Value and for a non-boolean', () => {
    expect(parseValueDecl(el('<Value name="rows" type="table" value={[]} columns={[{"name":"a","type":"string"}]} url={false} />')).ok).toBe(false);
    expect(parseValueDecl(el('<Value name="draft" type="string" url="no" />')).ok).toBe(false);
  });

  const flow = {
    values: [
      { kind: 'scalar', name: 'region', type: 'string', default: null, start: 0, end: 0 },
      { kind: 'scalar', name: 'draft', type: 'string', default: null, url: false, start: 0, end: 0 },
      { kind: 'scalar', name: 'guest', type: 'boolean', default: false, url: false, start: 0, end: 0 },
    ],
    queries: [],
    mutations: [],
  } as unknown as Dataflow;

  it('is never written to the address', () => {
    expect(urlValueParams(flow, { region: 'EU', draft: 'Dinner', guest: true })).toEqual({ region: 'EU' });
    expect(writeUrlValues('?key=abc', flow, { region: 'EU', draft: 'Dinner', guest: true })).toBe('?key=abc&$region=EU');
  });

  it('is never read from the address, so a stale link cannot set it', () => {
    expect(readUrlValues('?$region=EU&$draft=Dinner&$guest=true', flow)).toEqual({ region: 'EU' });
  });
});

describe('<Mutation reset="…">', () => {
  const mutation = (attrs: string) => parseMutationDecl(el(`<Mutation name="add" source="ref:abc123" ${attrs}>{\`insert into public.rows (d) values ($draft)\`}</Mutation>`));

  it('parses the names to clear after a successful write', () => {
    const r = mutation('reset="draft amount"');
    expect(r.ok && r.decl.reset).toEqual(['draft', 'amount']);
  });

  it('is absent when not asked for', () => {
    const r = mutation('');
    expect(r.ok && 'reset' in r.decl).toBe(false);
  });
});
