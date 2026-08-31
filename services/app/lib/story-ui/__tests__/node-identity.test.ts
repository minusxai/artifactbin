/**
 * Node identity across re-parses (lib/story-ui/node-identity).
 *
 * The property under test is always the same one: after an edit, a node that
 * is still the same node keeps the key it had — so React updates it instead of
 * remounting it. Everything else here is the ways that can go wrong.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { assignNodeKeys, type KeyedTree } from '../node-identity';

const parse = (src: string): JsxNode[] => {
  const r = parseJsx(src);
  if (!r.ok) throw new Error(r.error);
  return r.nodes as JsxNode[];
};

/** Key the tree, then key a successor against it — the real usage. */
const step = (src: string, prev?: KeyedTree | null): KeyedTree => {
  const nodes = parse(src);
  return { nodes, keys: assignNodeKeys(nodes, prev ?? null) };
};

/** Every path in a tree, pre-order, in the interpreter's own scheme. */
function paths(nodes: JsxNode[], base = ''): string[] {
  const out: string[] = [];
  nodes.forEach((n, i) => {
    const p = base === '' ? String(i) : `${base}.${i}`;
    out.push(p);
    if (n.type === 'element') out.push(...paths(n.children, p));
  });
  return out;
}

const DOC = '<div><h1>Head</h1><p>alpha</p><p>beta</p><Question data="$q" /><p>gamma</p></div>';

describe('assignNodeKeys — first generation', () => {
  it('is deterministic: the same tree twice gives the same keys (SSR must equal hydration)', () => {
    const a = step(DOC);
    const b = step(DOC);
    for (const p of paths(a.nodes)) expect(b.keys.keyFor(p)).toBe(a.keys.keyFor(p));
  });

  it('gives every sibling a distinct key (React requires it within a list)', () => {
    const t = step(DOC);
    const kids = paths(t.nodes).filter((p) => /^0\.\d+$/.test(p)).map((p) => t.keys.keyFor(p));
    expect(new Set(kids).size).toBe(kids.length);
  });

  it('falls back to the path for a node it was never told about', () => {
    const t = step(DOC);
    expect(t.keys.keyFor('9.9.9')).toBe('9.9.9');
  });
});

