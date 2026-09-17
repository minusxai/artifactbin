import { validateClipboardAst } from '../clipboard-ast';
import { describe, expect, it } from 'vitest';
import { clipboardAst } from '../clipboard';

describe('clipboard converges at the Markdown AST', () => {
  it('HTML punctuation is literal rather than being parsed as Markdown', () => {
    expect(clipboardAst('html', '<p>_literal_ *stars* | pipes # hashes</p>')).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '_literal_ *stars* | pipes # hashes' }],
        },
      ],
    });
  });
  it('both paths produce the same semantic nested list and table AST', () => {
    const md = '- one\n  - nested\n\n| A | B |\n| - | - |\n| x | y |';
    const html =
      '<ul><li>one<ul><li>nested</li></ul></li></ul><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>';
    expect(clipboardAst('html', html)).toEqual(clipboardAst('markdown', md));
  });
  it('drops active content, all presentation, IDs and metadata before conversion', () => {
    const ast = clipboardAst(
      'html',
      '<script>alert(1)</script><style>p{color:red}</style><p id="victim" class="a" style="font-weight:bold" onclick="evil()" data-x="secret">plain <strong class="b">bold</strong><a href="javascript:evil()">bad</a><iframe src="https://evil.test">hidden</iframe></p>',
    );
    expect(JSON.stringify(ast)).not.toMatch(/victim|secret|evil|alert|hidden|class|style|position|data/);
    expect(ast).toEqual(clipboardAst('markdown', 'plain **bold**bad'));
  });
  it('keeps safe link semantics and removes reference/raw-HTML channels', () => {
    expect(
      clipboardAst('html', '<p><a href="https://example.com" target="_self" style="color:red">link</a></p>'),
    ).toEqual(clipboardAst('markdown', '[link](https://example.com)'));
    expect(JSON.stringify(clipboardAst('markdown', '<script>evil()</script>'))).not.toContain('evil');
  });
  it('literal paste does not interpret Markdown', () => {
    expect(clipboardAst('text', '**hello**').children).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: '**hello**' }] },
    ]);
  });
});

it('resolves Markdown reference links through the same safe link dialect', () => {
  expect(clipboardAst('markdown', '[link][ref]\n\n[ref]: https://example.com')).toEqual(
    clipboardAst('html', '<p><a href="https://example.com">link</a></p>'),
  );
  expect(clipboardAst('markdown', '[link][ref]\n\n[ref]: javascript:bad()')).toEqual(clipboardAst('text', 'link'));
});

it('independently rejects converter metadata and invalid structural children', () => {
  expect(() =>
    validateClipboardAst({
      type: 'root',
      children: [{ type: 'paragraph', children: [], data: { hProperties: { className: 'foreign' } } }],
    }),
  ).toThrow(/properties/);
  expect(() =>
    validateClipboardAst({
      type: 'root',
      children: [{ type: 'list', ordered: false, children: [{ type: 'text', value: 'invalid' }] }],
    } as never),
  ).toThrow(/structure/);
  expect(() => validateClipboardAst(clipboardAst('markdown', '- one\n  - **two**'))).not.toThrow();
});
