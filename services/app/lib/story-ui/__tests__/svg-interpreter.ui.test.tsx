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
import { render } from '@testing-library/react';
import { renderStoryNodes } from '../interpreter';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const mount = (src: string) => {
  const parsed = parseJsxOrThrow(src);
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

describe('a <For> in svg', () => {
  const rows = { bars: { rows: [{ k: 'a', h: 4 }, { k: 'b', h: 7 }] } };
  const wrapperOf = (src: string) => {
    const { container } = render(<>{renderStoryNodes(parseJsxOrThrow(src).nodes, { components: {}, tables: rows })}</>);
    return container.querySelector('#bars')!;
  };

  it('wraps its rows in a <g>, keeping the owner id, classes and AST path', () => {
    const g = wrapperOf('<svg><For id="bars" each={$bars} keyBy="k" className="text-primary"><rect height="$_row.h" /></For></svg>');
    expect(g.tagName).toBe('g');
    expect(g.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(g.getAttribute('class')).toBe('text-primary');
    expect(g.getAttribute('data-mx-ast')).toBe('0.0');
    expect([...g.children].map((c) => c.getAttribute('height'))).toEqual(['4', '7']);
  });

  it('wraps them in a <g> anywhere in the svg subtree, not only as its direct child', () => {
    expect(wrapperOf('<svg><g><For id="bars" each={$bars}><rect /></For></g></svg>').tagName).toBe('g');
  });

  it('is still a <div> outside svg', () => {
    expect(wrapperOf('<div><For id="bars" each={$bars}><p>x</p></For></div>').tagName).toBe('DIV');
  });
});
