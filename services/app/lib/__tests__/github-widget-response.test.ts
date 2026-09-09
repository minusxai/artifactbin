import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { githubWidgetResponse } from '../github-widget-response';

it.each([27.999998, 28.000002, 27.5, 28.5])('reports real widget dimensions at fractional height %s', async height => {
  const html = await githubWidgetResponse().text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const messages: unknown[] = [];
  const callbacks: Array<() => void> = [];
  class Observer { constructor(callback: () => void) { callbacks.push(callback); } observe() {} }
  runInNewContext(script, {
    URLSearchParams, location: { hash: '' },
    document: { querySelector: () => ({ setAttribute() {} }), body: { querySelector: () => ({ getBoundingClientRect: () => ({ width: 94.68, height }) }) } },
    parent: { postMessage: (message: unknown) => messages.push(message) },
    ResizeObserver: Observer, MutationObserver: Observer, addEventListener() {},
  });
  callbacks.forEach(callback => callback());
  expect(messages).toContainEqual({ type: 'github-widget-size', width: 94.68, height });
});
