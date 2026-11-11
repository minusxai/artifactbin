/**
 * The comment half of lib/document's interface: where a comment points (range grammar, `rel` addresses, canonical
 * text), the anchor index over source, how a prose edit moves a comment (annotationEffects and its wire grammar),
 * and person mentions. Imported through the index, as callers outside the module do.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalQuote, canonicalText, isPersonMentionHref, isTargetRange,
  parseRel, personMentions, refinementRange,
  type AnnotationRange,
} from '..';
import { personMention, personMentionId } from '../person-mentions';

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
  ])('parses %j', (rel, address) => {
    expect(parseRel(rel)).toEqual(address);
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
});

describe('person mentions', () => {
  it('writes the one mention spelling, and reads it back beside the stored old form', () => {
    const text = `Hi ${personMention({ user_id: 'u_123', username: 'ada' })} and [@bob](/people/U-9)`;
    expect(text).toContain('[@ada](/api/people/u_123)');
    expect([...personMentions(text)].map((m) => [m[1], m[2]])).toEqual([['@ada', 'u_123'], ['@bob', 'U-9']]);
  });

  it('reads no mention from a lookalike', () => {
    expect([...personMentions('[@a b](/people/x) [ada](/people/x) [@ada](/people/)')]).toEqual([]);
    expect([...personMentions('')]).toEqual([]);
  });

  it('recognises exactly an /api/people/<id> href, or the stored /people/<id> form', () => {
    expect(isPersonMentionHref('/api/people/u_1-A')).toBe(true);
    expect(personMentionId('/api/people/u_1-A')).toBe('u_1-A');
    expect(personMentionId('/people/u_1-A')).toBe('u_1-A');
    expect(isPersonMentionHref('/api/api/people/a')).toBe(false);
    expect(isPersonMentionHref('/people/u_1-A')).toBe(true);
    expect(isPersonMentionHref(`/people/${'x'.repeat(128)}`)).toBe(true);
    for (const href of [`/people/${'x'.repeat(129)}`, '/people/', '/people/a/b', 'https://x/people/a', '/people/a?x=1', '/people/é']) {
      expect(isPersonMentionHref(href), href).toBe(false);
    }
  });
});
