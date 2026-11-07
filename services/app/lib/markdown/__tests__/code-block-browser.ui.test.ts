import { expect, it } from 'vitest';
import '../../html-components/markdown';
import type { AfMarkdown } from '../../html-components/markdown';

it('keeps the Prism core manual on browser load and renders only through the explicit helper', async () => {
  document.body.innerHTML = '<pre><code class="language-javascript">const saved = 1;</code></pre>';
  const existing = document.body.innerHTML;

  const { renderCodeBlock } = await import('../code-block');
  await new Promise(resolve => setTimeout(resolve, 25));

  expect((window as Window & { Prism?: { manual?: boolean } }).Prism?.manual).toBe(true);
  expect(document.body.innerHTML).toBe(existing);
  expect(renderCodeBlock('const draft = 2;', 'js')).toContain('mx-code-token-keyword');
});

it('sizes inline code at .9em of the reader parent and fenced and highlighted code at its size', async () => {
  const previousSize = document.body.style.fontSize;
  document.body.style.fontSize = '16px';
  const markdown = document.createElement('af-markdown') as AfMarkdown;
  markdown.source = 'Inline `count`.\n\n```\nplain\n```\n\n```js\nconst value = 1;\n```';
  document.body.append(markdown);
  try {
    const inline = markdown.querySelector('p code')!;
    const [plain, highlighted] = markdown.querySelectorAll('pre code');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(getComputedStyle(inline).fontSize).toBe('14.4px'); // the Markdown stylesheet's inline code: .9em
    expect(getComputedStyle(plain!).fontSize).toBe('16px');
    expect(getComputedStyle(highlighted!).fontSize).toBe('16px');
  } finally {
    markdown.remove();
    document.body.style.fontSize = previousSize;
  }
});
