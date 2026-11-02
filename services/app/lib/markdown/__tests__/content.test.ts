import { describe, expect, it } from 'vitest';
import { markdownContent } from '../content';

describe('Markdown source contract', () => {
  it('renders Markdown source with headings, emphasis and lists',()=>{
    const md='## Overview\n\nA **bold** point & more.\n\n- One\n- Two';
    expect(markdownContent(md).html).toContain('<strong>bold</strong>');
    expect(markdownContent(md).text).toBe('OverviewA bold point & more.OneTwo');
    expect(markdownContent(md).headings).toEqual([{level:2,title:'Overview'}]);
  });

  it('rejects executable links and unsupported constructs', () => {
    for (const md of ['[bad](javascript:alert)', '<script>alert(1)</script>', '![image](https://example.com/a.png)', '> | A | B |\n> | --- | --- |\n> | C | D |']) {
      expect(markdownContent(md).errors.length, md).toBeGreaterThan(0);
    }
  });

  it('escapes code as text and accepts nested lists, quotes, and safe links', () => {
    const result = markdownContent('> A [link](https://example.com)\n\n1. First\n   - Nested\n\n```html\n<script>x</script>\n```');
    expect(result.errors).toEqual([]);
    expect(result.html).toContain('<code class="language-html" data-language="html">');
    expect(result.html).toContain('mx-code-token-tag');
    expect(result.html).not.toContain('<script>');
    expect(result.text).toContain('<script>x</script>');
    expect(result.html).toContain('<ol');
    expect(result.html).toContain('<blockquote>');
  });

  it('renders checklists, dividers and aligned tables as safe themed content', () => {
    const source = '- [ ] Open task\n- [x] Done task\n\n---\n\n| Name | Value |\n| :--- | ---: |\n| **Total** | 42 |';
    const result = markdownContent(source);
    expect(result.errors).toEqual([]);
    expect(result.html).toContain('role="checkbox"');
    expect(result.html).toContain('aria-checked="false"');
    expect(result.html).toContain('aria-checked="true"');
    expect(result.html).toContain('<hr');
    expect(result.html).toContain('<table');
    expect(result.html).toContain('<th');
    expect(result.html).toContain('text-align:right');
    expect(result.text).toBe('Open taskDone taskNameValueTotal42');
  });

});
