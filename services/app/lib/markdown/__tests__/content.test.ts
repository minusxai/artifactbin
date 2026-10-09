import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { validateMarkupStructure } from '@/lib/document/local-validation';
import { markdownContent, markdownSource } from '../content';
import { generate } from '@/lib/compiled-page/compiler';
import { discoverOutline } from '@/lib/story-runtime/outline';
import { replaceProseRegion } from '@/lib/editor-engine/source-edit';
import { displayTitle } from '@/lib/document/title';

describe('Markdown source contract', () => {
  it('accepts literal Markdown in JSX and preserves it across serialization', () => {
    const source = '<Markdown id="body">{`## Overview\n\nA **bold** point & more.\n\n- One\n- Two`}</Markdown>';
    expect(validateMarkupStructure(source).errors).toEqual([]);
    const parsed = parseJsx(source);
    if (!parsed.ok || parsed.nodes[0].type !== 'element') throw new Error('parse');
    const md = markdownSource(parsed.nodes[0]);
    expect(md).toContain('A **bold** point');
    const reopened = parseJsx(serializeJsx(parsed.nodes));
    if (!reopened.ok || reopened.nodes[0].type !== 'element') throw new Error('parse');
    expect(markdownSource(reopened.nodes[0])).toBe(md);
    expect(markdownContent(md!).html).toContain('<strong>bold</strong>');
    expect(markdownContent(md!).text).toBe('OverviewA bold point & more.OneTwo');
    expect(markdownContent(md!).headings).toEqual([{ level: 2, title: 'Overview' }]);
  });

  it('rejects executable links and unsupported constructs at publication', () => {
    for (const md of ['[bad](javascript:alert)', '<script>alert(1)</script>', '![image](https://example.com/a.png)', '> | A | B |\n> | --- | --- |\n> | C | D |']) {
      expect(validateMarkupStructure(`<Markdown id="body">{${JSON.stringify(md)}}</Markdown>`).errors.length, md).toBeGreaterThan(0);
      expect(markdownContent(md).errors.length, md).toBeGreaterThan(0);
    }
    expect(validateMarkupStructure('<Markdown><p>Nested JSX</p></Markdown>').errors.length).toBeGreaterThan(0);
  });

  it('escapes code as text and accepts nested lists, quotes, and safe links', () => {
    const result = markdownContent('> A [link](https://example.com)\n\n1. First\n   - Nested\n\n```html\n<script>x</script>\n```');
    expect(result.errors).toEqual([]);
    expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(result.html).toContain('<ol');
    expect(result.html).toContain('<blockquote>');
  });

  it('renders checklists, dividers and aligned tables as safe themed content', () => {
    const source = '- [ ] Open task\n- [x] Done task\n\n---\n\n| Name | Value |\n| :--- | ---: |\n| **Total** | 42 |';
    const result = markdownContent(source);
    expect(result.errors).toEqual([]);
    expect(validateMarkupStructure(`<Markdown id="body">{${JSON.stringify(source)}}</Markdown>`).errors).toEqual([]);
    expect(result.html).toContain('role="checkbox"');
    expect(result.html).toContain('aria-checked="false"');
    expect(result.html).toContain('aria-checked="true"');
    expect(result.html).toContain('<hr');
    expect(result.html).toContain('<table');
    expect(result.html).toContain('<th');
    expect(result.html).toContain('text-align:right');
    expect(result.text).toBe('Open taskDone taskNameValueTotal42');
  });

  it('compiles themed static HTML, with outline headings and no reader-side editor', () => {
    const parsed = parseJsx('<Markdown id="body" className="text-lg">{`# Title\n\n## Section\n\nHello **world**`}</Markdown>');
    if (!parsed.ok) throw new Error('parse');
    const result = generate({ nodes: parsed.nodes, colorMode: 'light', template: 'doc', chrome: true, refData: {}, flow: null });
    const html = result.staticHtml.join('');
    expect(html).toContain('data-mx-markdown');
    expect(html).toContain('mx-markdown text-lg');
    expect(html).toContain('<strong>world</strong>');
    expect(html).not.toContain('**');
    expect(result.browserIslands).not.toContain('lexical');
    expect(discoverOutline(parsed.nodes, true)).toEqual([{ level: 1, title: 'Title', path: '0:md:0' }, { level: 2, title: 'Section', path: '0:md:1' }]);
    expect(displayTitle({ source: serializeJsx(parsed.nodes) })).toBe('Title');
  });

  it('saves only the addressed Markdown body, preserves wrapper edits, and rejects stale or hostile replacements', () => {
    const old = '<Markdown id="body">{"Hello"}</Markdown>';
    const replacement = '<Markdown id="body">{"Hello **world**"}</Markdown>';
    const current = '<h1 id="title">Designed title</h1><Markdown id="body" className="text-lg">{"Hello"}</Markdown>';
    const saved = replaceProseRegion(current, '1', old, replacement);
    expect(saved).toContain('className="text-lg"');
    expect(saved).toContain('Hello **world**');
    expect(saved).toContain('Designed title');
    expect(replaceProseRegion(saved, '1', old, replacement)).toBe(saved);
    expect(replaceProseRegion(current, '1', old, '<Markdown id="body">{"[bad](javascript:alert)"}</Markdown>')).toBe(current);
    expect(replaceProseRegion(current, '1', old, '<p id="body">changed type</p>')).toBe(current);
  });
});
