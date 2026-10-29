import { describe, expect, it } from 'vitest';
import { markdownHref, parseMarkdown } from '../content';
import { MARKDOWN_CSS } from '../styles';

describe('markdownHref', () => {
  it('accepts relative, fragment and web/mail/phone links', () => {
    for (const href of ['/docs', 'page.md', '#section', '?q=1', 'https://example.com', 'HTTP://EXAMPLE.COM', 'mailto:a@b.c', 'tel:+15551234', '']) expect(markdownHref(href)).toBe(true);
  });

  it('refuses executable and other schemes, including ones hidden by whitespace or control characters', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\x00javascript:x', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://host'])
      expect(markdownHref(href)).toBe(false);
  });
});

describe('parseMarkdown', () => {
  it('parses GFM into an mdast root: headings, tables, task lists and strikethrough', () => {
    const root = parseMarkdown('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~');
    expect(root.type).toBe('root');
    expect(root.children.map(node => node.type)).toEqual(['heading', 'table', 'list', 'paragraph']);
    const list = root.children[2] as { children: Array<{ checked: boolean | null }> };
    expect(list.children[0]!.checked).toBe(true);
    expect((root.children[3] as { children: Array<{ type: string }> }).children[0]!.type).toBe('delete');
  });

  it('answers an empty root for empty input and keeps unicode text verbatim', () => {
    expect(parseMarkdown('').children).toEqual([]);
    const text = parseMarkdown('héllo 世界 👋') as unknown as { children: Array<{ children: Array<{ value: string }> }> };
    expect(text.children[0]!.children[0]!.value).toBe('héllo 世界 👋');
  });
});

describe('MARKDOWN_CSS', () => {
  it('styles markdown at zero specificity so a design system can override it', () => {
    expect(MARKDOWN_CSS).toContain(':where(.mx-markdown)');
    const selectors = MARKDOWN_CSS.split('}').map(rule => rule.split('{')[0]!.trim()).filter(selector => selector && !selector.startsWith('@') && !selector.startsWith('/*'));
    expect(selectors.length).toBeGreaterThan(5);
    expect(selectors.filter(selector => !selector.includes(':where(')).filter(selector => /\.mx-markdown/.test(selector))).toEqual([]);
  });
});
