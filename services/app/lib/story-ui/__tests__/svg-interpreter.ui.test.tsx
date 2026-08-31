/**
 * SVG subset — interpreter gate (defense in depth, mirrors svg-validate).
 *
 * The interpreter lowercases HTML tags, but SVG's camelCase tags/attributes are
 * CASE-SENSITIVE in the DOM: `createElement('clippath')` is an unknown element
 * and a lowercased `viewbox` attribute is silently ignored. The interpreter
 * must restore canonical casing, and must drop external url() paint refs even
 * on an unvalidated AST.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '../interpreter';

const mount = (src: string) => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(parsed.error);
  return render(<>{renderStoryNodes(parsed.nodes, { components: {} })}</>);
};

describe('svg rendering', () => {
  it('renders camelCase svg tags with canonical case (clipPath, linearGradient)', () => {
    const { container } = mount(
      '<svg><defs><linearGradient id="g"><stop offset="0" /></linearGradient><clipPath id="c"><rect /></clipPath></defs></svg>',
    );
    expect(container.getElementsByTagName('linearGradient')).toHaveLength(1);
    expect(container.getElementsByTagName('clipPath')).toHaveLength(1);
  });

  it('restores canonical case for lowercase-authored svg tags too', () => {
    const { container } = mount('<svg><defs><lineargradient id="g" /></defs></svg>');
    expect(container.getElementsByTagName('linearGradient')).toHaveLength(1);
  });

  it('preserves viewBox casing (authored camel or lowercase)', () => {
    const { container } = mount('<svg viewBox="0 0 100 50" />');
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 100 50');
    const lower = mount('<svg viewbox="0 0 9 9" />');
    expect(lower.container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 9 9');
  });

  it('keeps local paint refs and literal colors; drops external url() paints', () => {
    const { container } = mount(
      '<svg><circle r="4" fill="url(#g)" /><rect fill="#e2483d" /><path d="M0 0" fill="url(https://evil.example/p)" /></svg>',
    );
    expect(container.querySelector('circle')!.getAttribute('fill')).toBe('url(#g)');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe('#e2483d');
    expect(container.querySelector('path')!.getAttribute('fill')).toBeNull();
  });

  it('renders text content inside svg <text>', () => {
    const { container } = mount('<svg><text x="0" y="10">FRAME 0000</text></svg>');
    expect(container.querySelector('text')!.textContent).toBe('FRAME 0000');
  });
});
