/**
 * composeSource — the no-clobber invariant, one process away from where it used to live.
 *
 * The frame stages edits and the parent folds them in. The rule that matters:
 * a commit re-applies the WHOLE pending set against the current source, so a
 * text edit never re-derives the source without the formats applied since, and
 * a format never discards typing. Getting this wrong loses the user's work
 * silently, which is the worst way to lose it.
 */
import { describe, it, expect } from 'vitest';
import { bodyPathToSourcePath, composeSource, hasPendingEdits, helmetOffset, NO_PENDING_EDITS, type PendingEdits } from '../edit-compose';
import { parseJsx } from '@/lib/jsx';

const SRC = '<div className="p-4"><h1 className="t">Title</h1><p className="lede">hello</p></div>';
const pending = (over: Partial<PendingEdits> = {}): PendingEdits => ({ ...NO_PENDING_EDITS, ...over });

describe('composeSource', () => {
  it('writes an edited host\'s content into the source', () => {
    const out = composeSource(SRC, pending({ text: new Map([['0.1', 'goodbye']]) }));
    expect(out).toContain('<p className="lede">goodbye</p>');
    expect(out).toContain('<h1 className="t">Title</h1>');
  });

  it('writes a format edit', () => {
    const out = composeSource(SRC, pending({ format: new Map([['0.0', { className: 'text-5xl' }]]) }));
    expect(out).toContain('<h1 className="text-5xl">Title</h1>');
  });

  it('COMPOSES text and format on the same node — neither discards the other', () => {
    const out = composeSource(SRC, pending({
      text: new Map([['0.1', 'edited text']]),
      format: new Map([['0.1', { className: 'lede text-xl' }]]),
    }));
    expect(out).toContain('className="lede text-xl"');
    expect(out).toContain('edited text');
  });

  it('composes edits to DIFFERENT nodes', () => {
    const out = composeSource(SRC, pending({
      text: new Map([['0.0', 'New title'], ['0.1', 'New body']]),
      format: new Map([['0.0', { style: 'color: red' }]]),
    }));
    expect(out).toContain('New title');
    expect(out).toContain('New body');
    expect(out).toContain('style="color: red"');
  });

  it('is the identity when nothing is pending', () => {
    expect(composeSource(SRC, NO_PENDING_EDITS)).toBe(SRC);
  });

  it('SANITIZES what a contenteditable produced — a paste gets no editor trust', () => {
    const out = composeSource(SRC, pending({
      text: new Map([['0.1', 'safe<script>alert(1)</script><b onclick="x()">bold</b>']]),
    }));
    expect(out).not.toMatch(/<script|onclick/i);
    expect(out).toContain('safe');
    expect(out).toContain('bold');
  });

  it('drops a stale path rather than corrupting the body', () => {
    const out = composeSource(SRC, pending({ text: new Map([['9.9', 'nowhere']]) }));
    expect(out).not.toContain('nowhere');
    expect(out).toContain('hello');
  });

  it('returns the source unchanged when it does not parse', () => {
    const broken = '<div><p>unclosed';
    expect(composeSource(broken, pending({ text: new Map([['0.0', 'x']]) }))).toBe(broken);
  });

  it('removes an attribute when the format edit is empty', () => {
    const out = composeSource(SRC, pending({ format: new Map([['0.0', { className: '' }]]) }));
    expect(out).toContain('<h1>Title</h1>');
  });

  it('never lets a component be text-edited — its DOM is render chrome', () => {
    const withEmbed = '<div className="p-4"><Question data="$q" /></div>';
    const out = composeSource(withEmbed, pending({ text: new Map([['0.0', 'not source']]) }));
    expect(out).not.toContain('not source');
    expect(out).toContain('<Question data="$q" />');
  });

  it('applies a layout rect to a GridItem', () => {
    const grid = '<div><Grid><GridItem x={0} y={0} w={2} h={2}><p>cell</p></GridItem></Grid></div>';
    const out = composeSource(grid, pending({ layout: new Map([['0.0.0', { x: 3, y: 1, w: 4, h: 5 }]]) }));
    expect(out).toMatch(/x=\{3\}/);
    expect(out).toMatch(/w=\{4\}/);
  });
});

describe('hasPendingEdits', () => {
  it('is false only when every kind is empty', () => {
    expect(hasPendingEdits(NO_PENDING_EDITS)).toBe(false);
    expect(hasPendingEdits(pending({ text: new Map([['0.1', 'x']]) }))).toBe(true);
    expect(hasPendingEdits(pending({ format: new Map([['0.1', {}]]) }))).toBe(true);
    expect(hasPendingEdits(pending({ layout: new Map([['0.1', { x: 0, y: 0, w: 1, h: 1 }]]) }))).toBe(true);
  });
});


/**
 * THE OFF-BY-ONE THAT ONLY BITES DOCUMENTS WITH DATA.
 *
 * The document renders the BODY — the Helmet is split off before anything is
 * stamped — so every path it reports is body-relative. The source is not.
 * A document of pure prose has no Helmet, works perfectly, and hides this
 * completely; the first document with a <Value> edits the wrong element.
 */
const HELMET = '<Helmet><Value name="rows" type="table" value={[]} /></Helmet>';
const BODY = '<div className="p-4"><h1>Title</h1><p className="lede">hello</p></div>';

describe('body paths versus source paths', () => {
  it('knows when a source begins with a Helmet', () => {
    const nodesOf = (src: string) => { const p = parseJsx(src); if (!p.ok) throw new Error('bad fixture'); return p.nodes; };
    expect(helmetOffset(nodesOf(HELMET + BODY))).toBe(1);
    expect(helmetOffset(nodesOf(BODY))).toBe(0);
  });

  it('shifts only the FIRST index, and only when there is a Helmet', () => {
    expect(bodyPathToSourcePath(HELMET + BODY, '0.1')).toBe('1.1');
    expect(bodyPathToSourcePath(HELMET + BODY, '0')).toBe('1');
    expect(bodyPathToSourcePath(BODY, '0.1')).toBe('0.1');
  });

  it('leaves a nonsense path alone rather than inventing one', () => {
    expect(bodyPathToSourcePath(HELMET + BODY, 'nope')).toBe('nope');
    expect(bodyPathToSourcePath('<div><p>unclosed', '0.1')).toBe('0.1');
  });

  it('EDITS THE RIGHT ELEMENT in a document that declares data', () => {
    // '0.1' is the <p> in the body; in the source that is '1.1'.
    const out = composeSource(HELMET + BODY, pending({ text: new Map([['0.1', 'goodbye']]) }));
    expect(out).toContain('<p className="lede">goodbye</p>');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<Value name="rows"');
  });

  it('formats the right element in a document that declares data', () => {
    const out = composeSource(HELMET + BODY, pending({ format: new Map([['0.0', { className: 'text-5xl' }]]) }));
    expect(out).toContain('<h1 className="text-5xl">Title</h1>');
  });
});
