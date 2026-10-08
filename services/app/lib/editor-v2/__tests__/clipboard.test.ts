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

it('accepts partial HTML list selections while retaining text and stripping source metadata', () => {
  const ast = clipboardAst('html', '<li id="foreign" class="bad"><p>B</p><ul><li>C</li></ul></li><li></li>');
  expect(() => validateClipboardAst(ast)).not.toThrow();
  expect(ast.children[0]?.type).toBe('list');
  expect(JSON.stringify(ast)).not.toMatch(/foreign|bad|position|checked|spread/);
  const list = ast.children[0];
  expect(list?.type === 'list' && list.children).toHaveLength(2);
  expect(JSON.stringify(ast)).toContain('B');
  expect(JSON.stringify(ast)).toContain('C');
});

it('wraps only orphan item runs, leaving surrounding prose and complete lists in order', () => {
  const ast = clipboardAst('html', '<p>before</p><li>B</li>\n<li></li><p>between</p><ol><li>C</li></ol><li>D</li><p>after</p>');
  expect(() => validateClipboardAst(ast)).not.toThrow();
  expect(ast.children.map(n => n.type)).toEqual(['paragraph', 'list', 'paragraph', 'list', 'list', 'paragraph']);
  expect(ast.children[1]?.type === 'list' && ast.children[1].children).toHaveLength(2);
  expect(ast.children[3]?.type === 'list' && ast.children[3].ordered).toBe(true);
});

it('accepts rich HTML formatting around block fragments without dropping text or formatting', () => {
  const ast = clipboardAst('html', '<b><p>B</p><ul><li>C</li><li><em>D</em></li></ul></b>');
  expect(() => validateClipboardAst(ast)).not.toThrow();
  expect(ast).toEqual(clipboardAst('markdown', '**B**\n\n- **C**\n- **_D_**'));
});

it('retains inline runs and nested formatting when block wrappers are normalized', () => {
  const ast = clipboardAst('html', '<b>before<p><em>B</em></p>after</b>');
  expect(() => validateClipboardAst(ast)).not.toThrow();
  expect(ast).toEqual(clipboardAst('markdown', '**before**\n\n**_B_**\n\n**after**'));
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
