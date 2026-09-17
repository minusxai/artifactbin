import { displayTitle, firstHeadingTitle, UNTITLED } from '../title';

describe('firstHeadingTitle', () => {
  it('reads the first heading of a story-JSX source', () => {
    expect(firstHeadingTitle('<div><h1 className="text-2xl">Q3 Revenue Review</h1><p>x</p></div>')).toBe('Q3 Revenue Review');
  });

  it('takes the FIRST heading when there are several', () => {
    expect(firstHeadingTitle('<h1>First</h1><h1>Second</h1>')).toBe('First');
  });

  it('falls back to a lower heading level when there is no h1', () => {
    expect(firstHeadingTitle('<Slide><h2>Only an h2</h2></Slide>')).toBe('Only an h2');
  });

  it('keeps the text, not the inline markup inside it', () => {
    expect(firstHeadingTitle('<h1>Q3 <em>revenue</em> review</h1>')).toBe('Q3 revenue review');
  });

  it('decodes entities and collapses whitespace', () => {
    expect(firstHeadingTitle('<h1>\n  Sales &amp;   Ops\n</h1>')).toBe('Sales & Ops');
  });

  it('truncates a heading that is really a paragraph', () => {
    const long = firstHeadingTitle(`<h1>${'x'.repeat(400)}</h1>`);
    expect(long).toHaveLength(120);
  });

  // A single strip pass leaves markup behind when the tags are nested or the
  // text is entity-encoded, and the result is a NAME that travels into <title>,
  // og:title and aria labels. Escaping downstream is not a reason to hand those
  // surfaces a string with markup still in it.
  it('leaves no markup behind, however the heading is written', () => {
    expect(firstHeadingTitle('<h1><scr<b>ipt>alert(1)</scr</b>ipt>Report</h1>')).not.toMatch(/<script/i);
    expect(firstHeadingTitle('<h1>&lt;script&gt;alert(1)&lt;/script&gt; Report</h1>')).not.toMatch(/[<>]/);
  });

  it('is null when there is no heading, or nothing usable in one', () => {
    expect(firstHeadingTitle('<p>No heading here</p>')).toBeNull();
    expect(firstHeadingTitle('<h1>   </h1>')).toBeNull();
    // An interpolated heading has no static text to borrow.
    expect(firstHeadingTitle('<h1>{data.name}</h1>')).toBeNull();
    expect(firstHeadingTitle(null)).toBeNull();
  });
});

describe('displayTitle', () => {
  it('lets an explicit title win over the heading', () => {
    expect(displayTitle({ title: 'Named by hand', source: '<h1>Heading</h1>' })).toBe('Named by hand');
  });

  it('follows the heading when no title was ever set', () => {
    expect(displayTitle({ title: null, source: '<h1>Q3 Revenue Review</h1>' })).toBe('Q3 Revenue Review');
  });

  it('treats a blank title as unset', () => {
    expect(displayTitle({ title: '   ', source: '<h1>Q3 Revenue Review</h1>' })).toBe('Q3 Revenue Review');
  });

  it('falls back to Untitled with neither', () => {
    expect(displayTitle({ title: null, source: '<p>nothing</p>' })).toBe(UNTITLED);
    expect(displayTitle({})).toBe(UNTITLED);
  });
});
