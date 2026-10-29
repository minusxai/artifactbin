/** lib/story-edit through its index: every write-back refuses what it cannot apply and leaves the source unchanged. */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxElement } from '@/lib/jsx';
import {
  NUMBER_AGGS, applyDomEditsToJsx, applyFormatEditsToJsx, applyLayoutEditsToJsx, normalizeLinkHref, removeJsxNodeAtPath, setStaticJsxAttr,
} from '..';

const DOC = '<h1>Title</h1><p className="mt-4">old</p>';

describe('applyDomEditsToJsx', () => {
  it('replaces a text host\'s children with the sanitized edit', () => {
    const { source, errors } = applyDomEditsToJsx(DOC, [{ astPath: '1', innerHtml: 'new <strong>bold</strong><script>x()</script>' }]);
    expect(source).toContain('<p className="mt-4">new <strong>bold</strong></p>');
    expect(source).not.toContain('script');
    expect(source).toContain('<h1>Title</h1>');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('skips an unknown path and reports a source that does not parse', () => {
    expect(applyDomEditsToJsx(DOC, [{ astPath: '9', innerHtml: 'x' }])).toMatchObject({ source: DOC, errors: [{ message: expect.stringContaining('"9"') }] });
    const broken = '<p>unclosed';
    const result = applyDomEditsToJsx(broken, [{ astPath: '0', innerHtml: 'x' }]);
    expect(result.source).toBe(broken);
    expect(result.errors).toHaveLength(1);
  });
});

describe('applyFormatEditsToJsx', () => {
  it('writes className and style on a plain element; empty removes the attribute', () => {
    const next = applyFormatEditsToJsx(DOC, [{ astPath: '0', className: ' text-xl ', style: 'color: red' }, { astPath: '1', className: '' }]);
    expect(next).toContain('<h1 className="text-xl" style="color: red">Title</h1>');
    expect(next).toContain('<p>old</p>');
  });

  it('returns the source unchanged when no edit applies', () => {
    expect(applyFormatEditsToJsx(DOC, [])).toBe(DOC);
    expect(applyFormatEditsToJsx(DOC, [{ astPath: '7', className: 'x' }])).toBe(DOC);
    expect(applyFormatEditsToJsx(DOC, [{ astPath: '0' }])).toBe(DOC);
  });
});

describe('applyLayoutEditsToJsx', () => {
  const GRID = '<Grid><GridItem x={0} y={0} w={4} h={2}><p>a</p></GridItem></Grid>';

  it('sets the rect of a GridItem and nothing else', () => {
    const next = applyLayoutEditsToJsx(GRID, [{ astPath: '0.0', x: 4, y: 1, w: 8, h: 3 }]);
    expect(next).toContain('<GridItem x={4} y={1} w={8} h={3}>');
    expect(next).toContain('<p>a</p>');
  });

  it('skips a path that is not a GridItem, and an empty batch', () => {
    expect(applyLayoutEditsToJsx(GRID, [])).toBe(GRID);
    expect(applyLayoutEditsToJsx(GRID, [{ astPath: '0', x: 1, y: 1, w: 1, h: 1 }])).toBe(GRID);
    expect(applyLayoutEditsToJsx(GRID, [{ astPath: '0.0.0', x: 1, y: 1, w: 1, h: 1 }])).toBe(GRID);
  });
});

describe('removeJsxNodeAtPath', () => {
  it('removes an element and refuses to empty the document or follow a malformed path', () => {
    expect(removeJsxNodeAtPath(DOC, '0')).toBe('<p className="mt-4">old</p>');
    expect(removeJsxNodeAtPath('<p>only</p>', '0')).toBe('<p>only</p>');
    for (const path of ['-1', '1.5', 'x', '4']) expect(removeJsxNodeAtPath(DOC, path), path).toBe(DOC);
  });
});

describe('setStaticJsxAttr', () => {
  it('replaces an attribute in place, appends a new one and removes on undefined', () => {
    const parsed = parseJsx('<Number value={1} label="a" />');
    if (!parsed.ok) throw new Error('parse');
    const el = parsed.nodes[0] as JsxElement;
    setStaticJsxAttr(el, 'value', 2);
    setStaticJsxAttr(el, 'agg', 'sum');
    setStaticJsxAttr(el, 'label', undefined);
    setStaticJsxAttr(el, 'missing', undefined);
    expect(el.attributes.map((a) => [a.name, a.value.static && a.value.json])).toEqual([['value', 2], ['agg', 'sum']]);
  });
});

describe('normalizeLinkHref', () => {
  it('passes safe schemes, lowers the scheme, and completes a bare domain', () => {
    expect(normalizeLinkHref('  HTTPS://Example.com/A ')).toBe('https://Example.com/A');
    expect(normalizeLinkHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(normalizeLinkHref('example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(normalizeLinkHref('/docs')).toBe('/docs');
    expect(normalizeLinkHref('#top')).toBe('#top');
  });

  it('refuses active content, unknown schemes and junk', () => {
    for (const raw of ['', '   ', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.example', 'not a link']) expect(normalizeLinkHref(raw), raw).toBeNull();
  });
});

describe('NUMBER_AGGS', () => {
  it('lists the aggregations a number embed offers', () => {
    expect(NUMBER_AGGS).toEqual(['first', 'last', 'sum', 'avg', 'median', 'min', 'max', 'count']);
  });
});
