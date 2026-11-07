// @vitest-environment jsdom
/**
 * The safety property of the retired story renderer's bare-text defaults (../native-html-structural-wrapper),
 * asserted against a real DOM rather than by reading CSS: a styled element must never MATCH these rules at all.
 * That is a question about selectors, so `Element.matches` answers it exactly. Components inside such a page
 * (af-data-table's cells carry classes) stay out for the same reason.
 */
import { describe, it, expect } from 'vitest';
import { LEGACY_STORY_TEXT_CSS } from '../native-html-structural-wrapper';

const selectors = LEGACY_STORY_TEXT_CSS.replace(/@media[^{]+\{/g, '').split('}')
  .map((block) => block.split('{')[0]!.trim())
  .filter(Boolean);

/** An unstyled inline-story root as the retired renderer saved it. */
function rootWith(html: string): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-mx-story-root', '');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = `<div class="mx-doc">${html}</div>`;
  document.body.appendChild(root);
  return root;
}
const matchesAny = (el: Element) => selectors.some((s) => el.matches(s));

describe('a styled element is never touched', () => {
  it('an element the author gave a className matches NO rule, even an empty one', () => {
    const root = rootWith('<h1 class="text-7xl font-semibold">Styled</h1><p class="mt-6">Also styled</p><h2 class="">Edge</h2><table class="mx-data-table"><tr><td class="cell">1</td></tr></table>');
    for (const el of [...root.querySelectorAll('h1,h2,p,table,td')]) expect(matchesAny(el)).toBe(false);
  });

  it('never names a layout tag', () => {
    const root = rootWith('<div><section><span>x</span></section></div>');
    for (const el of [...root.querySelectorAll('div,section,span')]) expect(matchesAny(el)).toBe(false);
  });

  it('a MIXED document is styled only where the author left it bare', () => {
    const root = rootWith('<h1 class="text-5xl">Styled</h1><h2>Bare</h2>');
    expect(matchesAny(root.querySelector('h1')!)).toBe(false);
    expect(matchesAny(root.querySelector('h2')!)).toBe(true);
  });
});

describe('bare markup does get a floor', () => {
  it('bare text inside the root matches', () => {
    const root = rootWith('<section><h1>Morning Walks</h1><p>A small habit.</p><ul><li>One</li></ul></section>');
    for (const tag of ['h1', 'p', 'ul', 'li']) expect(matchesAny(root.querySelector(tag)!)).toBe(true);
  });

  it('only ever matches inside an unstyled inline-story root', () => {
    const stray = document.createElement('h1');
    document.body.appendChild(stray);
    expect(matchesAny(stray)).toBe(false);
    const styled = rootWith('<h1>Styled story</h1>');
    styled.setAttribute('data-mx-styled', '');
    expect(matchesAny(styled.querySelector('h1')!)).toBe(false);
  });

  it('never re-matches through a whole-page :has() pass', () => {
    expect(LEGACY_STORY_TEXT_CSS).not.toContain(':has(');
  });
});
