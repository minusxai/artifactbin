/**
 * A LIVE MORPH UNDER A WORD-RANGE COMMENT. An agent rewords the commented words and the page is morphed to the new
 * version in place (lib/islands/morph/engine): the paragraph keeps its node, its text node takes the new words, and
 * the morph rewrites the paragraph's attributes to the served ones — the layer's own stamps included. Nothing
 * re-renders and nobody calls the layer, so the layer must notice the morph itself, re-resolve the stored range
 * against the new text, and — the words being gone — drop the highlight for the whole-node tint.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFrameAnnotateSession } from '@/lib/story-runtime/edit/annotate';
import { morphStory } from '@/lib/islands/morph/engine';
import type { RuntimeChannel } from '@/lib/story-runtime/pristine';

const FIRST = 'Revenue grew 40% in Q3, ahead of plan.';
const QUOTE = 'ahead of plan.';

const SECOND = 'Costs fell 8% over the same period.';
const served = (edit: string, first: string, second = SECOND) => '<!doctype html><html class="light"><head><title>Quoted</title></head>'
  + `<body data-mx-live-id="doc1" data-mx-live-edit="${edit}">`
  + '<div id="mx-story-root" data-mx-inline-story="" data-mx-story-root="" class="light"><div class="mx-doc"><div id="w" data-mx-ast="0" class="p-10">'
  + `<h1 id="h" data-mx-ast="0.0">Two paragraphs</h1><p id="first" data-mx-ast="0.1">${first}</p><p id="second" data-mx-ast="0.2">${second}</p>`
  + '</div></div></div><script type="module" src="/islands/page-1.js" crossorigin></script></body></html>';

function load(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.className = parsed.documentElement.className;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  for (const attr of parsed.body.attributes) document.body.setAttribute(attr.name, attr.value);
}

/** jsdom has no CSS Custom Highlight API: a registry that records what the layer paints. */
const registry = new Map<string, { ranges: Range[] }>();
const css = window.CSS as unknown as { highlights?: unknown };
const scope = window as unknown as { Highlight?: unknown };

let session: ReturnType<typeof createFrameAnnotateSession>;
const channel: RuntimeChannel = { nonce: 'l'.repeat(32), post: () => {}, innerHtmlOf: (el) => el.innerHTML };
const pin = {
  id: 'ann_1', path: '0.1', key: null, nodeId: 'first',
  range: { v: 1 as const, parts: [{ rel: '', start: FIRST.indexOf(QUOTE), end: FIRST.length, text: QUOTE }] },
};

beforeEach(() => {
  registry.clear();
  css.highlights = registry;
  scope.Highlight = class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } };
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
  load(served('e1', FIRST));
  session = createFrameAnnotateSession({ win: window, channel, isEditing: () => false });
});

afterEach(() => {
  session.dispose();
  delete css.highlights;
  delete scope.Highlight;
  vi.restoreAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
});

const paint = () => {
  const first = document.getElementById('first')!;
  return {
    highlighted: registry.has('mx-annotation-ann_1'),
    tinted: first.hasAttribute('data-mx-annotated'),
    ranged: first.hasAttribute('data-mx-annotation-ranged'),
  };
};

it('falls back to the whole-node tint when a live morph rewords the commented words', async () => {
  session.update({ type: 'mx:annotations', mode: 'on', pins: [pin], openId: null, hoverId: null });
  expect(paint()).toEqual({ highlighted: true, tinted: true, ranged: true });
  expect(registry.get('mx-annotation-ann_1')!.ranges.map(String)).toEqual([QUOTE]);
  const first = document.getElementById('first');

  await morphStory(window, { surface: 'raw', fetch: vi.fn(async () => new Response(served('e2', 'Revenue was flat in Q3, behind plan.'))), importModule: vi.fn() });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(document.getElementById('first'), 'the morph kept the node').toBe(first);
  expect(first!.textContent).toBe('Revenue was flat in Q3, behind plan.');
  expect(paint()).toEqual({ highlighted: false, tinted: true, ranged: false });
});

it('re-resolves the words after a live morph that keeps them', async () => {
  session.update({ type: 'mx:annotations', mode: 'on', pins: [pin], openId: null, hoverId: null });
  const before = registry.get('mx-annotation-ann_1')!.ranges[0];

  await morphStory(window, { surface: 'raw', fetch: vi.fn(async () => new Response(served('e2', 'Revenue grew 41% in Q3, ahead of plan.'))), importModule: vi.fn() });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(paint()).toEqual({ highlighted: true, tinted: true, ranged: true });
  const after = registry.get('mx-annotation-ann_1')!.ranges[0];
  expect(after).not.toBe(before);
  expect(after.toString()).toBe(QUOTE);
});

it('keeps the paint on a commented node the morph left alone, though it reset that node\'s attributes', async () => {
  session.update({ type: 'mx:annotations', mode: 'on', pins: [pin], openId: null, hoverId: null });

  await morphStory(window, { surface: 'raw', fetch: vi.fn(async () => new Response(served('e2', FIRST, 'Costs fell 9% over the same period.'))), importModule: vi.fn() });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(document.getElementById('second')!.textContent).toBe('Costs fell 9% over the same period.');
  expect(paint()).toEqual({ highlighted: true, tinted: true, ranged: true });
  expect(registry.get('mx-annotation-ann_1')!.ranges.map(String)).toEqual([QUOTE]);
});
