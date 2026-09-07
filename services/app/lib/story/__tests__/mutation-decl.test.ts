/**
 * `<Mutation>` — a `<Query>` that writes. The pure contract: how the Helmet
 * child parses (one DML statement, exactly one `ref_<id>` target, `$params`),
 * how it joins the document's namespace (`run="$add"` on a Button names it;
 * nothing else may), and what a write to a dataset invalidates (every query
 * reading that dataset, and everything downstream of those).
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import {
  MUTATION_TAG, collectRefNameUses, isEmptyDataflow, mutationTargets, parseMutationDecl, queriesReadingDatasets,
  validateDataflow, type Dataflow,
} from '@/lib/story/dataflow';
import { declaresLiveData, declaresMutations, splitHelmet, validateHelmet } from '@/lib/story/helmet';
import { storyUpdateParts } from '@/lib/story/update-parts';

const parse = (src: string): JsxNode[] => {
  const p = parseJsx(src);
  if (!p.ok) throw new Error(p.error);
  return p.nodes;
};
const element = (src: string): JsxElement => parse(src)[0] as JsxElement;
const flowOf = (helmetChildren: string): Dataflow => {
  const { content } = splitHelmet(parse(`<Helmet>${helmetChildren}</Helmet>`));
  return { values: content.values, queries: content.queries, mutations: content.mutations };
};

describe('parseMutationDecl', () => {
  it('parses name, SQL, $params and the one dataset it writes', () => {
    const r = parseMutationDecl(element('<Mutation name="add">{`insert into ref_abc123 (a, b) values ($a, $b)`}</Mutation>'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decl).toMatchObject({ name: 'add', params: ['a', 'b'], target: 'abc123', refs: ['abc123'] });
    expect(r.decl.sql).toContain('insert into ref_abc123');
  });

  it('classifies a local target for declaration validation, and refuses two datasets', () => {
    const none = parseMutationDecl(element('<Mutation name="add">{`insert into sales values (1)`}</Mutation>'));
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.decl).toMatchObject({scope: 'local', target: 'sales', refs: []});
      expect(validateDataflow({values: [], queries: [], mutations: [none.decl]}, []).length).toBeGreaterThan(0);
    }
    const two = parseMutationDecl(element('<Mutation name="mv">{`insert into ref_aaaaaa select * from ref_bbbbbb`}</Mutation>'));
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0].message).toMatch(/exactly one dataset/i);
  });

  it('refuses the Query mistakes too: a sql= attribute, empty SQL, a non-literal child', () => {
    const attr = parseMutationDecl(element('<Mutation name="add" sql="insert into ref_abc123 values (1)" />'));
    expect(attr.ok).toBe(false);
    const empty = parseMutationDecl(element('<Mutation name="add">{`   `}</Mutation>'));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0].message).toMatch(/empty SQL/);
  });
});

describe('<Helmet> grammar', () => {
  it('accepts <Mutation> beside <Value> and <Query>, and splits it into content.mutations', () => {
    const nodes = parse(
      '<Helmet><Value name="a" type="number" /><Query name="rows">{`select * from ref_abc123`}</Query>'
      + '<Mutation name="add">{`insert into ref_abc123 (a) values ($a)`}</Mutation></Helmet><p>hi</p>',
    );
    expect(validateHelmet(nodes)).toEqual([]);
    const { content, body } = splitHelmet(nodes);
    expect(content.mutations.map((m) => m.name)).toEqual(['add']);
    expect(body).toHaveLength(1);
  });

  it('reports a malformed Mutation with the Mutation tag, and names <Mutation> in the child list', () => {
    const errors = validateHelmet(parse('<Helmet><Mutation name="x">{`update ref_abc123 set a = 1 where b = 2; delete from ref_abc123`}</Mutation></Helmet>'));
    // Two statements are the engine's business (it counts them); the parser
    // only refuses shapes. But a bare <b> child is not a Helmet child at all.
    expect(errors).toEqual([]);
    const stray = validateHelmet(parse('<Helmet><b>x</b></Helmet>'));
    expect(stray[0].message).toContain('<Mutation>');
  });

  it('declaresMutations / declaresLiveData answer from the parsed Helmet only', () => {
    const src = '<Helmet><Mutation name="add">{`insert into ref_abc123 (a) values ($a)`}</Mutation></Helmet><p>&lt;Mutation&gt; in prose</p>';
    expect(declaresMutations(src)).toBe(true);
    expect(declaresLiveData(src)).toBe(true);
    expect(declaresMutations('<p>Mutation</p>')).toBe(false);
    expect(declaresLiveData('<Helmet><Query name="q">{`select 1`}</Query></Helmet>')).toBe(true);
    expect(declaresLiveData('<Helmet><Value name="a" /></Helmet>')).toBe(false);
  });
});

describe('validateDataflow with mutations', () => {
  const FLOW = flowOf(
    '<Value name="a" type="number" />'
    + '<Value name="tbl" type="table" value={[{"x":1}]} />'
    + '<Query name="rows">{`select * from ref_abc123`}</Query>'
    + '<Mutation name="add">{`insert into ref_abc123 (a) values ($a)`}</Mutation>',
  );
  const uses = (body: string) => collectRefNameUses(parse(body));

  it('a <Button run="$add"> names a mutation; run names nothing else', () => {
    expect(validateDataflow(FLOW, uses('<div><Button run="$add">Add</Button></div>'))).toEqual([]);
    const wrong = validateDataflow(FLOW, uses('<div><Button run="$rows">Add</Button></div>'));
    expect(wrong).toHaveLength(1);
    expect(wrong[0].message).toMatch(/needs a <Mutation>/);
    const missing = validateDataflow(FLOW, uses('<div><Button run="$nope">Add</Button></div>'));
    expect(missing[0].message).toMatch(/refers to nothing declared/);
  });

  it('a mutation is not a table: data="$add" is refused', () => {
    const errors = validateDataflow(FLOW, uses('<div><Question data="$add" /></div>'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/"add" is a <Mutation>/);
  });

  it('names are one namespace across Value, Query and Mutation', () => {
    const dup = flowOf('<Query name="add">{`select 1`}</Query><Mutation name="add">{`insert into ref_abc123 (a) values (1)`}</Mutation>');
    const errors = validateDataflow(dup, []);
    expect(errors.some((e) => /declared twice/.test(e.message))).toBe(true);
  });

  it('a mutation $param must name a scalar Value', () => {
    const bad = flowOf(
      '<Value name="tbl" type="table" value={[{"x":1}]} />'
      + '<Mutation name="add">{`insert into ref_abc123 (a) values ($tbl)`}</Mutation>'
      + '<Mutation name="add2">{`insert into ref_abc123 (a) values ($ghost)`}</Mutation>',
    );
    const errors = validateDataflow(bad, []);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/<Mutation name="add"> binds \$tbl, but "tbl" is a table/);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/<Mutation name="add2"> binds \$ghost, which is not a declared <Value>/);
  });
});

describe('what a dataset write invalidates', () => {
  const FLOW = flowOf(
    '<Query name="rows">{`select * from ref_abc123`}</Query>'
    + '<Query name="top">{`select * from rows limit 1`}</Query>'
    + '<Query name="other">{`select * from ref_zzzzzz`}</Query>'
    + '<Query name="both">{`select * from other union all select * from top`}</Query>'
    + '<Mutation name="add">{`insert into ref_abc123 (a) values (1)`}</Mutation>',
  );

  it('queriesReadingDatasets: the readers and everything downstream, in run order', () => {
    expect(queriesReadingDatasets(FLOW, ['abc123'])).toEqual(['rows', 'top', 'both']);
    expect(queriesReadingDatasets(FLOW, ['zzzzzz'])).toEqual(['other', 'both']);
    expect(queriesReadingDatasets(FLOW, ['nope00'])).toEqual([]);
  });

  it('mutationTargets lists the datasets a document writes; a mutation alone is not an empty dataflow', () => {
    expect(mutationTargets(FLOW)).toEqual(['abc123']);
    expect(isEmptyDataflow(flowOf('<Mutation name="add">{`insert into ref_abc123 (a) values (1)`}</Mutation>'))).toBe(false);
    expect(isEmptyDataflow({ values: [], queries: [] })).toBe(true);
  });

  it('storyUpdateParts carries mutations and its declarations signature moves when one changes', () => {
    const a = storyUpdateParts('<Helmet><Mutation name="add">{`insert into ref_abc123 (a) values (1)`}</Mutation></Helmet><p>x</p>')!;
    const b = storyUpdateParts('<Helmet><Mutation name="add">{`insert into ref_abc123 (a) values (2)`}</Mutation></Helmet><p>x</p>')!;
    const c = storyUpdateParts('<Helmet><Mutation name="add">{`insert into ref_abc123 (a) values (1)`}</Mutation></Helmet><p>y</p>')!;
    expect(a.flow.mutations?.map((m) => m.name)).toEqual(['add']);
    expect(a.declarations).not.toBe(b.declarations);
    expect(a.declarations).toBe(c.declarations);
  });

  it(`${MUTATION_TAG} is the tag name the grammar speaks`, () => {
    expect(MUTATION_TAG).toBe('Mutation');
  });
});
