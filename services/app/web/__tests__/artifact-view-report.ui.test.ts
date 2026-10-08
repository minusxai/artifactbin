/**
 * ONE VIEW PER DOCUMENT SHOWN (solid/lib/artifact-view-report): the app page reports the document it frames with the same
 * request the served reader used to send, once per document in this page, and a prerendered page only when shown.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialViewWasReported, reportArtifactView } from '@/solid/lib/artifact-view-report';

let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.removeAttribute('data-mx-view-reported');
  delete (document as { prerendering?: boolean }).prerendering;
});

const views = () => fetcher.mock.calls.map(([url, init]) => [url, init]);

it('reports the shown document once, with the served reader\'s request', () => {
  reportArtifactView(window, 'first');
  reportArtifactView(window, 'first');
  expect(views()).toEqual([['/api/page/artifact/first/view', { method: 'POST', credentials: 'same-origin', keepalive: true }]]);
  expect(initialViewWasReported(document, 'first')).toBe(true);
  expect(initialViewWasReported(document, 'second')).toBe(false);
});

it('another document shown in the same page is another view', () => {
  reportArtifactView(window, 'first');
  reportArtifactView(window, 'second');
  expect(views().map(([url]) => url)).toEqual(['/api/page/artifact/first/view', '/api/page/artifact/second/view']);
});

it('encodes the id into the path', () => {
  reportArtifactView(window, 'a b');
  expect(views()[0]![0]).toBe('/api/page/artifact/a%20b/view');
});

it('a prerendered page reports only when it is shown, and once', () => {
  Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
  reportArtifactView(window, 'first');
  expect(views()).toEqual([]);
  document.dispatchEvent(new Event('prerenderingchange'));
  document.dispatchEvent(new Event('prerenderingchange'));
  expect(views().map(([url]) => url)).toEqual(['/api/page/artifact/first/view']);
});
