/**
 * `applyFormatEditsToJsx` — the typography toolbar's write-back. It touches
 * exactly two attributes, className and style, on plain HTML elements; a
 * component, a stale path, a text node or unparseable source all come back
 * unchanged rather than throwing, and a legacy `class` is healed rather than
 * duplicated.
 */
import { describe, it, expect } from 'vitest';

import { applyDomEditsToJsx, applyFormatEditsToJsx } from '@/lib/data/story/jsx-edit';
import { expectValidStoryJsx } from '@/test/helpers/jsx';

describe('applyFormatEditsToJsx — className/style attr write-back (typography toolbar)', () => {
  it('sets className on a plain HTML element that had none', () => {
    const src = '<div><p>Hello</p></div>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-2xl font-bold' }]);
    expect(out).toBe('<div><p className="text-2xl font-bold">Hello</p></div>');
    expectValidStoryJsx(out);
  });

  it('replaces an existing className in place', () => {
    const src = '<div className="p-8"><h2 className="text-xl mt-4">Head</h2></div>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-3xl mt-4' }]);
    expect(out).toBe('<div className="p-8"><h2 className="text-3xl mt-4">Head</h2></div>');
    expectValidStoryJsx(out);
  });

  it('an empty className removes the attribute', () => {
    const src = '<p className="text-xl">x</p>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', className: '  ' }])).toBe('<p>x</p>');
  });

  it('applies multiple edits in one pass', () => {
    const src = '<div><p>a</p><p>b</p></div>';
    const out = applyFormatEditsToJsx(src, [
      { astPath: '0.0', className: 'text-sm' },
      { astPath: '0.1', className: 'text-lg' },
    ]);
    expect(out).toBe('<div><p className="text-sm">a</p><p className="text-lg">b</p></div>');
  });

  it('skips components, stale paths and text nodes — source comes back unchanged', () => {
    const src = '<div><Card>x</Card>text</div>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-xl' }])).toBe(src);
    expect(applyFormatEditsToJsx(src, [{ astPath: '9.9', className: 'text-xl' }])).toBe(src);
    expect(applyFormatEditsToJsx(src, [{ astPath: '0.1', className: 'text-xl' }])).toBe(src);
  });

  it('returns unparseable source unchanged (never throws)', () => {
    const src = '<div><p>broken';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-xl' }])).toBe(src);
  });

  it('sets an inline style string (color picker) without touching className', () => {
    const src = '<p className="text-xl">x</p>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0', style: 'color: rgb(255, 0, 0);' }]);
    expect(out).toBe('<p className="text-xl" style="color: rgb(255, 0, 0);">x</p>');
    expectValidStoryJsx(out);
  });

  it('an empty style removes the attribute; className edits compose in the same call', () => {
    const src = '<p className="a" style="color: red">x</p>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', style: '' }])).toBe('<p className="a">x</p>');
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', className: 'b', style: 'color: blue' }]))
      .toBe('<p className="b" style="color: blue">x</p>');
  });

  it('an edit with neither field applies nothing', () => {
    const src = '<p className="a">x</p>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0' }])).toBe(src);
  });

  it('replaces a legacy `class` attribute in place — never a duplicate className', () => {
    const src = '<h1 class="text-5xl font-bold">x</h1>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0', className: 'text-lg font-bold' }]);
    expect(out).toBe('<h1 className="text-lg font-bold">x</h1>');
    expectValidStoryJsx(out);
  });

  it('heals an element carrying BOTH class and className to a single className', () => {
    const src = '<h1 class="a" className="b">x</h1>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', className: 'c' }])).toBe('<h1 className="c">x</h1>');
  });

  it('composes with applyDomEditsToJsx — text edit then class edit on the same host', () => {
    const src = '<div><p className="text-base">Hello</p></div>';
    const afterText = applyDomEditsToJsx(src, [{ astPath: '0.0', innerHtml: 'Goodbye <strong>all</strong>' }]).source;
    const out = applyFormatEditsToJsx(afterText, [{ astPath: '0.0', className: 'text-2xl' }]);
    expect(out).toBe('<div><p className="text-2xl">Goodbye <strong>all</strong></p></div>');
    expectValidStoryJsx(out);
  });
});
