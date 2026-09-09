import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { githubWidgetResponse } from '../github-widget-response';

it('retries readiness until its parent acknowledges, then stops; retries are bounded', async () => {
  const script = (await githubWidgetResponse().text()).match(/<script>([\s\S]*?)<\/script>/)![1];
  let resize = () => {};
  let message = (_event: { source: unknown; data: string }) => {};
  let retry: (() => void) | undefined;
  let sent = 0;
  const parent = { postMessage: () => { sent++; } };
  class ResizeObserver { constructor(callback: () => void) { resize = callback; } observe() {} }
  runInNewContext(script, {
    URLSearchParams, location: { hash: '' },
    document: { querySelector: () => ({ setAttribute() {} }), body: { querySelector: () => ({ getBoundingClientRect: () => ({ width: 94.68, height: 27.6 }) }) } },
    parent, ResizeObserver, MutationObserver: class { observe() {} },
    addEventListener: (_name: string, callback: typeof message) => { message = callback; },
    setTimeout: (callback: () => void) => { retry = callback; return 1; },
    clearTimeout: () => { retry = undefined; },
  });
  resize();
  expect(sent).toBe(1);
  retry!();
  expect(sent).toBe(2);
  message({ source: {}, data: 'github-widget-size-ack' });
  expect(retry).toBeDefined();
  for (let i = 0; i < 50 && retry; i++) retry();
  expect(sent).toBe(41);
  expect(retry).toBeUndefined();
  message({ source: parent, data: 'github-widget-size-ack' });
  resize();
  expect(sent).toBe(42);
  expect(retry).toBeUndefined();
});

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
    setTimeout() {}, clearTimeout() {},
  });
  callbacks.forEach(callback => callback());
  expect(messages).toContainEqual({ type: 'github-widget-size', width: 94.68, height });
});
