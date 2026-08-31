/**
 * The Helmet grammar: the one legal home for
 * title/style/script in a markup document. These tests are the contract —
 * every rule the module doc states is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { hoistHelmet, splitHelmet, validateHelmet } from '@/lib/story/helmet';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`test source failed to parse: ${parsed.error}`);
  return parsed.nodes;
};

const CSS = 'h1 { color: red; }';
const JS = 'document.body.dataset.ran = "1";';

const FULL_HELMET =
  '<Helmet><title>My doc</title><style>{`' + CSS + '`}</style><script>{`' + JS + '`}</script></Helmet>';

describe('validateHelmet', () => {
  it('accepts a document with no Helmet', () => {
    expect(validateHelmet(nodes('<div><p>plain</p></div>'))).toEqual([]);
  });

  it('accepts one full Helmet at top level', () => {
    expect(validateHelmet(nodes(FULL_HELMET + '<div>body</div>'))).toEqual([]);
  });

  it('accepts an empty Helmet', () => {
    expect(validateHelmet(nodes('<Helmet></Helmet><div>body</div>'))).toEqual([]);
  });

  it('accepts a Helmet nested below the top level (canonicalization hoists it)', () => {
    expect(validateHelmet(nodes('<div>' + FULL_HELMET + '<p>body</p></div>'))).toEqual([]);
  });

  it('rejects two Helmets, naming both spans', () => {
    const src = '<Helmet><title>a</title></Helmet><div><Helmet><title>b</title></Helmet></div>';
    const errors = validateHelmet(nodes(src));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/one <Helmet>/i);
    // The error anchors on the SECOND helmet and its message points at the first.
    expect(errors[0].start).toBe(src.indexOf('<Helmet', 5));
  });

  it('rejects attributes on Helmet', () => {
    const errors = validateHelmet(nodes('<Helmet id="x"><title>t</title></Helmet>'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/attribute/i);
  });

  it('rejects attributes on Helmet children', () => {
    const errors = validateHelmet(nodes('<Helmet><style media="print">{`' + CSS + '`}</style></Helmet>'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/attribute/i);
  });

  it('accepts <meta name content>, repeated with distinct names', () => {
    const src = '<Helmet><meta name="description" content="A doc" /><meta name="author" content="Ada" /></Helmet>';
    expect(validateHelmet(nodes(src))).toEqual([]);
  });

  it('rejects a duplicate meta name', () => {
    const src = '<Helmet><meta name="author" content="Ada" /><meta name="author" content="Bo" /></Helmet>';
    const errors = validateHelmet(nodes(src));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/author/);
  });

  it('rejects meta http-equiv and charset (policy channels, not metadata)', () => {
    for (const bad of ['<meta http-equiv="Content-Security-Policy" content="default-src *" />', '<meta charset="utf-16" />']) {
      const errors = validateHelmet(nodes('<Helmet>' + bad + '</Helmet>'));
      expect(errors.length, bad).toBeGreaterThan(0);
      expect(errors[0].message, bad).toMatch(/name.*content|not allowed/i);
    }
  });

  it('rejects meta missing name or content', () => {
    for (const bad of ['<meta name="description" />', '<meta content="orphan" />']) {
      expect(validateHelmet(nodes('<Helmet>' + bad + '</Helmet>')).length, bad).toBeGreaterThan(0);
    }
  });

  it('rejects disallowed children (div, link)', () => {
    for (const child of ['<div>x</div>', '<link rel="x" />']) {
      const errors = validateHelmet(nodes('<Helmet>' + child + '</Helmet>'));
      expect(errors.length, child).toBeGreaterThan(0);
      expect(errors[0].message, child).toMatch(/<title>, <style>, <script>/);
    }
  });

  it('rejects a Helmet nested inside a Helmet (reported as a duplicate)', () => {
    const errors = validateHelmet(nodes('<Helmet><Helmet></Helmet></Helmet>'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/one <Helmet>/i);
  });

  it('rejects duplicate children of one kind', () => {
    const errors = validateHelmet(nodes('<Helmet><title>a</title><title>b</title></Helmet>'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/one <title>/i);
  });

  it('rejects a title with an element child', () => {
    const errors = validateHelmet(nodes('<Helmet><title><b>rich</b></title></Helmet>'));
    expect(errors).toHaveLength(1);
  });

  it('rejects style/script whose child is not a template-literal string', () => {
    for (const bad of ['<style>plain-text</style>', '<script>1</script>', '<script><span>x</span></script>']) {
      // <script>text</script> with real JS cannot parse as JSX text either; use
      // parseable-but-wrong shapes to pin the validator, not the parser.
      const parsed = parseJsx('<Helmet>' + bad + '</Helmet>');
      if (!parsed.ok) continue; // parser already rejects — fine, publish fails earlier
      expect(validateHelmet(parsed.nodes).length, bad).toBeGreaterThan(0);
    }
  });

  it('rejects `</script` inside script text, any case', () => {
    for (const seq of ['</script>', '</SCRIPT foo', '</sCrIpT']) {
      const src = '<Helmet><script>{`var a = "' + seq + '";`}</script></Helmet>';
      const errors = validateHelmet(nodes(src));
      expect(errors.length, seq).toBeGreaterThan(0);
      expect(errors[0].message, seq).toMatch(/<\/script/i);
    }
  });

  it('allows `</style` in style text (the builder strips it instead)', () => {
    const src = '<Helmet><style>{`/* </style> */ h1 { color: red; }`}</style></Helmet>';
    expect(validateHelmet(nodes(src))).toEqual([]);
  });
});

describe('splitHelmet', () => {
  it('returns the tree unchanged when there is no Helmet', () => {
    const tree = nodes('<div><p>plain</p></div>');
    const split = splitHelmet(tree);
    expect(split.helmet).toBeNull();
    expect(split.content).toEqual({ title: null, style: null, script: null, meta: [], values: [], queries: [], mutations: [] });
    expect(split.body).toEqual(tree);
  });

  it('extracts title/style/script losslessly and removes the Helmet from the body', () => {
    const split = splitHelmet(nodes(FULL_HELMET + '<div>body</div>'));
    expect(split.helmet?.tag).toBe('Helmet');
    expect(split.content).toEqual({ title: 'My doc', style: CSS, script: JS, meta: [], values: [], queries: [], mutations: [] });
    expect(split.body).toHaveLength(1);
    expect((split.body[0] as JsxElement).tag).toBe('div');
  });

  it('removes a nested Helmet without disturbing sibling spans', () => {
    const src = '<div>' + FULL_HELMET + '<p>after</p></div>';
    const tree = nodes(src);
    const split = splitHelmet(tree);
    const div = split.body[0] as JsxElement;
    expect(div.children.some((c) => c.type === 'element' && c.tag === 'Helmet')).toBe(false);
    const p = div.children.find((c) => c.type === 'element' && (c as JsxElement).tag === 'p') as JsxElement;
    // Original source offsets survive the split — diagnostics stay precise.
    expect(src.slice(p.start, p.end)).toBe('<p>after</p>');
  });

  it('extracts meta pairs in authored order', () => {
    const split = splitHelmet(nodes('<Helmet><meta name="description" content="A doc" /><meta name="author" content="Ada" /></Helmet>'));
    expect(split.content.meta).toEqual([
      { name: 'description', content: 'A doc' },
      { name: 'author', content: 'Ada' },
    ]);
  });

  it('accepts a text (non-expression) title child', () => {
    const split = splitHelmet(nodes('<Helmet><title>Plain title</title></Helmet>'));
    expect(split.content.title).toBe('Plain title');
  });
});

describe('hoistHelmet', () => {
  it('moves a nested Helmet to the first top-level position', () => {
    const out = hoistHelmet(nodes('<div>' + FULL_HELMET + '<p>body</p></div>'));
    expect((out[0] as JsxElement).tag).toBe('Helmet');
    expect((out[1] as JsxElement).tag).toBe('div');
    const div = out[1] as JsxElement;
    expect(div.children.some((c) => c.type === 'element' && c.tag === 'Helmet')).toBe(false);
  });

  it('is a fixpoint: an already-first Helmet comes back structurally identical', () => {
    const tree = nodes(FULL_HELMET + '<div>body</div>');
    const once = hoistHelmet(tree);
    expect(hoistHelmet(once)).toEqual(once);
    expect((once[0] as JsxElement).tag).toBe('Helmet');
  });

  it('leaves helmet-less documents untouched', () => {
    const tree = nodes('<div><p>plain</p></div>');
    expect(hoistHelmet(tree)).toEqual(tree);
  });
});

// ── data declarations: <Value> and <Query> (lib/story/dataflow.ts) ──────────

const VALUE = '<Value name="region" type="string" />';
const QUERY = '<Query name="sales">{`select * from ref_abc123 where region = $region`}</Query>';

describe('validateHelmet — data declarations', () => {
  it('accepts <Value> and <Query> children, any number, with their attributes', () => {
    const src = '<Helmet><title>t</title>' + VALUE + '<Value name="n" type="number" default={1} />' + QUERY +
      '<Query name="top">{`select * from sales limit 5`}</Query></Helmet><div>body</div>';
    expect(validateHelmet(nodes(src))).toEqual([]);
  });

  it('reports a malformed <Value> with its span', () => {
    const src = '<Helmet><title>t</title><Value type="string" /></Helmet>';
    const errors = validateHelmet(nodes(src));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/name/);
    expect(errors[0].start).toBe(src.indexOf('<Value'));
    expect(errors[0].tag).toBe('Value');
  });

  it('reports a malformed <Query> with its span', () => {
    const src = '<Helmet><Query name="q">select 1</Query></Helmet>';
    const errors = validateHelmet(nodes(src));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/template-literal/i);
    expect(errors[0].tag).toBe('Query');
  });

  it('still rejects other Capitalized children, and the message names the full child set', () => {
    const errors = validateHelmet(nodes('<Helmet><Badge>x</Badge></Helmet>'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('<Value>');
    expect(errors[0].message).toContain('<Query>');
  });
});

describe('splitHelmet — data declarations', () => {
  it('extracts values and queries in authored order', () => {
    const { content } = splitHelmet(nodes('<Helmet>' + QUERY + VALUE + '</Helmet><p>x</p>'));
    expect(content.values.map((v) => v.name)).toEqual(['region']);
    expect(content.queries.map((q) => q.name)).toEqual(['sales']);
    expect(content.queries[0].params).toEqual(['region']);
    expect(content.queries[0].refs).toEqual(['abc123']);
  });

  it('yields empty declaration lists with no Helmet', () => {
    const { content } = splitHelmet(nodes('<p>x</p>'));
    expect(content.values).toEqual([]);
    expect(content.queries).toEqual([]);
  });
});

describe('hoistHelmet — data declarations', () => {
  it('keeps declarations through the hoist (a fixpoint)', () => {
    const src = '<div>' + '<Helmet>' + VALUE + QUERY + '</Helmet>' + '<p>x</p></div>';
    const hoisted = hoistHelmet(nodes(src));
    expect((hoisted[0] as JsxElement).tag).toBe('Helmet');
    const again = hoistHelmet(hoisted);
    expect(again).toEqual(hoisted);
    expect(splitHelmet(hoisted).content.queries[0].sql).toContain('ref_abc123');
  });
});
