import { describe, expect, it } from 'vitest';
import { formatJsxPreview } from '../format-jsx-preview';
import { parseJsx } from '../jsx/parse';

describe('formatted JSX preview', () => {
  it('formats multiple roots and nested markup without exposing the temporary wrapper', async () => {
    const source = '<Helmet><title>Report</title></Helmet><section id="keep"><h1>Title</h1><p>Hello <strong>world</strong>.</p></section>';
    const result = await formatJsxPreview(source);
    expect(result.split('\n').length).toBeGreaterThan(5);
    expect(result).not.toContain('<>');
    expect(result).toContain('id="keep"');
    expect(parseJsx(result).ok).toBe(true);
  });

  it('keeps comments and embedded CSS, SQL and script template contents intact', async () => {
    const literals = ['.box {\n  color: red;\n}', 'select *\n  from rows', 'const text = "a  b";\n  draw(text);'];
    const result = await formatJsxPreview('<Helmet><style>{`' + literals[0] + '`}</style><Query name="q">{`' + literals[1] + '`}</Query></Helmet>{/* keep this */}<Iframe><script>{`' + literals[2] + '`}</script></Iframe>');
    for (const text of literals) expect(result).toContain(text);
    expect(result).toContain('/* keep this */');
  });

  it('refuses incomplete JSX instead of inventing a repaired document', async () => {
    await expect(formatJsxPreview('<section><p>Draft')).rejects.toThrow();
    expect(await formatJsxPreview('')).toBe('');
  });
});
