/**
 * The assembler beyond its seed: purity, the no-inline-script rule over every path and hostile
 * overlay, chart slots found by structure (never by a look-alike string), and drawings placed only
 * when they are one inert <svg> (lib/compiled-page/assembler; spec §2.2, §9).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { assembleReaderPage, isInertSvg, scriptJson } from '../assembler';
import { speculationRulesOf } from '../speculation';
import { CHART_SLOT_ATTR, ISLAND_DATA_ID, SIGNED_IN_HINT_ATTR, SPA_IDLE_ATTR, SPECULATION_RULES_HEADER, type AssembleInput, type CompiledPage, type DataSnapshot } from '../contract';

const build = { id: 'b'.repeat(16), manifest: { '@mx/rt': '/islands/rt-4444dddd.js', '@mx/deck': '/islands/deck-6666ffff.js' } };
const compiled = (over: Partial<CompiledPage> = {}): CompiledPage => ({
  build: build.id, html: '', islands: [{ renderId: 's0-', path: '0', kit: ['Question'], readsData: true }],
  module: { sha: 'a'.repeat(16), url: '/islands/d/aaaaaaaaaaaaaaaa.js', bytes: 1, imports: ['/islands/rt-4444dddd.js'] },
  ssr: null, behaviors: [], plan: null, links: { prefetch: [], prerender: [] }, kit: { skeleton: [], islands: [] }, reactStatic: [], unported: [], partial: [], ...over,
});
const snapshot = (drawings: DataSnapshot['drawings']): DataSnapshot => ({
  key: { artifactId: 'X', slot: 'head', planKey: 'p', inputsKey: 'i' }, marks: {}, results: { tables: {}, errors: {} }, drawings, computedAt: 1, build: build.id,
});
const drawn = (svg: string) => ({ svg, table: 't', rows: 'r' });
const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  compiled: compiled(), story: '<p>x</p>', css: '', fontPreloads: [], title: 't', theme: null, colorMode: 'dark', snapshot: null,
  overlay: { values: {}, mermaidImages: {}, signedIn: false, doors: { queryUrl: '/a/X/query', assetsUrl: '/a/X/assets' } },
  chrome: null, spa: null, build, ...over,
});
const doc = (html: string) => new JSDOM(html).window.document;
const SVG = '<svg viewBox="0 0 10 10" role="img"><g><rect width="1" height="1"></rect><text x="1">Q&amp;A</text></g></svg>';

describe('assembleReaderPage is pure', () => {
  it('returns the same bytes for the same input, and never mutates it', () => {
    const one = input({ snapshot: snapshot({ c: drawn(SVG) }), story: `<div ${CHART_SLOT_ATTR}="c"></div>` });
    const frozen = JSON.stringify(one);
    expect(assembleReaderPage(one)).toEqual(assembleReaderPage(one));
    expect(JSON.stringify(one)).toBe(frozen);
  });
});

describe('no inline script, whatever the request carries', () => {
  const hostile = '</script><script>alert(1)</script>\u2028\u2029<!--';
  const variants: Array<[string, Partial<AssembleInput>]> = [
    ['/raw', {}],
    ['/a/:id', { chrome: { artifactId: 'X', title: hostile, author: { username: hostile } }, spa: { entry: '/assets/main.js', preload: ['/assets/v.js'] } }],
    ['hostile overlay', { title: hostile, overlay: { values: { [hostile]: hostile }, mermaidImages: { [hostile]: { src: hostile, type: 'image/svg+xml', palette: hostile } }, signedIn: true, readOnly: hostile, doors: { queryUrl: hostile, assetsUrl: hostile, mutateUrl: hostile, viewerUrl: hostile } } }],
    ['hostile snapshot rows', { snapshot: { ...snapshot({}), results: { tables: { t: { rows: [{ v: hostile }], columns: [{ name: 'v', type: 'string' }] } }, errors: { t: hostile } } } }],
  ];
  for (const [name, over] of variants) {
    it(name, () => {
      const page = assembleReaderPage(input(over));
      const scripts = [...doc(page.html).querySelectorAll('script')];
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) {
        if (script.type === 'application/json') {
          expect(script.id).toBe(ISLAND_DATA_ID);
          expect(() => JSON.parse(script.textContent!)).not.toThrow();
          continue;
        }
        expect(script.type).toBe('module');
        expect(script.getAttribute('src')).toMatch(/^\/(islands|assets)\//);
        expect(script.textContent).toBe('');
      }
      // Every <script> the markup opens is one of the ones above: nothing smuggled as text or attribute.
      expect(page.html.match(/<script/gi)?.length).toBe(scripts.length);
    });
  }

  it('round-trips hostile values through the data island exactly', () => {
    const values = { v: '</script>\u2028<b>&amp;' };
    const data = JSON.parse(doc(assembleReaderPage(input({ overlay: { ...input().overlay, values } })).html).getElementById(ISLAND_DATA_ID)!.textContent!);
    expect(data.values).toEqual(values);
    expect(scriptJson(values)).not.toMatch(/[<>\u2028\u2029]/);
  });
});

describe('the page around the story', () => {
  it('stamps the signed-in hint, never the identity, and carries the read-only reason', () => {
    const page = doc(assembleReaderPage(input({ overlay: { ...input().overlay, signedIn: true, readOnly: 'Version 2 of 3' } })).html);
    expect(page.documentElement.hasAttribute(SIGNED_IN_HINT_ATTR)).toBe(true);
    const data = JSON.parse(page.getElementById(ISLAND_DATA_ID)!.textContent!);
    expect(data).toMatchObject({ signedIn: true, readOnly: 'Version 2 of 3', results: null, assetsUrl: '/a/X/assets' });
    expect(data.mutateUrl).toBeUndefined();
    expect(doc(assembleReaderPage(input()).html).documentElement.hasAttribute(SIGNED_IN_HINT_ATTR)).toBe(false);
  });

  it('loads a behaviour chunk from the shared manifest on a page with no islands, and no data island', () => {
    const page = doc(assembleReaderPage(input({ compiled: compiled({ islands: [], module: null, behaviors: ['@mx/deck'] }) })).html);
    expect([...page.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).toEqual(['/islands/deck-6666ffff.js']);
    expect(page.getElementById(ISLAND_DATA_ID)).toBeNull();
  });

  it('orders the SPA last: its preloads and idle entry follow the page\'s own module', () => {
    const html = assembleReaderPage(input({ chrome: { artifactId: 'X', title: 't', author: null }, spa: { entry: '/assets/main.js', preload: ['/assets/v.js'] } })).html;
    expect(html.indexOf('/islands/d/aaaaaaaaaaaaaaaa.js')).toBeLessThan(html.indexOf('/assets/v.js'));
    expect(html.indexOf('/assets/v.js')).toBeLessThan(html.indexOf(SPA_IDLE_ATTR));
    expect(html).not.toContain('<base');
    expect(assembleReaderPage(input()).html).toContain('<base target="_top">');
  });

  it('names exactly the rule file speculationRulesOf derives, and never a non-http hint', () => {
    const links = { prefetch: ['/a/One', 'javascript:alert(1)'], prerender: ['/a/One', 'javascript:alert(1)'] };
    const page = assembleReaderPage(input({ compiled: compiled({ links }) }));
    expect(page.headers[SPECULATION_RULES_HEADER]).toBe(`"${speculationRulesOf(links.prerender)!.url}"`);
    expect(JSON.parse(speculationRulesOf(links.prerender)!.text)).toEqual({ prerender: [{ source: 'list', urls: ['/a/One'], eagerness: 'moderate' }] });
    expect(page.html).not.toContain('javascript:');
  });
});

describe('chart slots', () => {
  const story = (slot: string) => `<section><div ${CHART_SLOT_ATTR}="${slot}" class="box"><div><div class="skeleton"></div></div></div><p id="after">after</p></section>`;
  const place = (html: string, drawings: DataSnapshot['drawings']) => doc(assembleReaderPage(input({ story: html, snapshot: snapshot(drawings) })).html);

  it('replaces exactly the slot\'s content, through nested elements, and leaves its siblings', () => {
    const page = place(story('c1'), { c1: drawn(SVG) });
    const slot = page.querySelector(`[${CHART_SLOT_ATTR}="c1"]`)!;
    expect(slot.getAttribute('data-mx-chart-state')).toBe('ready');
    expect(slot.className).toBe('box');
    expect(slot.children).toHaveLength(1);
    expect(slot.querySelector('svg text')?.textContent).toBe('Q&A');
    expect(page.querySelector('#after')?.parentElement?.tagName).toBe('SECTION');
  });

  it('matches the slot id as the browser reads the attribute, entities decoded', () => {
    const page = place(story('a&quot;b&amp;c'), { 'a"b&c': drawn(SVG) });
    expect(page.querySelector('svg')).toBeTruthy();
  });

  it('rewrites a declared state rather than adding a second one', () => {
    const html = `<div ${CHART_SLOT_ATTR}="c" data-mx-chart-state="pending"><i></i></div>`;
    const out = assembleReaderPage(input({ story: html, snapshot: snapshot({ c: drawn(SVG) }) })).html;
    expect(out.match(/data-mx-chart-state=/g)).toHaveLength(1);
    expect(out).toContain('data-mx-chart-state="ready"');
  });

  it('is not fooled by a slot look-alike in text, a comment, an attribute value or a raw-text element', () => {
    const lookalikes = `<p title="<div ${CHART_SLOT_ATTR}=&quot;c&quot;>">&lt;div ${CHART_SLOT_ATTR}="c"&gt;</p><!-- <div ${CHART_SLOT_ATTR}="c"></div> --><style>/* <div ${CHART_SLOT_ATTR}="c"></div> */</style>`;
    const html = `${lookalikes}<div ${CHART_SLOT_ATTR}="c"><span>skeleton</span></div>`;
    const out = assembleReaderPage(input({ story: html, snapshot: snapshot({ c: drawn(SVG) }) })).html;
    expect(out).toContain(lookalikes);
    expect(out.match(/<svg/g)).toHaveLength(1);
    expect(doc(out).querySelector(`div[${CHART_SLOT_ATTR}="c"] > svg`)).toBeTruthy();
  });

  it('keeps the skeleton for an unknown slot, a prototype key, or a drawing that is not one inert svg', () => {
    for (const [slot, drawings] of [
      ['c', { other: drawn(SVG) }],
      ['__proto__', {}],
      ['constructor', {}],
      ['c', { c: drawn('<svg><script>alert(1)</script></svg>') }],
      ['c', { c: drawn('</div><script>alert(1)</script>') }],
    ] as const) {
      const page = place(story(slot), drawings);
      const box = page.querySelector(`[${CHART_SLOT_ATTR}]`)!;
      expect(box.getAttribute('data-mx-chart-state'), `${slot}`).toBeNull();
      expect(box.querySelector('.skeleton')).toBeTruthy();
      expect(page.querySelector('#after')).toBeTruthy();
    }
  });
});

describe('isInertSvg', () => {
  it('admits what a chart renderer draws', () => {
    expect(isInertSvg(SVG)).toBe(true);
    expect(isInertSvg('<svg><a href="https://example.com/x"><path d="M0 0"/></a><image href="data:image/png;base64,AAAA"/><title>Sales &lt; 3</title></svg>')).toBe(true);
  });
  it('refuses markup that could run, escape or navigate', () => {
    for (const svg of [
      '<svg onload="alert(1)"></svg>',
      '<svg><foreignObject><div></div></foreignObject></svg>',
      '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><a xlink:href="java&#9;script:alert(1)"><text>x</text></a></svg>',
      '<svg><a href="jav&#x61;script:alert(1)"></a></svg>',
      '<svg><a href="javascript&colon;alert(1)"></a></svg>',
      '<svg><style>*{}</style></svg>',
      '<svg></svg><img src=x onerror=alert(1)>',
      '<svg><![CDATA[</svg><script>alert(1)</script>]]></svg>',
      '<div><svg></svg></div>',
      '<svg><g></svg>',
      '<svg><title></svg><img src=x onerror=alert(1)><svg></title></svg>',
    ]) expect(isInertSvg(svg), svg).toBe(false);
  });
});
