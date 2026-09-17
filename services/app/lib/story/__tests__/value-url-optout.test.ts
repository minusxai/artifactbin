/**
 * A Value travels in the link unless its author says otherwise. Form drafts and
 * script-set flags are the two uses that must not: a shared link carried a half
 * typed expense, and a `guest` flag set by a script came back on every reload.
 * `url={false}` keeps a Value out of the address in both directions, and
 * `reset="…"` on a Mutation names the Values to clear once the write succeeds.
 */
import { describe, expect, it } from 'vitest';
import { type JsxElement } from '@/lib/jsx';
import { parseMutationDecl, parseValueDecl, validateDataflow, type Dataflow } from '@/lib/story/dataflow';
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

  /*
   * The case above is refused for its empty `value=` before url= is ever read.
   * A table that is otherwise VALID is the one that proves the refusal, and it
   * must name the attribute an author has to remove.
   */
  it('names url= when an otherwise valid table Value asks for it', () => {
    const r = parseValueDecl(el('<Value name="rows" type="table" value={[{"a":1}]} url={false} />'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toMatchObject([{ attr: 'url', message: expect.stringContaining('only a scalar') }]);
    expect(parseValueDecl(el('<Value name="rows" type="table" value={[{"a":1}]} />')).ok).toBe(true);
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
    expect(mutation('reset="  "').ok && 'reset' in (mutation('reset="  "') as { decl: object }).decl).toBe(false);
  });

  it('is refused when it is not a static string', () => {
    expect(mutation('reset={7}').ok).toBe(false);
  });

  /** Publish sees the whole document, so that is where a reset name is judged. */
  it('is a publish error naming the mutation and the offending name', () => {
    const decl = (attrs: string) => {
      const parsed = mutation(attrs);
      if (!parsed.ok) throw new Error('mutation did not parse');
      return parsed.decl;
    };
    const flow = (reset: string): Dataflow => ({
      values: [
        { kind: 'scalar', name: 'draft', type: 'string', default: null, start: 0, end: 0 },
        { kind: 'table', name: 'rows', rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }], start: 0, end: 0 },
      ],
      queries: [],
      mutations: [decl(`reset="${reset}"`)],
    });
    expect(validateDataflow(flow('draft'), [])).toEqual([]);
    for (const [reset, offender] of [['rows', 'rows'], ['nope', 'nope'], ['draft nope', 'nope']] as const) {
      const errors = validateDataflow(flow(reset), []);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain('name="add"');
      expect(errors[0]!.message).toContain(offender);
    }
  });
});
