/**
 * The comment half of lib/document's interface: where a comment points (range grammar, `rel` addresses, canonical
 * text), the anchor index over source, how a prose edit moves a comment (annotationEffects and its wire grammar),
 * and person mentions. Imported through the index, as callers outside the module do.
 */
import { describe, expect, it } from 'vitest';
import {
  anchorIndex, anchorKeyOf, annotationEffects, canonicalQuote, canonicalText, isPersonMentionHref, isTargetRange,
  parseAnnotationOperations, parseRel, personMentions, refinementRange, snippetOf, sourceWithoutAnchors,
  type AnnotationRange, type AnnotationRecord,
} from '..';
import { ANNOTATION_AREA_MIN_PX, findNearest, formatRel } from '../annotation-range';
import { personMention } from '../person-mentions';

const OP_ID = 'op-0123456789abcdef';
const textRange = (text: string, start: number) => ({ v: 1, parts: [{ rel: '', start, end: start + text.length, text }] });

describe('canonical text and quotes', () => {
  it('collapses every whitespace run, including unicode spaces, and trims the ends', () => {
    expect(canonicalText('  a\n\tb   c  ')).toBe('a b c');
    expect(canonicalText('a  b')).toBe('a b');
    expect(canonicalText('')).toBe('');
    expect(canonicalText(' \n ')).toBe('');
  });

  it('is idempotent', () => {
    const once = canonicalText('  héllo   wörld 👩‍💻 ');
    expect(canonicalText(once)).toBe(once);
  });

  it('caps a stored quote at 2000 canonical characters', () => {
    expect(canonicalQuote(' x '.repeat(3000))).toHaveLength(2000);
    expect(canonicalQuote('  short\nquote ')).toBe('short quote');
  });
});

describe('rel addresses', () => {
  it.each([
    ['', { sibling: 0, steps: [] }],
    ['0', { sibling: 0, steps: [0] }],
    ['0.2', { sibling: 0, steps: [0, 2] }],
    ['+1', { sibling: 1, steps: [] }],
    ['+1.2.3', { sibling: 1, steps: [2, 3] }],
  ])('parses %j and formats it back', (rel, address) => {
    expect(parseRel(rel)).toEqual(address);
    expect(formatRel(address)).toBe(rel);
  });

  it.each(['-1', '0.', '.0', '+', '+a', '1..2', 'a', '0.-1', '1 '])('refuses %j', (rel) => {
    expect(parseRel(rel)).toBeNull();
  });

  it('refuses a trailing dot after the sibling step, as it does after a child step', () => {
    expect(parseRel('+1.')).toBeNull();
  });

  it('refuses an address longer than 64 characters and a non-string', () => {
    expect(parseRel('1.'.repeat(32) + '1')).toBeNull();
    expect(parseRel(Array.from({ length: 32 }, () => '1').join('.'))).not.toBeNull();
    expect(parseRel(7 as unknown as string)).toBeNull();
  });

  it('formats +0 as the anchor itself', () => {
    expect(formatRel({ sibling: 0, steps: [] })).toBe('');
  });
});

describe('range kinds', () => {
  const text = textRange('hello', 0) as AnnotationRange;
  const area = { v: 1, kind: 'area', box: { x: 0, y: 0, w: 0.5, h: 0.5 } } as AnnotationRange;
  const target = { v: 1, kind: 'target', target: { kind: 'row', key: 'k' }, range: text } as unknown as AnnotationRange;

  it('isTargetRange answers only for a target range, and never throws on absence', () => {
    expect(isTargetRange(target)).toBe(true);
    expect(isTargetRange(text)).toBe(false);
    expect(isTargetRange(area)).toBe(false);
    expect(isTargetRange(null)).toBe(false);
    expect(isTargetRange(undefined)).toBe(false);
  });

  it('refinementRange unwraps a target to its inner range, and passes others through', () => {
    expect(refinementRange(target)).toBe(text);
    expect(refinementRange({ ...(target as object), range: undefined } as unknown as AnnotationRange)).toBeNull();
    expect(refinementRange(text)).toBe(text);
    expect(refinementRange(area)).toBe(area);
    expect(refinementRange(null)).toBeNull();
    expect(refinementRange(undefined)).toBeNull();
  });

  it('treats a drag under 6px in both directions as a click', () => {
    expect(ANNOTATION_AREA_MIN_PX).toBe(6);
  });
});

describe('findNearest', () => {
  it('picks the occurrence nearest the captured index', () => {
    expect(findNearest('ab ab ab', 'ab', 0)).toBe(0);
    expect(findNearest('ab ab ab', 'ab', 4)).toBe(3);
    expect(findNearest('ab ab ab', 'ab', 100)).toBe(6);
  });

  it('prefers the earlier one on a tie, and -1 for missing or empty text', () => {
    expect(findNearest('xx ab xx ab', 'ab', 6)).toBe(3);
    expect(findNearest('abc', 'z', 0)).toBe(-1);
    expect(findNearest('abc', '', 0)).toBe(-1);
  });

  it('finds overlapping occurrences', () => {
    expect(findNearest('aaaa', 'aa', 2)).toBe(2);
    expect(findNearest('aaaa', 'aa', 1)).toBe(1);
  });
});

