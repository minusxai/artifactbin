/**
 * The safety property, asserted against a real DOM rather than by reading CSS.
 *
 * The whole risk in giving bare markup a typographic floor is disturbing the
 * documents people already have. The claim is stronger than "utilities win the
 * cascade": a styled element must never MATCH these rules at all. That is a
 * question about selectors, so `Element.matches` answers it exactly — no
 * dependence on jsdom's cascade or computed-style fidelity.
 */
import { describe, it, expect } from 'vitest';
import { STORY_BARE_TYPOGRAPHY_CSS, BARE_TYPOGRAPHY_ELEMENTS } from '../bare-typography';
import { STORY_ROOT_ATTR } from '@/lib/story-surface';

/** Every selector the sheet declares. */
const selectors = STORY_BARE_TYPOGRAPHY_CSS.split('}')
  .map((block) => block.split('{')[0])
  .filter(Boolean);

function rootWith(html: string): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute(STORY_ROOT_ATTR, '');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const matchesAny = (el: Element) => selectors.some((s) => { try { return el.matches(s); } catch { return false; } });

describe('a styled element is never touched', () => {
  it('an element the author gave a className matches NO rule', () => {
    // The renderer adds no class of its own, so `class` present means the author styled it.
    const root = rootWith('<h1 class="text-7xl font-semibold">Styled</h1><p class="mt-6">Also styled</p>');
    for (const el of [...root.querySelectorAll('h1,p')]) {
      expect(matchesAny(el)).toBe(false);
    }
  });

  it('holds even for an empty class attribute', () => {
    const root = rootWith('<h1 class="">Edge</h1>');
    expect(matchesAny(root.querySelector('h1')!)).toBe(false);
  });

  it('leaves LAYOUT elements alone in any document that has ANY styling', () => {
    // The 2 unclassed elements in a real styled deck were both plain <div>s, so
    // this is the case that protects existing artifacts: the moment a document
    // contains one styled element, no layout element matches anything.
    const root = rootWith('<div><section><span>x</span></section><p class="mt-4">styled</p></div>');
    for (const el of [...root.querySelectorAll('div,section,span')]) {
      expect(matchesAny(el)).toBe(false);
    }
    // Typography never names a layout tag, in any document.
    expect(BARE_TYPOGRAPHY_ELEMENTS).not.toContain('div');
    expect(BARE_TYPOGRAPHY_ELEMENTS).not.toContain('section');
  });

  it('the document padding fires ONLY when nothing in the document is styled', () => {
    const padding = selectors.filter((s) => s.includes(':has('));
    expect(padding.length).toBeGreaterThan(0);
    // One styled element anywhere disables it for the whole document…
    const mixed = rootWith('<div>bare wrapper</div><p class="mt-4">styled</p>');
    expect(padding.some((s) => mixed.querySelector('div')!.matches(s))).toBe(false);
    // …and a wholly bare document gets it, which is the point.
    const bareDoc = rootWith('<div>bare wrapper</div>');
    expect(padding.some((s) => bareDoc.querySelector('div')!.matches(s))).toBe(true);
  });

  it('a MIXED document is styled only where the author left it bare', () => {
    const root = rootWith('<h1 class="text-5xl">Styled</h1><h2>Bare</h2>');
    expect(matchesAny(root.querySelector('h1')!)).toBe(false);
    expect(matchesAny(root.querySelector('h2')!)).toBe(true);
  });
});

describe('bare markup does get a floor', () => {
  it('the shape ChatGPT actually published matches', () => {
    const root = rootWith('<section><h1>Morning Walks</h1><p>A small habit.</p><ul><li>One</li></ul></section>');
    for (const tag of ['h1', 'p', 'ul', 'li']) {
      expect(matchesAny(root.querySelector(tag)!)).toBe(true);
    }
  });

  it('only ever matches inside a story root', () => {
    const stray = document.createElement('h1');
    document.body.appendChild(stray);
    expect(matchesAny(stray)).toBe(false);
  });
});