describe('assignNodeKeys — what must survive an edit', () => {
  it('an unchanged tree keeps every key', () => {
    const one = step(DOC);
    const two = step(DOC, one);
    for (const p of paths(one.nodes)) expect(two.keys.keyFor(p)).toBe(one.keys.keyFor(p));
  });

  it('a TEXT change keeps every element key, including the edited one', () => {
    const one = step(DOC);
    const two = step(DOC.replace('alpha', 'ALPHA REWRITTEN'), one);
    for (const p of ['0', '0.0', '0.1', '0.2', '0.3', '0.4']) {
      expect(two.keys.keyFor(p)).toBe(one.keys.keyFor(p));
    }
  });

  it('DELETING a sibling keeps the keys of everything after it (the whole point)', () => {
    const one = step(DOC);
    const before = { question: one.keys.keyFor('0.3'), gamma: one.keys.keyFor('0.4') };
    // remove <p>beta</p> — every following sibling renumbers
    const two = step(DOC.replace('<p>beta</p>', ''), one);
    expect(two.keys.keyFor('0.2')).toBe(before.question); // Question moved 0.3 → 0.2
    expect(two.keys.keyFor('0.3')).toBe(before.gamma);    // gamma  moved 0.4 → 0.3
  });

  it('INSERTING a sibling keeps existing keys and mints a distinct one for the arrival', () => {
    const one = step(DOC);
    const question = one.keys.keyFor('0.3');
    const two = step(DOC.replace('<p>beta</p>', '<p>beta</p><p>inserted</p>'), one);
    expect(two.keys.keyFor('0.4')).toBe(question);        // Question moved 0.3 → 0.4
    const fresh = two.keys.keyFor('0.3');                 // the new paragraph
    const siblings = ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5'].map((p) => two.keys.keyFor(p));
    expect(new Set(siblings).size).toBe(siblings.length);
    expect(fresh).not.toBe(question);
  });

  it('a node REPLACED by a different tag gets a new key; its siblings keep theirs', () => {
    const one = step(DOC);
    const head = one.keys.keyFor('0.0');
    const gamma = one.keys.keyFor('0.4');
    const two = step(DOC.replace('<Question data="$q" />', '<Number data="$q" />'), one);
    expect(two.keys.keyFor('0.0')).toBe(head);
    expect(two.keys.keyFor('0.4')).toBe(gamma);
    expect(two.keys.keyFor('0.3')).not.toBe(one.keys.keyFor('0.3'));
  });

  it('never matches one component tag to another', () => {
    const one = step('<div><Question data="$a" /></div>');
    const two = step('<div><Number data="$a" /></div>', one);
    expect(two.keys.keyFor('0.0')).not.toBe(one.keys.keyFor('0.0'));
  });

  it('carries identity through NESTED edits: an ancestor keeps its key when a child changes', () => {
    const src = '<div><section><h2>Title</h2><p>one</p><p>two</p></section><Question data="$q" /></div>';
    const one = step(src);
    const two = step(src.replace('<p>one</p>', ''), one);
    expect(two.keys.keyFor('0')).toBe(one.keys.keyFor('0'));         // div
    expect(two.keys.keyFor('0.0')).toBe(one.keys.keyFor('0.0'));     // section
    expect(two.keys.keyFor('0.0.1')).toBe(one.keys.keyFor('0.0.2')); // <p>two</p> moved up
    expect(two.keys.keyFor('0.1')).toBe(one.keys.keyFor('0.1'));     // Question, untouched
  });

  it('stays stable over MANY generations of edits', () => {
    let t = step(DOC);
    const question = t.keys.keyFor('0.3');
    t = step(DOC.replace('<p>beta</p>', ''), t);          // delete → Question at 0.2
    t = step(DOC.replace('<p>beta</p>', '').replace('alpha', 'a2'), t);
    t = step(DOC.replace('<p>beta</p>', '').replace('alpha', 'a3'), t);
    expect(t.keys.keyFor('0.2')).toBe(question);
  });

  it('a fresh key can never collide with an inherited one', () => {
    let t = step('<div><p>a</p></div>');
    const seen = new Set<string>([t.keys.keyFor('0.0')]);
    for (let i = 0; i < 5; i++) {
      const body = Array.from({ length: i + 2 }, (_, n) => `<p>p${n}</p>`).join('');
      t = step(`<div>${body}</div>`, t);
      const kids = Array.from({ length: i + 2 }, (_, n) => t.keys.keyFor(`0.${n}`));
      expect(new Set(kids).size).toBe(kids.length);
      kids.forEach((k) => seen.add(k));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('handles a reorder without ever producing duplicate keys', () => {
    const one = step('<div><p>a</p><h2>b</h2><Question data="$q" /></div>');
    const two = step('<div><Question data="$q" /><h2>b</h2><p>a</p></div>', one);
    const kids = ['0.0', '0.1', '0.2'].map((p) => two.keys.keyFor(p));
    expect(new Set(kids).size).toBe(3);
    expect(two.keys.keyFor('0.1')).toBe(one.keys.keyFor('0.1')); // the h2 held its place
  });

  it('survives empty and text-only trees', () => {
    const empty = step('<div></div>');
    expect(() => step('<div></div>', empty)).not.toThrow();
    const text = step('<div>just words</div>');
    const text2 = step('<div>other words</div>', text);
    expect(text2.keys.keyFor('0')).toBe(text.keys.keyFor('0'));
  });

  it('aligns a document whose whole body was replaced without reusing a single key', () => {
    const one = step('<div><h1>A</h1><p>a</p></div>');
    const two = step('<article><span>x</span></article>', one);
    expect(two.keys.keyFor('0')).not.toBe(one.keys.keyFor('0'));
  });
});