describe('anchors', () => {
  const source = '<div id="outer"><p id="a">One</p><p>Two <b id="a">dup</b></p><span id={$x}>dyn</span></div>';

  it('indexes every element with a static id by key, with its source path; the first copy wins', () => {
    const index = anchorIndex(source);
    expect([...index.keys()]).toEqual(['outer', 'a']);
    expect(index.get('outer')?.path).toBe('0');
    expect(index.get('a')?.path).toBe('0.0');
    expect(index.get('a')?.node.tag).toBe('p');
    expect(index.get('a')?.siblings).toHaveLength(3);
  });

  it('answers an empty index for unparseable source', () => {
    expect(anchorIndex('<div><p>').size).toBe(0);
    expect(anchorIndex('').size).toBe(0);
  });

  it('anchorKeyOf reads only a static string id', () => {
    const index = anchorIndex(source);
    const outer = index.get('outer')!.node;
    expect(anchorKeyOf(outer)).toBe('outer');
    const dynamic = outer.children[2];
    expect(dynamic.type === 'element' && anchorKeyOf(dynamic)).toBeNull();
    const bare = outer.children[1];
    expect(bare.type === 'element' && anchorKeyOf(bare)).toBeNull();
  });

  it('strips every anchor attribute with its leading space, and nothing else', () => {
    const marked = '<div data-annotation-anchor="k1" id="x"><p data-annotation-anchor="k2">é &amp; 👩</p></div>';
    expect(sourceWithoutAnchors(marked)).toBe('<div id="x"><p>é &amp; 👩</p></div>');
    expect(sourceWithoutAnchors(sourceWithoutAnchors(marked))).toBe(sourceWithoutAnchors(marked));
    expect(sourceWithoutAnchors('<p id="x">clean</p>')).toBe('<p id="x">clean</p>');
  });

  it('hands unparseable markup back untouched', () => {
    const broken = '<div data-annotation-anchor="k"><p>';
    expect(sourceWithoutAnchors(broken)).toBe(broken);
  });

  it('snippetOf drops tags, collapses whitespace and caps at 200 characters', () => {
    expect(snippetOf('<p>Hello\n  <b>world</b></p>')).toBe('Hello world');
    expect(snippetOf('')).toBe('');
    expect(snippetOf(`<p>${'word '.repeat(100)}</p>`)).toHaveLength(200);
  });
});

describe('parseAnnotationOperations', () => {
  const map = { fromId: 'a', toId: 'b', fromText: 'one', toText: 'one', segments: [{ from: 0, to: 0, length: 3 }] };

  it('accepts the bounded grammar: map, undo and redo', () => {
    const ops = [{ id: OP_ID, kind: 'map', maps: [map] }, { id: OP_ID, kind: 'undo' }, { id: OP_ID, kind: 'redo' }];
    expect(parseAnnotationOperations(ops)).toBe(ops);
    expect(parseAnnotationOperations([])).toEqual([]);
  });

  it.each([
    ['not an array', { id: OP_ID, kind: 'undo' }],
    ['a short id', [{ id: 'short', kind: 'undo' }]],
    ['an id with punctuation', [{ id: 'op_0123456789abcdef!', kind: 'undo' }]],
    ['an unknown kind', [{ id: OP_ID, kind: 'delete' }]],
    ['a map without maps', [{ id: OP_ID, kind: 'map' }]],
    ['a map entry missing text', [{ id: OP_ID, kind: 'map', maps: [{ ...map, toText: undefined }] }]],
    ['a negative segment', [{ id: OP_ID, kind: 'map', maps: [{ ...map, segments: [{ from: -1, to: 0, length: 1 }] }] }]],
    ['a fractional segment', [{ id: OP_ID, kind: 'map', maps: [{ ...map, segments: [{ from: 0.5, to: 0, length: 1 }] }] }]],
    ['an overlong node id', [{ id: OP_ID, kind: 'map', maps: [{ ...map, fromId: 'x'.repeat(129) }] }]],
    ['null', null],
    ['a null entry', [null]],
  ])('refuses %s', (_label, value) => {
    expect(parseAnnotationOperations(value)).toBeNull();
  });

  it('refuses more than 64 operations, but accepts exactly 64', () => {
    const op = { id: OP_ID, kind: 'undo' };
    expect(parseAnnotationOperations(Array(64).fill(op))).not.toBeNull();
    expect(parseAnnotationOperations(Array(65).fill(op))).toBeNull();
  });
});

