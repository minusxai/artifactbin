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
      expect(selectionToolbarPlan({ kind: 'embed', tag })).toEqual({ text: false, format: false, color: false, link: false, image: false });
    }
  });
  it('a text-bearing tag gets the type controls; a container only layout', () => {
    expect(selectionToolbarPlan({ kind: 'element', tag: 'p' })).toEqual({ text: true, format: true, color: true, link: false, image: false });
    expect(selectionToolbarPlan({ kind: 'element', tag: 'div' })).toEqual({ text: false, format: true, color: true, link: false, image: false });
  });
  it('links need the live Range only a focused text host holds', () => {
    expect(selectionToolbarPlan({ kind: 'text', tag: 'p' })).toEqual({ text: true, format: true, color: true, link: true, image: false });
    expect(selectionToolbarPlan({ kind: 'text', tag: 'p', mode: 'typing' })).toEqual({ text: true, format: true, color: true, link: true, image: false });
  });
});

describe('what a BLOCK selection offers', () => {
  it('drops the text-only tools (size, weight, colour, links) and keeps the block ones (align, spacing)', () => {
    expect(selectionToolbarPlan({ kind: 'text', tag: 'p', mode: 'block' })).toEqual({ text: false, format: true, color: false, link: false, image: false });
    expect(selectionToolbarPlan({ kind: 'element', tag: 'div', mode: 'block' })).toEqual({ text: false, format: true, color: false, link: false, image: false });
    expect(selectionToolbarPlan({ kind: 'embed', tag: 'Question', mode: 'block' })).toEqual({ text: false, format: false, color: false, link: false, image: false });
  });
});

describe('an image', () => {
  it('gets its own controls and layout, never the text vocabulary — in either mode', () => {
    for (const mode of [undefined, 'block', 'typing'] as const)
      expect(selectionToolbarPlan({ kind: 'element', tag: 'img', mode }))
        .toEqual({ text: false, format: true, color: false, link: false, image: true });
  });
});
