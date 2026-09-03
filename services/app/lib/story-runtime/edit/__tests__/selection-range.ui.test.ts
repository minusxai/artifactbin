/**
 * F3 — describing a text selection relative to its anchor (SEEDED RED by the orchestrator).
 *
 * The frame holds the real Range and used to throw it away, keeping only the deeper
 * endpoint element. `anchorFor` picks the block that contains the whole selection;
 * `describeRange` turns the Range into a quote plus parts addressed from that anchor;
 * `resolveParts` does the reverse on a later DOM, re-finding each part's text with the
 * stored index as a hint only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { anchorFor, describeRange, resolveParts } from '../selection-range';

const textNode = (el: Element): Text => {
  const found = Array.from(el.childNodes).find((n): n is Text => n.nodeType === Node.TEXT_NODE);
  if (!found) throw new Error('no text node');
  return found;
};

describe('anchorFor: the block containing the whole selection', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div data-mx-ast="0">'
      + '<p data-mx-ast="0.12"><strong data-mx-ast="0.12.0">Open decisions for you.</strong> (1) Should Fork appear for non-markup artifacts? They always get the shell, so it is one predicate.</p>'
      + '<p data-mx-ast="0.13">Tests. RED first: the fork test and the gate.</p>'
      + '</div>';
  });

  it('a selection inside one inline element still anchors on its paragraph, not the inline', () => {
    const strong = document.querySelector('strong')!;
    const range = document.createRange();
    range.setStart(textNode(strong), 5);
    range.setEnd(textNode(strong), 14);
    expect(anchorFor(range)?.getAttribute('data-mx-ast')).toBe('0.12');
  });

  it('a selection from the inline into the paragraph text anchors on the paragraph', () => {
    const p = document.querySelector('[data-mx-ast="0.12"]')!;
    const range = document.createRange();
    range.setStart(textNode(p.querySelector('strong')!), 5);
    range.setEnd(textNode(p), 45);
    expect(anchorFor(range)?.getAttribute('data-mx-ast')).toBe('0.12');
  });

  it('a selection across two paragraphs anchors on the FIRST covered block', () => {
    const p1 = document.querySelector('[data-mx-ast="0.12"]')!;
    const p2 = document.querySelector('[data-mx-ast="0.13"]')!;
    const range = document.createRange();
    range.setStart(textNode(p1), 30);
    range.setEnd(textNode(p2), 12);
    expect(anchorFor(range)?.getAttribute('data-mx-ast')).toBe('0.12');
  });
});

describe('describeRange: quote plus anchor-relative parts', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div data-mx-ast="0">'
      + '<p data-mx-ast="0.12"><strong data-mx-ast="0.12.0">Open decisions for you.</strong> (1) Should Fork appear for non-markup artifacts? They always get the shell, so it is one predicate.</p>'
      + '<p data-mx-ast="0.13">Tests. RED first: the fork test and the gate.</p>'
      + '</div>';
  });

  it('inline into paragraph: part 0 in child "0", part 1 in the anchor itself, indices into visible text', () => {
    const p = document.querySelector('[data-mx-ast="0.12"]')!;
    const strong = p.querySelector('strong')!;
    const range = document.createRange();
    range.setStart(textNode(strong), 5); // "decisions for you."
    range.setEnd(textNode(p), 48); // " (1) Should Fork appear for non-markup artifacts"
    const described = describeRange(range, p);
    // Parts in the SAME block concatenate as they are (the space is part of the second run).
    expect(described.quote).toBe('decisions for you. (1) Should Fork appear for non-markup artifacts');
    expect(described.range.v).toBe(1);
    expect(described.range.parts).toEqual([
      { rel: '0', start: 5, end: 23, text: 'decisions for you.' },
      // The paragraph's visible text begins with the bold run (23 chars), so its own
      // run starts at index 23; `text` is exactly canonical.slice(start, end).
      { rel: '', start: 23, end: 71, text: ' (1) Should Fork appear for non-markup artifacts' },
    ]);
  });

  it('paragraph into paragraph: part 0 in the anchor, part 1 in its next sibling ("+1")', () => {
    const p1 = document.querySelector('[data-mx-ast="0.12"]')!;
    const p2 = document.querySelector('[data-mx-ast="0.13"]')!;
    const range = document.createRange();
    range.setStart(textNode(p1), 77); // "so it is one predicate."
    range.setEnd(textNode(p2), 6); // "Tests."
    const described = describeRange(range, p1);
    // Parts in DIFFERENT blocks are joined by one space.
    expect(described.quote).toBe('so it is one predicate. Tests.');
    expect(described.range.parts).toEqual([
      { rel: '', start: 100, end: 123, text: 'so it is one predicate.' },
      { rel: '+1', start: 0, end: 6, text: 'Tests.' },
    ]);
  });

  it('whitespace is canonical: runs of spaces and newlines in the DOM collapse to one space in quote and indices', () => {
    document.body.innerHTML = '<p data-mx-ast="0">Hello,\n   wide   world</p>';
    const p = document.querySelector('p')!;
    const range = document.createRange();
    range.setStart(textNode(p), 0);
    range.setEnd(textNode(p), textNode(p).length);
    const described = describeRange(range, p);
    expect(described.quote).toBe('Hello, wide world');
    expect(described.range.parts).toEqual([{ rel: '', start: 0, end: 17, text: 'Hello, wide world' }]);
  });
});

describe('resolveParts: re-finding the text on a later DOM', () => {
  it('finds each part by TEXT when the stored index is stale, and returns one Range per found part', () => {
    document.body.innerHTML =
      '<div data-mx-ast="0">'
      + '<p data-mx-ast="0.12" data-annotation-anchor="k1">A brand new opener was inserted. <strong>Open decisions for you.</strong> (1) Should Fork appear?</p>'
      + '<p data-mx-ast="0.13">Tests. RED first.</p>'
      + '</div>';
    const anchor = document.querySelector('[data-annotation-anchor="k1"]')!;
    // Child steps count ELEMENT children, so the strong is still child 0 despite the new text before it.
    const ranges = resolveParts(anchor, [
      { rel: '0', start: 5, end: 23, text: 'decisions for you.' },
      { rel: '', start: 23, end: 45, text: '(1) Should Fork appear' }, // index stale: the text moved right
      { rel: '+1', start: 0, end: 6, text: 'Tests.' },
    ]);
    expect(ranges.map((r) => r.toString())).toEqual(['decisions for you.', '(1) Should Fork appear', 'Tests.']);
  });

  it('skips a part whose text is gone and reports nothing when none is found', () => {
    document.body.innerHTML = '<p data-mx-ast="0" data-annotation-anchor="k1">Entirely different words now.</p>';
    const anchor = document.querySelector('[data-annotation-anchor="k1"]')!;
    expect(resolveParts(anchor, [{ rel: '', start: 0, end: 4, text: 'gone' }])).toEqual([]);
    const partial = resolveParts(anchor, [
      { rel: '', start: 0, end: 4, text: 'gone' },
      { rel: '', start: 9, end: 18, text: 'different' },
    ]);
    expect(partial.map((r) => r.toString())).toEqual(['different']);
  });

  it('prefers the occurrence nearest the stored index when the text appears twice', () => {
    document.body.innerHTML = '<p data-mx-ast="0" data-annotation-anchor="k1">yes and no, then yes and no again</p>';
    const anchor = document.querySelector('[data-annotation-anchor="k1"]')!;
    const [range] = resolveParts(anchor, [{ rel: '', start: 17, end: 27, text: 'yes and no' }]);
    expect(range.startOffset).toBe(17);
  });
});
