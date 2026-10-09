import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { escapeHtml } from '@artifactbin/utils/escape';
import { MAX_HIGHLIGHT_CODE_LENGTH, renderCodeBlock } from '../code-block';
import { markdownContent } from '../content';

const cases = [
  ['html', '<section class="note"><script>const x = 42;</script></section>', 'html'],
  ['markdown', '# Heading\n\n**bold** and `code`', 'markdown'],
  ['js', 'const answer = "hello"; // note', 'javascript'],
  ['ts', 'const answer: number = 42;', 'typescript'],
  ['css', '.note { color: red; margin: 2px; }', 'css'],
  ['jsx', 'const view = <div className="note">{answer}</div>;', 'jsx'],
  ['tsx', 'const view: JSX.Element = <div>{answer}</div>;', 'tsx'],
] as const;
const decode = (html: string) => html.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!);

describe('language-tagged code rendering', () => {
  it.each(cases)('highlights %s as inert source and preserves its text', (language, source, canonical) => {
    const rendered = renderCodeBlock(source, language);
    expect(rendered).toContain(`data-language="${canonical}"`);
    expect(rendered).toContain('mx-code-token');
    const markdown = markdownContent('```' + language + '\n' + source + '\n```');
    expect(markdown.html).toBe(rendered);
    expect(markdown.text).toBe(source);
    expect(markdown.errors).toEqual([]);
    expect(rendered).not.toContain('<script>');
  });
  it('uses escaped plain text for missing, unknown or unsafe language labels', () => {
    const source = '<script>alert("hello & goodbye")</script> 🌻';
    for (const language of [undefined, 'unknown-language', 'constructor', '__proto__', '\"><script>alert(1)</script>']) {
      expect(renderCodeBlock(source, language)).toBe(`<pre><code>${escapeHtml(source)}</code></pre>`);
    }
  });
  it('bounds highlighting work without changing oversized source text', () => {
    const source = 'x'.repeat(MAX_HIGHLIGHT_CODE_LENGTH + 1);
    expect(renderCodeBlock(source, 'js')).toBe(`<pre><code>${source}</code></pre>`);
  });
  it.each([
    ['html', '<section class="note">text</section>', 'mx-code-token-tag'],
    ['md', '# Heading\n\n**bold**', 'mx-code-token-heading'],
    ['javascript', 'const answer = "hello"; // note', 'mx-code-token-keyword'],
    ['typescript', 'type Answer = number;', 'mx-code-token-type'],
    ['css', '.note { color: red; }', 'mx-code-token-property'],
    ['jsx', 'const view = <div className="note">{answer}</div>;', 'mx-code-token-tag'],
    ['tsx', 'const view: JSX.Element = <div>{answer}</div>;', 'mx-code-token-type'],
  ])('uses grammar tokens for %s and normalizes aliases', (language, source, tokenClass) => {
    const output = renderCodeBlock(source, language);
    expect(output).toContain(tokenClass);
    expect(output).toContain(`class="language-${language === 'md' ? 'markdown' : language}"`);
    expect(decode(output.replace(/<[^>]*>/g, ''))).toBe(source);
  });
  it('escapes token and unstyled fragments so HTML code remains inert', () => {
    const source = '<script>alert("x & y")</script>';
    const output = renderCodeBlock(source, 'html');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;');
    expect(output).toContain('&amp;');
    expect(decode(output.replace(/<[^>]*>/g, ''))).toBe(source);
  });
  it('highlights JavaScript and CSS nested inside HTML without executing either', () => {
    const source = '<script>const count = 2;</script><style>.note { color: red; }</style>';
    const output = renderCodeBlock(source, 'html');
    expect(output).toContain('mx-code-token-keyword');
    expect(output).toContain('mx-code-token-number');
    expect(output).toContain('mx-code-token-property');
    expect(decode(output.replace(/<[^>]*>/g, ''))).toBe(source);
    expect(output).not.toContain('<script>');
  });
});

// Production externalizes these component imports; Vite's resolver is not Node's ESM resolver.
describe('native server grammar loading', () => {
  it('loads the declared grammar imports in a fresh native Node process', () => {
    const sources = ['prism-core.ts', 'prism-grammars.ts'].map(name =>
      readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
    const specifiers = sources.flatMap(source => [...source.matchAll(/['"](prismjs\/components\/[^'"]+)['"]/g)].map(match => match[1]));
    expect(specifiers).toHaveLength(9);
    const script = `
      for (const specifier of ${JSON.stringify(specifiers)}) await import(specifier);
      const Prism = (await import(${JSON.stringify(specifiers[0])})).default;
      for (const name of ['markup', 'markdown', 'javascript', 'typescript', 'css', 'jsx', 'tsx']) {
        if (!Prism.languages[name]) throw new Error('Missing grammar: ' + name);
        Prism.tokenize('const answer = 42;', Prism.languages[name]);
      }
    `;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: new URL('../../../../..', import.meta.url), stdio: 'pipe',
    })).not.toThrow();
  });
});
