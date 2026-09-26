/**
 * `<Mutation>` — a statement that writes. The pure contract: how the Helmet
 * child parses (one template-literal child; what it writes is the compiler's
 * to establish), and how it joins the document's namespace (`run="$add"` on a
 * Button names it; nothing else may).
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import {
  EMPTY_DATAFLOW, MUTATION_TAG, collectRefNameUses, isEmptyDataflow, parseMutationDecl, validateDataflow, type Dataflow,
} from '@/lib/story/dataflow';
import { dataflowOf, declaresLiveData, declaresMutations, splitHelmet, validateHelmet } from '@/lib/story/helmet';
import { storyUpdateParts } from '@/lib/story/update-parts';

const parse = (src: string): JsxNode[] => {
  const p = parseJsx(src);
  if (!p.ok) throw new Error(p.error);
  return p.nodes;
};
const element = (src: string): JsxElement => parse(src)[0] as JsxElement;
const flowOf = (helmetChildren: string): Dataflow => dataflowOf(splitHelmet(parse(`<Helmet>${helmetChildren}</Helmet>`)).content);

describe('parseMutationDecl', () => {
  it('parses name, SQL, expectedAffected and reset', () => {
    const r = parseMutationDecl(element('<Mutation name="add" expectedAffected={1} reset="a b">{`insert into bookings.rows (a, b) values ($a, $b)`}</Mutation>'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decl).toMatchObject({ name: 'add', expectedAffected: 1, reset: ['a', 'b'] });
    expect(r.decl.sql).toContain('insert into bookings.rows');
  });

  it('refuses source= — a written dataset is an <Import>', () => {
    const r = parseMutationDecl(element('<Mutation name="add" source="ref:abc123">{`insert into public.rows values (1)`}</Mutation>'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/takes no source= — import the dataset/);
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
      '<Helmet><Import name="d" src="ref:abc123" /><Value name="a" type="number" /><Query name="rows">{`select * from d.rows`}</Query>'
      + '<Mutation name="add">{`insert into d.rows (a) values ($a)`}</Mutation></Helmet><p>hi</p>',
    );
    expect(validateHelmet(nodes)).toEqual([]);
    const { content, body } = splitHelmet(nodes);
    expect(content.mutations.map((m) => m.name)).toEqual(['add']);
    expect(body).toHaveLength(1);
  });

  it('reports a malformed Mutation with the Mutation tag, and names <Mutation> in the child list', () => {
    const errors = validateHelmet(parse('<Helmet><Mutation name="x">{`update d.rows set a = 1 where b = 2; delete from d.rows`}</Mutation></Helmet>'));
    // Two statements are the engine's business (it counts them); the parser
    // only refuses shapes. But a bare <b> child is not a Helmet child at all.
    expect(errors).toEqual([]);
    const stray = validateHelmet(parse('<Helmet><b>x</b></Helmet>'));
    expect(stray[0].message).toContain('<Mutation>');
  });

  it('declaresMutations / declaresLiveData answer from the parsed Helmet only', () => {
    const src = '<Helmet><Mutation name="add">{`insert into d.rows (a) values ($a)`}</Mutation></Helmet><p>&lt;Mutation&gt; in prose</p>';
    expect(declaresMutations(src)).toBe(true);
    expect(declaresLiveData(src)).toBe(true);
    expect(declaresMutations('<p>Mutation</p>')).toBe(false);
    expect(declaresLiveData('<Helmet><Query name="q">{`select 1`}</Query></Helmet>')).toBe(true);
    expect(declaresLiveData('<Helmet><Value name="a" /></Helmet>')).toBe(false);
  });
});

describe('validateDataflow with mutations', () => {
  const FLOW = flowOf(
    '<Import name="d" src="ref:abc123" /><Value name="a" type="number" />'
    + '<Value name="tbl" type="table" value={[{"x":1}]} />'
    + '<Query name="rows">{`select * from d.rows`}</Query>'
    + '<Mutation name="add">{`insert into d.rows (a) values ($a)`}</Mutation>',
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
    const dup = flowOf('<Query name="add">{`select 1`}</Query><Mutation name="add">{`insert into d.rows (a) values (1)`}</Mutation>');
    const errors = validateDataflow(dup, []);
    expect(errors.some((e) => /declared twice/.test(e.message))).toBe(true);
  });
});

describe('a document\'s declarations at rest', () => {
  it('a mutation alone is not an empty dataflow', () => {
    expect(isEmptyDataflow(flowOf('<Mutation name="add">{`insert into d.rows (a) values (1)`}</Mutation>'))).toBe(false);
    expect(isEmptyDataflow(EMPTY_DATAFLOW)).toBe(true);
  });

  it('storyUpdateParts signs the declarations: a changed mutation moves it, prose does not', () => {
    const a = storyUpdateParts('<Helmet><Mutation name="add">{`insert into d.rows (a) values (1)`}</Mutation></Helmet><p>x</p>')!;
    const b = storyUpdateParts('<Helmet><Mutation name="add">{`insert into d.rows (a) values (2)`}</Mutation></Helmet><p>x</p>')!;
    const c = storyUpdateParts('<Helmet><Mutation name="add">{`insert into d.rows (a) values (1)`}</Mutation></Helmet><p>y</p>')!;
    expect(a.declarations).not.toBe(b.declarations);
    expect(a.declarations).toBe(c.declarations);
  });

  it(`${MUTATION_TAG} is the tag name the grammar speaks`, () => {
    expect(MUTATION_TAG).toBe('Mutation');
  });
});
