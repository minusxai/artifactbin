/**
 * Executable design spike for deck-preview identity.
 *
 * A preview cannot merely drop authored ids: SVG paints, labels and ARIA
 * relationships address those ids. The production seam should therefore be:
 *
 *   createPreviewIdNamespace(namespace: string):
 *     NonNullable<StoryInterpreterOptions['decorateElement']>
 *
 * and be installed only on SlideRail's renderStoryNodes call. This local
 * prototype characterizes that interface against the real interpreter; it is
 * intentionally not imported by production code.
 */
import React, { cloneElement } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes, type StoryInterpreterOptions } from '@/lib/story-ui/interpreter';

type DecorateElement = NonNullable<StoryInterpreterOptions['decorateElement']>;

const TOKEN_IDREFS = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']);
const SINGLE_IDREFS = new Set(['htmlFor', 'aria-activedescendant']);
const FRAGMENT_REFS = new Set(['href', 'xlinkHref']);
const PAINT_REFS = new Set([
  'fill', 'stroke', 'clipPath', 'mask', 'filter',
  'markerStart', 'markerMid', 'markerEnd',
]);

function prototypePreviewIdNamespace(namespace: string): DecorateElement {
  const namespaced = (id: string) => `${namespace}-${id}`;
  return (element: ReactElement) => {
    const props = element.props as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof props.id === 'string') patch.id = namespaced(props.id);
    for (const [name, raw] of Object.entries(props)) {
      if (typeof raw !== 'string') continue;
      if (TOKEN_IDREFS.has(name)) patch[name] = raw.split(/\s+/).map(namespaced).join(' ');
      else if (SINGLE_IDREFS.has(name)) patch[name] = namespaced(raw);
      else if (FRAGMENT_REFS.has(name) && raw.startsWith('#')) patch[name] = `#${namespaced(raw.slice(1))}`;
      else if (PAINT_REFS.has(name)) patch[name] = raw.replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${namespaced(id)})`);
    }
    return Object.keys(patch).length ? cloneElement(element, patch) : element;
  };
}

const SOURCE = `<div id="panel" aria-labelledby="title hint" aria-describedby="hint" aria-controls="field" aria-owns="field">
  <h2 id="title">Title</h2>
  <p id="hint">Hint</p>
  <label for="field">Value</label><input id="field" />
  <a href="#title">Jump</a>
  <svg aria-labelledby="svg-title">
    <title id="svg-title">Chart</title>
    <defs>
      <linearGradient id="paint"><stop offset="100%" stopColor="red" /></linearGradient>
      <clipPath id="crop"><rect width="10" height="10" /></clipPath>
    </defs>
    <rect id="mark" fill="url(#paint)" clipPath="url(#crop)" />
    <use href="#mark" />
  </svg>
</div>`;

describe('preview-local id namespace design', () => {
  it('namespaces every preview instance while leaving the main render untouched', () => {
    const parsed = parseJsx(SOURCE);
    if (!parsed.ok) throw new Error(parsed.error);
    const main = renderStoryNodes(parsed.nodes, { components: {} });
    const previewA = renderStoryNodes(parsed.nodes, { components: {}, decorateElement: prototypePreviewIdNamespace('mx-preview-0') });
    const previewB = renderStoryNodes(parsed.nodes, { components: {}, decorateElement: prototypePreviewIdNamespace('mx-preview-1') });
    const { container } = render(<>{main}{previewA}{previewB}</>);

    expect(container.querySelectorAll('#panel')).toHaveLength(1);
    expect(container.querySelectorAll('#mx-preview-0-panel')).toHaveLength(1);
    expect(container.querySelectorAll('#mx-preview-1-panel')).toHaveLength(1);
    expect([...container.querySelectorAll('[id]')].map((el) => el.id)).toHaveLength(new Set([...container.querySelectorAll('[id]')].map((el) => el.id)).size);
  });

  it('rewrites HTML, ARIA, fragment and SVG paint references within each namespace', () => {
    const parsed = parseJsx(SOURCE);
    if (!parsed.ok) throw new Error(parsed.error);
    const { container } = render(<>{renderStoryNodes(parsed.nodes, {
      components: {},
      decorateElement: prototypePreviewIdNamespace('mx-preview-7'),
    })}</>);

    const panel = container.querySelector('#mx-preview-7-panel')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('mx-preview-7-title mx-preview-7-hint');
    expect(panel.getAttribute('aria-describedby')).toBe('mx-preview-7-hint');
    expect(panel.getAttribute('aria-controls')).toBe('mx-preview-7-field');
    expect(panel.getAttribute('aria-owns')).toBe('mx-preview-7-field');
    expect(container.querySelector('label')?.getAttribute('for')).toBe('mx-preview-7-field');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#mx-preview-7-title');
    expect(container.querySelector('svg')?.getAttribute('aria-labelledby')).toBe('mx-preview-7-svg-title');
    expect(container.querySelector('rect#mx-preview-7-mark')?.getAttribute('fill')).toBe('url(#mx-preview-7-paint)');
    expect(container.querySelector('rect#mx-preview-7-mark')?.getAttribute('clip-path')).toBe('url(#mx-preview-7-crop)');
    expect(container.querySelector('use')?.getAttribute('href')).toBe('#mx-preview-7-mark');
  });
});
