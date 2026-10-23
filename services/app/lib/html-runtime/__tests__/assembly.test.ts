import { expect, it } from 'vitest';
import { assembleHtmlPage } from '../index';
it('boots core before authored scripts and preserves native HTML', () => {
  const result = assembleHtmlPage({ html: '<!doctype html><html><head><script>author()</script></head><body><x-chart data-af-id="n1">Hello</x-chart></body></html>', core: 'core()', config: { pageId: 'a', revision: 'r', backends: [] } });
  expect(result.indexOf('core()')).toBeLessThan(result.indexOf('author()'));
  expect(result).toContain('<x-chart data-af-id="n1">Hello</x-chart>');
  expect(result).not.toContain('mx-story-data');
});
it('escapes configuration script delimiters and makes downloads explicitly offline', () => {
  const result = assembleHtmlPage({ html: '<html><body></body></html>', core: 'core()', config: { pageId: 'a', revision: '</script>', backends: ['orders'], appOrigin: 'https://platform.example' }, offline: true });
  expect(result).toContain('\\u003c/script>');
  expect(result).toContain('"offline":true');
  expect(result).not.toContain('https://platform.example');
});
it('captures authored initial state before the first head script executes', () => {
  const result = assembleHtmlPage({ html: '<html><body><script type="application/json" data-af="state">{"count":3}</script></body></html>', core: 'core()', config: { pageId: 'a', revision: 'r', backends: [] } });
  expect(result).toContain('"initialState":{"count":3}');
});

it('replaces the canonical core loader while retaining its stable node identity', () => {
  const result = assembleHtmlPage({ html: '<html><head><script src="/af/v1/core.js" data-af-id="n1"></script></head><body></body></html>', core: 'core()', config: { pageId: 'a', revision: '1', backends: [] }, offline: true });
  expect(result).not.toContain('src="/af/v1/core.js"');
  expect(result).toContain('data-af="core" data-af-id="n1"');
  expect(result.match(/core\(\)/g)).toHaveLength(1);
});
it('round-trips HTML and line-separator characters in viewer state without executable delimiters', () => {
  const initialState = { label: '<tag></script>', line: String.fromCharCode(0x2028, 0x2029) };
  const result = assembleHtmlPage({ html: '<html><body></body></html>', core: 'core()', config: { pageId: 'a', revision: '1', backends: [], initialState } });
  const config = /<script type="application\/json" data-af="runtime">([\s\S]*?)<\/script>/.exec(result)![1]!;
  expect(config).not.toContain('</script>');
  expect(JSON.parse(config).initialState).toEqual(initialState);
});
