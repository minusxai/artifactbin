// DESTINATION: services/app/lib/compiled-page/__tests__/assembler.test.ts
/**
 * ONE assembler for every reader path (docs/phase2-architecture.md §2.2, §9; contract AssembleInput):
 * the same compiled page becomes the standalone document (`/raw`, which the app page frames on the
 * document's own origin; a domain post; a capture) with no inline script anywhere, the island data as JSON, the snapshot's drawings in the chart slots, and the
 * per-document module preloaded and imported.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { assembleReaderPage } from '../assembler';
import { documentStyleSheets } from '@/lib/page-styles/document-styles';
import { SPECULATION_RULES_HEADER, type AssembleInput, type CompiledPage } from '../contract';
import type { DataSnapshot } from '@/lib/publish/prepared/snapshots.server';
import { CHART_SLOT_ATTR, ISLAND_DATA_ID } from '@/lib/story-runtime/contract';

const build = { id: 'b'.repeat(16), manifest: { 'solid-js': '/islands/solid-1111aaaa.js', 'solid-js/web': '/islands/web-2222bbbb.js', 'solid-js/store': '/islands/store-3333cccc.js', '@mx/rt': '/islands/rt-4444dddd.js', '@mx/boot': '/islands/boot-5555eeee.js', '@mx/deck': '/islands/deck-6666ffff.js' } };
const compiled = (over: Partial<CompiledPage> = {}): CompiledPage => ({
  build: build.id,
  outline: [], outlinePlan: false,
  html: `<div class="mx-doc"><h1 id="h">Title &amp; more</h1><div data-hk="s0-0" id="G2uA">select</div><div id="AVkX" ${CHART_SLOT_ATTR}="AVkX"><div class="skeleton"></div></div></div>`,
  islands: [{ renderId: 's0-', path: '0.1', kit: ['Select'], readsData: true }],
  module: { sha: 'a'.repeat(16), url: '/islands/d/aaaaaaaaaaaaaaaa.js', bytes: 512, imports: ['/islands/rt-4444dddd.js', '/islands/web-2222bbbb.js'] },
  ssr: { sha: 'c'.repeat(16), url: '/islands/d/cccccccccccccccc.js', bytes: 700, imports: [] },
  behaviors: [], plan: null, readsViewerMarkup: false, links: { prefetch: ['/a/Btruq6'], prerender: ['/a/Btruq6'] }, kit: { skeleton: [], islands: ['Select'] }, reactStatic: ['Card'], unported: [], partial: [], authorScript: null,
  ...over,
});
const snapshot: DataSnapshot = { key: { artifactId: 'X34b00', slot: 'head', planKey: 'p', inputsKey: 'i' }, marks: { sales: 'm' }, results: { tables: { monthly: { rows: [{ revenue: 1 }], columns: [{ name: 'revenue', type: 'number' }] } }, errors: {} }, drawings: { AVkX: { svg: '<svg data-drawn="1"></svg>', table: 'monthly', rows: 'r' } }, computedAt: 1, build: build.id };
const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  compiled: compiled(), story: compiled().html, css: '.mx-doc{color:red}', fontPreloads: ['/fonts/inter.woff2'], title: 'Perf <C> dashboard', theme: 'industry', colorMode: 'light', snapshot,
  overlay: { values: { region: 'West' }, mermaidImages: {}, signedIn: false, doors: { queryUrl: '/a/X34b00/query', assetsUrl: '/a/X34b00/assets', viewerUrl: '/a/X34b00/viewer' } },
  build, head: null, ...over,
});
const dom = (page: { html: string }) => new JSDOM(page.html).window.document;

describe('assembleReaderPage', () => {
  it('uses immutable compiled carriers when request-specific SSR supplies only the visible story', () => {
    const compiledHtml = '<div class="mx-doc">seed</div><script type="application/json" data-mx-island-literals="aaaaaaaaaaaaaaaa">["chart"]</script><script type="application/json" data-mx-module-data>{"moduleData":[{"rows":[1]}]}</script>';
    const page = assembleReaderPage(input({ compiled: compiled({ html: compiledHtml }), story: '<div class="mx-doc"><p id="request">request values</p></div>' }));
    const doc = dom(page);
    expect(doc.querySelector('#mx-story-root #request')?.textContent).toBe('request values');
    expect(doc.querySelector('#mx-story-root [data-mx-island-literals]')).toBeNull();
    expect(doc.querySelector('script[data-mx-island-literals="aaaaaaaaaaaaaaaa"]')?.textContent).toBe('["chart"]');
    expect(JSON.parse(doc.getElementById(ISLAND_DATA_ID)!.textContent!).moduleData).toEqual([{ rows: [1] }]);
  });

  it('keeps inert island banks while moving the trailing module data carrier', () => {
    const story = '<div class="mx-doc">visible</div><template data-mx-island-template="abc">&lt;p&gt;later&lt;/p&gt;</template><script type="application/json" data-mx-island-literals="def">["label"]</script><script type="application/json" data-mx-module-data>{"moduleData":[{"rows":[1]}]}</script>';
    const page = assembleReaderPage(input({ story }));
    const doc = dom(page);
    expect(doc.querySelector('template[data-mx-island-template="abc"]')).toBeTruthy();
    expect(doc.querySelector('script[data-mx-island-literals="def"]')).toBeTruthy();
    expect(doc.querySelector('script[data-mx-module-data]')).toBeNull();
    expect(JSON.parse(doc.getElementById(ISLAND_DATA_ID)!.textContent!).moduleData).toEqual([{ rows: [1] }]);
  });
  it('moves version constants into the one inert page data island, including hostile text', () => {
    const value = '</script><script>alert(1)</script>';
    const carrier = `<script type="application/json" data-mx-module-data>${JSON.stringify({ moduleData: [{ value }] }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')}</script>`;
    const page = assembleReaderPage(input({ story: `<div class="mx-doc"><p>visible</p></div>${carrier}` }));
    const doc = dom(page);
    expect(doc.querySelector('[data-mx-module-data]')).toBeNull();
    expect(doc.querySelector('#mx-story-root p')?.textContent).toBe('visible');
    expect(JSON.parse(doc.getElementById(ISLAND_DATA_ID)!.textContent!).moduleData).toEqual([{ value }]);
    expect(page.html).not.toContain('</script><script>alert');
  });
  it('serves the outline beside the column with legacy markup before the SPA loads', () => {
    const entries = [{ level: 2 as const, title: 'One & all', path: '0.0' }, { level: 3 as const, title: 'Part', path: '0.1' }];
    const page = assembleReaderPage(input({ compiled: compiled({ outline: entries, outlinePlan: true }), story: '<div class="mx-doc"><h2 data-mx-ast="0.0">One &amp; all</h2></div>' }));
    const doc = dom(page);
    const reading = doc.querySelector('#mx-story-root > .mx-reading.mx-reading--plan')!;
    expect(reading.children[0]?.outerHTML).toBe('<nav class="mx-outline" aria-label="Contents"><div class="mx-outline-label">Contents</div><button type="button" class="mx-outline-row" aria-label="Go to section 1: One &amp; all" data-mx-target="0.0">One &amp; all</button><button type="button" class="mx-outline-row mx-outline-sub" aria-label="Go to Part" data-mx-target="0.1">Part</button></nav>');
    expect(reading.children[1]?.className).toBe('mx-doc');
    expect(dom(assembleReaderPage(input())).querySelector('.mx-outline')).toBeNull();
  });
  it('keeps a hidden outline host in a blank doc so typing never reparents the focused column', () => {
    const options = { compiled: compiled({ outlineDoc: true }), story: '<div class="mx-doc mx-doc--document"><h1></h1></div>' };
    const doc = dom(assembleReaderPage(input(options)));
    expect(doc.querySelector('.mx-reading > .mx-outline')?.hasAttribute('hidden')).toBe(true);
    expect(doc.querySelector('.mx-reading > .mx-doc--document')).toBeTruthy();
    expect(dom(assembleReaderPage(input({ ...options, documentChrome: false }))).querySelector('.mx-outline')).toBeNull();
  });
  it('preserves a line of height for empty doc paragraphs in reading and capture output', () => {
    for (const documentChrome of [true, false]) {
      const doc = dom(assembleReaderPage(input({ documentChrome,
        sheets: documentStyleSheets({ compiledCss: null, chrome: documentChrome, bare: false, theme: null, docFonts: { slots: {}, families: [] }, systemCss: '', authorCss: 'p { font-size: 16px; line-height: 24px; }' }),
        story: '<div class="mx-doc mx-doc--document"><article><p id="blank"></p><p id="body">Text</p></article></div>',
      })));
      // jsdom resolves lh against its fallback metrics; the browser gate checks exact geometry.
      expect(parseFloat(doc.defaultView!.getComputedStyle(doc.getElementById('blank')!).minHeight)).toBeGreaterThan(0);
      expect(doc.defaultView!.getComputedStyle(doc.getElementById('body')!).minHeight).toBe('auto');
      expect(doc.getElementById('blank')!.innerHTML).toBe('');
    }
  });
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
    const doc = dom(assembleReaderPage(input({ compiled: compiled({ templateBrBytes: 1300 }) })));
    for (const script of doc.querySelectorAll('script')) {
      if (script.type === 'application/json') continue;
      expect(script.type, script.outerHTML).toBe('module');
      expect(script.getAttribute('src'), script.outerHTML).toMatch(/^\/islands\//);
      expect(script.textContent).toBe('');
    }
    const data = JSON.parse(doc.getElementById(ISLAND_DATA_ID)!.textContent!);
    expect(data.values).toEqual({ region: 'West' });
    expect(data.templateBrBytes).toBe(1300);
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

  it('carries the version\'s author script as inert data only: in the JSON island, escaped, never as a script', () => {
    const script = 'mx.set({n:1}); "</script><script>alert(1)</script>" \u2028';
    const page = assembleReaderPage(input({ compiled: compiled({ authorScript: script }) }));
    const doc = dom(page);
    expect(JSON.parse(doc.getElementById(ISLAND_DATA_ID)!.textContent!).authorScript).toBe(script);
    expect(page.html).not.toContain('</script><script>alert');
    expect(page.html.split('mx.set({n:1})')).toHaveLength(2);
    for (const el of doc.querySelectorAll('script')) if (el.type !== 'application/json') expect(el.textContent, el.outerHTML).toBe('');
    expect(doc.querySelectorAll('script:not([type="application/json"]):not([src])')).toHaveLength(0);
    // A version without one names none.
    expect(JSON.parse(dom(assembleReaderPage(input())).getElementById(ISLAND_DATA_ID)!.textContent!)).not.toHaveProperty('authorScript');
  });

  it('puts the snapshot\'s drawing in its chart slot and marks it ready; leaves the skeleton when none is stored', () => {
    const drawn = dom(assembleReaderPage(input())).querySelector(`[${CHART_SLOT_ATTR}="AVkX"]`)!;
    expect(drawn.getAttribute('data-mx-chart-state')).toBe('ready');
    expect(drawn.querySelector('svg[data-drawn]')).toBeTruthy();
    const bare = dom(assembleReaderPage(input({ snapshot: null }))).querySelector(`[${CHART_SLOT_ATTR}="AVkX"]`)!;
    expect(bare.getAttribute('data-mx-chart-state')).not.toBe('ready');
    expect(bare.querySelector('.skeleton')).toBeTruthy();
  });

  it('is the standalone document only: no reader chrome, no app entry, and its links leave the frame', () => {
    const page = dom(assembleReaderPage(input()));
    expect(page.querySelector('[data-mx-reader-chrome], [data-mx-artifact-id]')).toBeNull();
    expect(page.querySelector('[data-mx-spa-idle]')).toBeNull();
    expect(page.querySelector('base')?.getAttribute('target')).toBe('_top');
    expect([...page.querySelectorAll('script[src]')].every((s) => s.getAttribute('src')!.startsWith('/islands/'))).toBe(true);
  });

  it('emits the link hints as speculation rules only, on hover/press intent — never an eager prefetch tag or an inline rules script', () => {
    const page = assembleReaderPage(input());
    const doc = dom(page);
    // Every hint (prefetch's full list, prerender's first few) waits for intent inside the
    // rules file the Speculation-Rules header names; no <link rel="prefetch"> loads on parse.
    expect(doc.querySelector('link[rel="prefetch"]')).toBeNull();
    expect(doc.querySelector('script[type="speculationrules"]')).toBeNull();
    expect(page.headers[SPECULATION_RULES_HEADER]).toMatch(/^"\/islands\/s\/[0-9a-f]{16}\.json"$/);
    const none = assembleReaderPage(input({ compiled: compiled({ links: { prefetch: [], prerender: [] } }) }));
    expect(none.headers[SPECULATION_RULES_HEADER]).toBeUndefined();
  });

  it('writes the live identity on <body>, escaped, and none when the input has none', () => {
    const live = dom(assembleReaderPage(input({ live: { id: 'X34b00', editId: 'e"1' } })));
    expect(live.body.getAttribute('data-mx-live-id')).toBe('X34b00');
    expect(live.body.getAttribute('data-mx-live-edit')).toBe('e"1');
    const captured = dom(assembleReaderPage(input()));
    expect(captured.body.hasAttribute('data-mx-live-id')).toBe(false);
    expect(captured.body.hasAttribute('data-mx-live-edit')).toBe(false);
  });

  it('places a footer after the story root, never inside it, with its CSS in the head', () => {
    const doc = dom(assembleReaderPage(input({ footer: { html: '<footer data-mx-domain-footer="">Made with <a href="https://app.example/a/X34b00">artifactbin</a></footer>', css: '[data-mx-domain-footer]{opacity:.65}' } })));
    const footer = doc.querySelector('[data-mx-domain-footer]')!;
    expect(footer.parentElement).toBe(doc.body);
    expect(doc.getElementById('mx-story-root')!.contains(footer)).toBe(false);
    expect(doc.getElementById('mx-story-root')!.compareDocumentPosition(footer) & 4 /* FOLLOWING */).toBeTruthy();
    expect([...doc.head.querySelectorAll('style')].some((s) => s.textContent?.includes('[data-mx-domain-footer]{opacity:.65}'))).toBe(true);
  });

  it('never lets a title, a value or a drawing break out of its element', () => {
    const page = assembleReaderPage(input({ title: '</title><script>alert(1)</script>', overlay: { ...input().overlay, values: { region: '</script><script>alert(2)</script>' } } }));
    expect(page.html).not.toContain('<script>alert(1)');
    expect(page.html).not.toContain('</script><script>alert(2)');
    expect(dom(page).title).toBe('</title><script>alert(1)</script>');
  });
});
