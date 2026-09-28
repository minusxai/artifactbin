// DESTINATION: services/app/lib/compiled-page/__tests__/assembler.test.ts
/**
 * ONE assembler for every reader path (docs/phase2-architecture.md §2.2, §9; contract AssembleInput):
 * the same compiled page becomes `/a/:id` (chrome, SPA on idle) and `/raw` (neither) with no inline
 * script anywhere, the island data as JSON, the snapshot's drawings in the chart slots, and the
 * per-document module preloaded and imported.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { assembleReaderPage } from '../assembler';
import { CHART_SLOT_ATTR, ISLAND_DATA_ID, SPA_IDLE_ATTR, SPECULATION_RULES_HEADER, type AssembleInput, type CompiledPage, type DataSnapshot } from '../contract';

const build = { id: 'b'.repeat(16), manifest: { 'solid-js': '/islands/solid-1111aaaa.js', 'solid-js/web': '/islands/web-2222bbbb.js', 'solid-js/store': '/islands/store-3333cccc.js', '@mx/rt': '/islands/rt-4444dddd.js', '@mx/boot': '/islands/boot-5555eeee.js', '@mx/deck': '/islands/deck-6666ffff.js' } };
const compiled = (over: Partial<CompiledPage> = {}): CompiledPage => ({
  build: build.id,
  html: `<div class="mx-doc"><h1 id="h">Title &amp; more</h1><div data-hk="s0-0" id="G2uA">select</div><div id="AVkX" ${CHART_SLOT_ATTR}="AVkX"><div class="skeleton"></div></div></div>`,
  islands: [{ renderId: 's0-', path: '0.1', kit: ['Select'], readsData: true }],
  module: { sha: 'a'.repeat(16), url: '/islands/d/aaaaaaaaaaaaaaaa.js', bytes: 512, imports: ['/islands/rt-4444dddd.js', '/islands/web-2222bbbb.js'] },
  ssr: { sha: 'c'.repeat(16), url: '/islands/d/cccccccccccccccc.js', bytes: 700, imports: [] },
  behaviors: [], plan: null, links: { prefetch: ['/a/Btruq6'], prerender: ['/a/Btruq6'] }, kit: { skeleton: [], islands: ['Select'] }, reactStatic: ['Card'], unported: [], partial: [],
  ...over,
});
const snapshot: DataSnapshot = { key: { artifactId: 'X34b00', slot: 'head', planKey: 'p', inputsKey: 'i' }, marks: { sales: 'm' }, results: { tables: { monthly: { rows: [{ revenue: 1 }], columns: [{ name: 'revenue', type: 'number' }] } }, errors: {} }, drawings: { AVkX: { svg: '<svg data-drawn="1"></svg>', table: 'monthly', rows: 'r' } }, computedAt: 1, build: build.id };
const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  compiled: compiled(), story: compiled().html, css: '.mx-doc{color:red}', fontPreloads: ['/fonts/inter.woff2'], title: 'Perf <C> dashboard', theme: 'industry', colorMode: 'light', snapshot,
  overlay: { values: { region: 'West' }, mermaidImages: {}, signedIn: false, doors: { queryUrl: '/a/X34b00/query', assetsUrl: '/a/X34b00/assets', viewerUrl: '/a/X34b00/viewer' } },
  chrome: null, spa: null, build, head: null, ...over,
});
const dom = (page: { html: string }) => new JSDOM(page.html).window.document;

describe('assembleReaderPage', () => {
  it('places the request\'s story, never re-rendering it: the story input is what appears', () => {
    const page = assembleReaderPage(input({ story: '<div class="mx-doc"><b id="with-data">$744,503</b></div>' }));
    expect(dom(page).querySelector('#mx-story-root #with-data')?.textContent).toBe('$744,503');
    expect(page.html).not.toContain('Title &amp; more');
  });

  it('is a whole document around the compiled story, with the sheet once and the fonts preloaded', () => {
    const page = assembleReaderPage(input());
    expect(page.html.startsWith('<!doctype html>')).toBe(true);
    const doc = dom(page);
    expect(doc.title).toBe('Perf <C> dashboard');
    expect(doc.querySelector('link[rel="preload"][as="font"]')?.getAttribute('href')).toBe('/fonts/inter.woff2');
    const root = doc.querySelector('#mx-story-root[data-mx-inline-story]')!;
    expect(root.className).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('industry');
    expect(root.querySelector('h1#h')?.textContent).toBe('Title & more');
    expect([...doc.querySelectorAll('style')].filter((s) => s.textContent?.includes('.mx-doc{color:red}'))).toHaveLength(1);
  });

  it('emits no inline script: the data rides as JSON and every script has a same-origin src', () => {
    const doc = dom(assembleReaderPage(input({ spa: { entry: '/assets/main-abc.js', preload: ['/assets/vendor-def.js'] }, chrome: { artifactId: 'X34b00', title: 't', author: null } })));
    for (const script of doc.querySelectorAll('script')) {
      if (script.type === 'application/json') continue;
      expect(script.type, script.outerHTML).toBe('module');
      expect(script.getAttribute('src'), script.outerHTML).toMatch(/^\/(islands|assets)\//);
      expect(script.textContent).toBe('');
    }
    const data = JSON.parse(doc.getElementById(ISLAND_DATA_ID)!.textContent!);
    expect(data.values).toEqual({ region: 'West' });
    expect(data.results.tables.monthly.rows).toEqual([{ revenue: 1 }]);
    expect(data.queryUrl).toBe('/a/X34b00/query');
    expect(data.viewerUrl).toBe('/a/X34b00/viewer');
    expect(data.signedIn).toBe(false);
  });

  it('preloads and imports the per-document module and its shared closure, and boots nothing on a page without islands', () => {
    const doc = dom(assembleReaderPage(input()));
    const preloads = [...doc.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.getAttribute('href'));
    expect(preloads).toEqual(expect.arrayContaining(['/islands/d/aaaaaaaaaaaaaaaa.js', '/islands/rt-4444dddd.js', '/islands/web-2222bbbb.js']));
    expect(doc.querySelector('script[type="module"][src="/islands/d/aaaaaaaaaaaaaaaa.js"]')).toBeTruthy();
    const still = dom(assembleReaderPage(input({ compiled: compiled({ islands: [], module: null, ssr: null }), story: compiled({ islands: [] }).html, snapshot: null })));
    expect(still.querySelectorAll('script[type="module"]')).toHaveLength(0);
    expect(still.getElementById(ISLAND_DATA_ID)).toBeNull();
  });

  it('puts the snapshot\'s drawing in its chart slot and marks it ready; leaves the skeleton when none is stored', () => {
    const drawn = dom(assembleReaderPage(input())).querySelector(`[${CHART_SLOT_ATTR}="AVkX"]`)!;
    expect(drawn.getAttribute('data-mx-chart-state')).toBe('ready');
    expect(drawn.querySelector('svg[data-drawn]')).toBeTruthy();
    const bare = dom(assembleReaderPage(input({ snapshot: null }))).querySelector(`[${CHART_SLOT_ATTR}="AVkX"]`)!;
    expect(bare.getAttribute('data-mx-chart-state')).not.toBe('ready');
    expect(bare.querySelector('.skeleton')).toBeTruthy();
  });

  it('renders the chrome and the idle SPA loader for /a/:id, and neither for /raw', () => {
    const page = dom(assembleReaderPage(input({ chrome: { artifactId: 'X34b00', title: 'Perf', author: { username: 'sree' } }, spa: { entry: '/assets/main-abc.js', preload: ['/assets/vendor-def.js'] } })));
    expect(page.querySelector('[data-mx-artifact-id="X34b00"]')).toBeTruthy();
    const loader = page.querySelector(`script[type="module"][${SPA_IDLE_ATTR}]`)!;
    expect(loader.getAttribute('src')).toBe('/assets/main-abc.js');
    expect([...page.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.getAttribute('href'))).toContain('/assets/vendor-def.js');
    const raw = dom(assembleReaderPage(input()));
    expect(raw.querySelector('[data-mx-artifact-id]')).toBeNull();
    expect(raw.querySelector(`[${SPA_IDLE_ATTR}]`)).toBeNull();
  });

  it('emits the link hints: prefetch links in the head, prerender rules as the Speculation-Rules header, never an inline rules script', () => {
    const page = assembleReaderPage(input());
    const doc = dom(page);
    expect(doc.querySelector('link[rel="prefetch"][href="/a/Btruq6"]')).toBeTruthy();
    expect(doc.querySelector('script[type="speculationrules"]')).toBeNull();
    expect(page.headers[SPECULATION_RULES_HEADER]).toMatch(/^"\/islands\/s\/[0-9a-f]{16}\.json"$/);
    const none = assembleReaderPage(input({ compiled: compiled({ links: { prefetch: [], prerender: [] } }) }));
    expect(none.headers[SPECULATION_RULES_HEADER]).toBeUndefined();
  });

  it('never lets a title, a value or a drawing break out of its element', () => {
    const page = assembleReaderPage(input({ title: '</title><script>alert(1)</script>', overlay: { ...input().overlay, values: { region: '</script><script>alert(2)</script>' } } }));
    expect(page.html).not.toContain('<script>alert(1)');
    expect(page.html).not.toContain('</script><script>alert(2)');
    expect(dom(page).title).toBe('</title><script>alert(1)</script>');
  });
});
