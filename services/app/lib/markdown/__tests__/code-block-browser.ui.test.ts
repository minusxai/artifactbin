import { expect, it } from 'vitest';

it('keeps the Prism core manual on browser load and renders only through the explicit helper', async () => {
  document.body.innerHTML = '<pre><code class="language-javascript">const saved = 1;</code></pre>';
  const existing = document.body.innerHTML;

  const { renderCodeBlock } = await import('../code-block');
  await new Promise(resolve => setTimeout(resolve, 25));

  expect((window as Window & { Prism?: { manual?: boolean } }).Prism?.manual).toBe(true);
  expect(document.body.innerHTML).toBe(existing);
  expect(renderCodeBlock('const draft = 2;', 'js')).toContain('mx-code-token-keyword');
});