describe('annotationEffects', () => {
  const before = '<div><p id="a">hello world</p></div>';
  const after = '<div><p id="b">say hello world</p></div>';
  const range = JSON.stringify(textRange('world', 6));
  const rows: AnnotationRecord[] = [
    { id: 'n1', anchor_key: 'a', range },
    { id: 'n2', anchor_key: 'a', range: null },
    { id: 'n3', anchor_key: null, range: null },
  ];
  const mapOp = { id: OP_ID, kind: 'map' as const, maps: [{ fromId: 'a', toId: 'b', fromText: 'hello world', toText: 'say hello world', segments: [{ from: 0, to: 4, length: 11 }] }] };

  it('moves a text range through a map whose segment covers it, with a receipt', () => {
    const { updates, receipts } = annotationEffects(before, after, [mapOp], rows, []);
    expect(updates).toEqual([{ annotationId: 'n1', before: { anchor: 'a', range }, after: { anchor: 'b', range: JSON.stringify(textRange('world', 10)) } }]);
    expect(receipts.find((r) => r.annotationId === 'n1')).toMatchObject({ operationId: OP_ID, direction: 'map' });
  });

  it('moves nothing when the source text no longer matches what the map claims', () => {
    const stale = { ...mapOp, maps: [{ ...mapOp.maps[0], fromText: 'hello there' }] };
    expect(annotationEffects(before, after, [stale], rows, []).updates).toEqual([]);
  });

  it('moves nothing when the old anchor still exists after the edit', () => {
    const kept = '<div><p id="a">x</p><p id="b">say hello world</p></div>';
    expect(annotationEffects(before, kept, [mapOp], rows, []).updates).toEqual([]);
  });

  it('replays a map already saved from its receipt instead of re-deriving it (an idempotent retry)', () => {
    const saved = [{ operationId: OP_ID, direction: 'map' as const, annotationId: 'n1', before: { anchor: 'a', range }, after: { anchor: 'b', range: 'x' } }];
    expect(annotationEffects(before, after, [mapOp], rows, saved).updates).toEqual([{ annotationId: 'n1', before: { anchor: 'a', range }, after: { anchor: 'b', range: 'x' } }]);
    expect(annotationEffects(before, after, [mapOp], [{ id: 'n1', anchor_key: 'a', range: 'moved' }], saved).updates).toEqual([]);
  });

  it('skips an unparseable stored range', () => {
    expect(annotationEffects(before, after, [mapOp], [{ id: 'n1', anchor_key: 'a', range: '{not json' }], []).updates).toEqual([]);
  });

  it('undo and redo replay a saved receipt only from the state it expects', () => {
    const moved = JSON.stringify(textRange('world', 10));
    const receipt = { operationId: OP_ID, direction: 'map' as const, annotationId: 'n1', before: { anchor: 'a', range }, after: { anchor: 'b', range: moved } };
    const undo = annotationEffects(after, before, [{ id: OP_ID, kind: 'undo' }], [{ id: 'n1', anchor_key: 'b', range: moved }], [receipt]);
    expect(undo.updates).toEqual([{ annotationId: 'n1', before: { anchor: 'b', range: moved }, after: { anchor: 'a', range } }]);
    const redo = annotationEffects(before, after, [{ id: OP_ID, kind: 'redo' }], [{ id: 'n1', anchor_key: 'a', range }], [receipt]);
    expect(redo.updates[0]?.after).toEqual({ anchor: 'b', range: moved });
    expect(annotationEffects(after, before, [{ id: OP_ID, kind: 'undo' }], [{ id: 'n1', anchor_key: 'b', range: 'other' }], [receipt]).updates).toEqual([]);
  });

  it('answers nothing for no operations', () => {
    expect(annotationEffects(before, after, [], rows, [])).toEqual({ updates: [], receipts: [] });
  });
});

describe('person mentions', () => {
  it('writes the one mention spelling and reads it back', () => {
    const text = `Hi ${personMention({ user_id: 'u_123', username: 'ada' })} and [@bob](/people/U-9)`;
    expect(text).toContain('[@ada](/people/u_123)');
    expect([...personMentions(text)].map((m) => [m[1], m[2]])).toEqual([['@ada', 'u_123'], ['@bob', 'U-9']]);
  });

  it('reads no mention from a lookalike', () => {
    expect([...personMentions('[@a b](/people/x) [ada](/people/x) [@ada](/people/)')]).toEqual([]);
    expect([...personMentions('')]).toEqual([]);
  });

  it('recognises exactly a /people/<id> href', () => {
    expect(isPersonMentionHref('/people/u_1-A')).toBe(true);
    expect(isPersonMentionHref(`/people/${'x'.repeat(128)}`)).toBe(true);
    for (const href of [`/people/${'x'.repeat(129)}`, '/people/', '/people/a/b', 'https://x/people/a', '/people/a?x=1', '/people/é']) {
      expect(isPersonMentionHref(href), href).toBe(false);
    }
  });
});
