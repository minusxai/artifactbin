/**
 * THE ONE MAPPING from "what is selected" to "what the toolbar offers"
 * (lib/story/selection-toolbar). Three controls are UNCONDITIONAL — the
 * breadcrumb naming the element, comment, delete — so every element in a
 * document is clickable and every click lands somewhere useful. What varies
 * is the format vocabulary, and it varies HERE, nowhere else.
 */
import { describe, expect, it } from 'vitest';
import { ALWAYS_OFFERED, selectionToolbarPlan } from '@/lib/story/selection-toolbar';

describe('the unconditional controls', () => {
  it('name, comment and delete are offered for EVERY selection kind', () => {
    expect([...ALWAYS_OFFERED]).toEqual(['name', 'comment', 'delete']);
  });
});

describe('what varies, by kind', () => {
  it('a component gets no class algebra — its classes are render output', () => {
    for (const tag of ['Question', 'Number', 'GridItem', 'Card']) {
      expect(selectionToolbarPlan({ kind: 'embed', tag })).toEqual({ text: false, format: false, link: false });
    }
  });
  it('a text-bearing tag gets the type controls; a container only layout', () => {
    expect(selectionToolbarPlan({ kind: 'element', tag: 'p' })).toEqual({ text: true, format: true, link: false });
    expect(selectionToolbarPlan({ kind: 'element', tag: 'div' })).toEqual({ text: false, format: true, link: false });
  });
  it('links need the live Range only a focused text host holds', () => {
    expect(selectionToolbarPlan({ kind: 'text', tag: 'p' })).toEqual({ text: true, format: true, link: true });
  });
});
