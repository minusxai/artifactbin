/**
 * The floor under a BARE form control, asserted the way the typography floor
 * is: against a real DOM, with `Element.matches`, so the claim is about
 * selectors and not about jsdom's cascade.
 *
 * Tailwind's preflight strips an `<input>` to naked text — no border, no
 * padding, no radius — so the "add expense" form an agent published showed two
 * floating placeholders beside a fully framed `<DatePicker>`. `<Input>` is the
 * fix for new markup; this is the fix for the pages that already exist.
 *
 * Two properties carry the whole thing:
 *   - a control the author styled (`class` present) matches NOTHING, so no
 *     existing design moves;
 *   - only TEXT-LIKE controls match. A range slider, a checkbox, a radio, a
 *     file picker and a colour well are not text boxes, and a text box's frame
 *     would ruin every one of them.
 */
import { describe, expect, it } from 'vitest';
import { STORY_BARE_CONTROLS_CSS, BARE_CONTROL_EXCLUDED_TYPES } from '../bare-controls';
import { STORY_ROOT_ATTR } from '@/lib/story-surface';

const selectors = STORY_BARE_CONTROLS_CSS.split('}')
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

describe('a bare text control gets a frame', () => {
  it('the shape that shipped: two bare inputs beside a DatePicker', () => {
    const root = rootWith(
      '<input type="text" placeholder="What was it for?">'
      + '<input type="number">'
      + '<textarea></textarea>'
      + '<select><option>One</option></select>'
      + '<input>', // no type at all is a text box
    );
    for (const el of [...root.querySelectorAll('input,textarea,select')]) {
      expect(matchesAny(el), el.outerHTML).toBe(true);
    }
  });

  it('leaves the controls that are NOT text boxes alone', () => {
    for (const type of BARE_CONTROL_EXCLUDED_TYPES) {
      const root = rootWith(`<input type="${type}">`);
      expect(matchesAny(root.querySelector('input')!), type).toBe(false);
    }
    // The five the brief names, spelled out so a regression is legible.
    for (const type of ['range', 'checkbox', 'radio', 'file', 'color']) {
      expect(BARE_CONTROL_EXCLUDED_TYPES, type).toContain(type);
    }
  });

  it('never touches a control the author styled — className wins by not competing', () => {
    const root = rootWith(
      '<input type="text" class="w-full border-0 bg-transparent">'
      + '<textarea class="font-mono"></textarea>'
      + '<select class=""></select>',
    );
    for (const el of [...root.querySelectorAll('input,textarea,select')]) {
      expect(matchesAny(el), el.outerHTML).toBe(false);
    }
  });

  it('never touches a DataTable cell editor, which the cell seam already frames', () => {
    // RuntimeCellControl gives its input a className of its own — so, like any
    // styled control, it cannot match these rules at all.
    const root = rootWith('<input type="text" class="h-8 w-full min-w-0 rounded-md border border-transparent px-2">');
    expect(matchesAny(root.querySelector('input')!)).toBe(false);
  });

  it('stays inside the story surface', () => {
    const loose = document.createElement('input');
    document.body.appendChild(loose);
    expect(matchesAny(loose)).toBe(false);
    for (const s of selectors) expect(s).toContain(STORY_ROOT_ATTR);
  });
});

describe('the sheet itself', () => {
  it('every theme token carries a fallback — a legacy document has no token layer at all', () => {
    // An unresolvable `var(--input)` makes the whole declaration
    // guaranteed-invalid, and this sheet is served to EVERY document,
    // including the ones compiled before the token layer existed.
    const tokens = [...STORY_BARE_CONTROLS_CSS.matchAll(/var\(\s*(--[\w-]+)([^)]*)\)/g)];
    expect(tokens.length).toBeGreaterThan(0);
    for (const [, name, rest] of tokens) expect(rest.trim(), `var(${name}) has no fallback`).toMatch(/^,/);
  });

  it('is beatable by the author\'s own stylesheet: element specificity, nothing more', () => {
    // The author's <style> block is the LAST sheet in the document, so an
    // `input { … }` rule of theirs must not be outranked. Everything but the
    // tag sits inside `:where()`, which contributes no specificity.
    for (const selector of selectors) {
      const outside = selector.replace(/:where\([^()]*(\([^()]*\)[^()]*)*\)/g, '');
      expect(outside, selector).not.toMatch(/[.#[]|:not\(/);
    }
  });

  it('frames the field with the same tokens the kit control uses', () => {
    for (const property of ['border', 'padding', 'border-radius', 'background', 'font-size']) {
      expect(STORY_BARE_CONTROLS_CSS, property).toContain(property);
    }
    expect(STORY_BARE_CONTROLS_CSS).toContain('--input');
    expect(STORY_BARE_CONTROLS_CSS).toContain('--ring');
    expect(STORY_BARE_CONTROLS_CSS).toMatch(/:focus-visible/);
  });
});
