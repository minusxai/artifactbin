import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeHtml, escapeText, scriptJson } from '../escape';

const probe = `a&b<c>d"e'f &amp;`;

describe('markup escapers', () => {
  it('escapeText leaves quotes alone', () => {
    expect(escapeText(probe)).toBe(`a&amp;b&lt;c&gt;d"e'f &amp;amp;`);
  });
  it('escapeHtml escapes double quotes but not apostrophes', () => {
    expect(escapeHtml(probe)).toBe(`a&amp;b&lt;c&gt;d&quot;e'f &amp;amp;`);
  });
  it('escapeAttr also escapes apostrophes', () => {
    expect(escapeAttr(probe)).toBe(`a&amp;b&lt;c&gt;d&quot;e&#x27;f &amp;amp;`);
  });
  it('scriptJson cannot close a script element or break a JS line', () => {
    const out = scriptJson({ s: '</script><!--\u2028\u2029>' });
    expect(out).not.toMatch(/[<>\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual({ s: '</script><!--\u2028\u2029>' });
  });
});
