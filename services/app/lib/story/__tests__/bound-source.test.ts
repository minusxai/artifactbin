/**
 * BOUND IMAGE SOURCES — the grammar half (lib/story/dataflow.ts).
 *
 * `<img src="$pick">` is a scalar reference like any other, and an image `src`
 * is the ONE position that also reads a reference inside the string
 * (`https://cdn.x.com/{$pick}.png`). Everything here is pure: what counts as a
 * reference, what a use collects, and what resolving one against the
 * document's values yields — the last of which is shared between the runtime
 * and its own server render, so it has to be a function, not a behaviour.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import {
  carriesRef, collectRefNameUses, isTemplateRefPosition, REF_ATTRS, resolveRefTemplate, templateRefNames,
  validateDataflow, type Dataflow, type Scalar,
} from '@/lib/story/dataflow';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`test source failed to parse: ${parsed.error}`);
  return parsed.nodes;
};

const flow = (names: string[]): Dataflow => ({
  values: names.map((name) => ({ kind: 'scalar', name, type: 'string', default: null, start: 0, end: 0 })),
  queries: [],
});

const uses = (source: string) => collectRefNameUses(nodes(source));

describe('src is a bindable scalar position', () => {
  it('declares img.src in the reference table', () => {
    expect(REF_ATTRS.html.img).toEqual({ src: 'scalar' });
  });

  it('collects a whole-attribute binding on an image', () => {
    expect(uses('<img src="$pick" alt="a" />')).toEqual([
      expect.objectContaining({ name: 'pick', tag: 'img', attr: 'src', expects: 'scalar' }),
    ]);
  });

  it('a declared binding validates and an undeclared one is a named refusal', () => {
    expect(validateDataflow(flow(['pick']), uses('<img src="$pick" />'))).toEqual([]);
    const errors = validateDataflow(flow(['pick']), uses('<img src="$nope" />'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('$nope');
  });

  it('a table bound to an image src is the wrong kind', () => {
    const withTable: Dataflow = { values: [{ kind: 'table', name: 'rows', rows: [], columns: [], start: 0, end: 0 }], queries: [] };
    const errors = validateDataflow(withTable, uses('<img src="$rows" />'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('rows');
  });
});

describe('the braced form, image src only', () => {
  it('reads every {$name} inside the string', () => {
    expect(templateRefNames('https://cdn.x.com/{$pick}/{$size}.png')).toEqual(['pick', 'size']);
    expect(templateRefNames('https://cdn.x.com/{$pick}-{$pick}.png')).toEqual(['pick']);
  });

  it('collects them as scalar uses on an image src', () => {
    expect(uses('<img src="https://cdn.x.com/{$pick}.png" />')).toEqual([
      expect.objectContaining({ name: 'pick', attr: 'src', expects: 'scalar' }),
    ]);
    expect(validateDataflow(flow(['pick']), uses('<img src="https://cdn.x.com/{$pick}.png" />'))).toEqual([]);
    expect(validateDataflow(flow(['pick']), uses('<img src="https://cdn.x.com/{$nope}.png" />'))).toHaveLength(1);
  });

  it('is read NOWHERE else — the whole-attribute rule is the general one', () => {
    expect(isTemplateRefPosition('img', 'src', false)).toBe(true);
    expect(isTemplateRefPosition('IMG', 'SRC', false)).toBe(true);
    expect(isTemplateRefPosition('img', 'alt', false)).toBe(false);
    expect(isTemplateRefPosition('input', 'value', false)).toBe(false);
    expect(isTemplateRefPosition('Number', 'format', true)).toBe(false);
    // The rule this narrowness exists to protect.
    expect(uses('<Number data="$q" format="$,.0f" />').map((u) => u.attr)).toEqual(['data']);
    expect(carriesRef('$,.0f')).toBe(false);
    expect(carriesRef('$5 a month')).toBe(false);
  });

  it('carriesRef tells a binding from a literal URL', () => {
    expect(carriesRef('$pick')).toBe(true);
    expect(carriesRef('https://cdn.x.com/{$pick}.png')).toBe(true);
    expect(carriesRef('https://cdn.x.com/fixed.png')).toBe(false);
    expect(carriesRef('ref:abc123')).toBe(false);
  });
});

describe('resolveRefTemplate — the one function both ends render from', () => {
  const get = (values: Record<string, Scalar>) => (name: string) => values[name];

  it('yields the value itself for the whole-attribute form', () => {
    expect(resolveRefTemplate('$pick', get({ pick: 'https://a/b.png' }))).toBe('https://a/b.png');
  });

  it('substitutes every reference in the braced form', () => {
    expect(resolveRefTemplate('https://cdn.x.com/{$pick}.png', get({ pick: 'cat' }))).toBe('https://cdn.x.com/cat.png');
    expect(resolveRefTemplate('https://cdn.x.com/{$a}/{$b}.png', get({ a: '1', b: '2' }))).toBe('https://cdn.x.com/1/2.png');
  });

  it('is null when a referenced value is missing, null or empty — a URL with a hole is not a URL', () => {
    expect(resolveRefTemplate('$pick', get({}))).toBeNull();
    expect(resolveRefTemplate('$pick', get({ pick: null }))).toBeNull();
    expect(resolveRefTemplate('$pick', get({ pick: '' }))).toBeNull();
    expect(resolveRefTemplate('https://cdn.x.com/{$pick}.png', get({}))).toBeNull();
  });

  it('leaves a string carrying no reference exactly as it is', () => {
    expect(resolveRefTemplate('https://cdn.x.com/fixed.png', get({}))).toBe('https://cdn.x.com/fixed.png');
  });
});
