import { describe, expect, it } from 'vitest';
import { htmlCarriesClass, inlineStoryElement } from '../story-element';

describe('the story root says whether the document is styled', () => {
  it('stamps data-mx-styled when any element carries a class, and only then', () => {
    expect(inlineStoryElement('<div><p class="mt-4">styled</p></div>', 'light', null)).toContain(' data-mx-styled=""');
    expect(inlineStoryElement('<section><h1>Bare</h1><p>text</p></section>', 'light', 'modernist')).not.toContain('data-mx-styled');
  });

  it('counts an empty class, an svg class and an unquoted one, as `:has([class])` did', () => {
    expect(htmlCarriesClass('<h1 class="">x</h1>')).toBe(true);
    expect(htmlCarriesClass('<svg viewBox="0 0 1 1"><path class=a d="M0"/></svg>')).toBe(true);
    expect(htmlCarriesClass('<p\n  class="x">x</p>')).toBe(true);
  });

  it('is not fooled by text, other attributes or a stylesheet that mention class', () => {
    expect(htmlCarriesClass('<p>a class="x" in prose is escaped text: class=&quot;x&quot;</p>')).toBe(false);
    expect(htmlCarriesClass('<p data-class="x" classname="y">x</p>')).toBe(false);
    expect(htmlCarriesClass('<style>[class] > p { color: red } <p class="x"></style><p>bare</p>')).toBe(false);
    expect(htmlCarriesClass('<script type="application/json">{"html":"<p class=\\"x\\">"}</script><p>bare</p>')).toBe(false);
  });
});
