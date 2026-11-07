/**
 * The Markdown stylesheet's code sizes, as plain strings (no DOM, so it runs in the fast PR lane): inline code is .9em
 * of the text around it, fenced code inherits the reader's size. Browser-measured in
 * lib/markdown/__tests__/code-block-browser.ui.test.ts, which runs only after merge.
 */
import { expect, it } from 'vitest';
import { MARKDOWN_CSS } from '../markdown-styles';

const declarations = (elements: string): string =>
  MARKDOWN_CSS.split('\n').find((rule) => rule.includes(`:where(${elements}){`))?.split('{')[1] ?? '';

it('sizes inline code at .9em and lets fenced code inherit the reader size', () => {
  expect(declarations('code')).toContain('font-size:.9em');
  expect(declarations('pre code')).toContain('font-size:inherit');
});
