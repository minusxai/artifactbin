/**
 * The head half of lib/document's interface: the Helmet's declarations and context reference, the title, the
 * social preview, the CSP origin sets and the asset URLs a document's external sources map to.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalAssetUrl, CSP_DIRECTIVES, cspOriginMatches, dataflowOf, declarationsOf, displayTitle, emptyCspExtensions,
  EMPTY_CSP_EXTENSIONS, firstHeadingTitle, hasCspExtensions, mergeCspExtensions, parseCspOrigin, socialPreviewImage,
  socialPreviewImageValue, SOCIAL_PREVIEW_OVERVIEW_GENERATION, subtractCspExtensions, urlHash, assetUrlFor,
} from '..';
import { CONTEXT_TAG, contextRefOf, declaresMutations, EMPTY_HELMET_CONTENT, HELMET_TAG } from '../helmet';
import { rowTitle, UNTITLED } from '../display-title';
import {
  clampImageCrop, defaultImageCrop, imageCropMaxWidth, SOCIAL_PREVIEW_HEIGHT, SOCIAL_PREVIEW_MIN_CROP_WIDTH,
  SOCIAL_PREVIEW_WIDTH, writeSocialPreviewImage,
} from '../social-preview';
import { externalCssUrls, isWebUrl, mapExternalCssUrls } from '../asset-url';

describe('Helmet declarations', () => {
  const source = '<Helmet><Value name="n" type="number" default={1} /><Query name="q">{`select $n as v`}</Query>'
    + '<Mutation name="m">{`update t set v = 1`}</Mutation></Helmet><p>{$n}</p>';

  it('names the two Helmet tags and an empty content with every list present', () => {
    expect(HELMET_TAG).toBe('Helmet');
    expect(CONTEXT_TAG).toBe('Context');
    expect(EMPTY_HELMET_CONTENT).toEqual({ title: null, style: null, script: null, meta: [], imports: [], values: [], queries: [], mutations: [] });
  });

  it('reads the data declarations of a source, and null when it does not parse', () => {
    const flow = declarationsOf(source)!;
    expect(flow.values.map((v) => v.name)).toEqual(['n']);
    expect(flow.queries.map((q) => q.name)).toEqual(['q']);
    expect(flow.mutations.map((m) => m.name)).toEqual(['m']);
    expect(flow).not.toHaveProperty('notifications');
    expect(declarationsOf('<Helmet><Value')).toBeNull();
    expect(declarationsOf('<p>plain</p>')).toEqual({ imports: [], values: [], queries: [], mutations: [] });
  });

  it('dataflowOf carries notifications only when there are some', () => {
    expect(dataflowOf(EMPTY_HELMET_CONTENT)).toEqual({ imports: [], values: [], queries: [], mutations: [] });
    const notify = { name: 'n', on: 'm', sql: 'select 1', start: 0, end: 1 };
    expect(dataflowOf({ ...EMPTY_HELMET_CONTENT, notifications: [notify] })).toMatchObject({ notifications: [notify] });
    expect(dataflowOf({ ...EMPTY_HELMET_CONTENT, notifications: [] })).not.toHaveProperty('notifications');
  });

  it('declaresMutations answers for a declared <Mutation> only', () => {
    expect(declaresMutations(source)).toBe(true);
    expect(declaresMutations('<Helmet><Query name="q">{`select 1`}</Query></Helmet>')).toBe(false);
    expect(declaresMutations('<Helmet><Mutation')).toBe(false);
    expect(declaresMutations('')).toBe(false);
    expect(declaresMutations(null)).toBe(false);
    expect(declaresMutations(undefined)).toBe(false);
  });

  it('contextRefOf reads the companion document, and nothing from a malformed draft', () => {
    expect(contextRefOf('<Helmet><Context src="ref:abc123" /></Helmet><p>x</p>')).toBe('abc123');
    expect(contextRefOf('<Helmet><title>t</title></Helmet><p>x</p>')).toBeNull();
    expect(contextRefOf('<Helmet><Context src="ref:abc123" />')).toBeNull();
  });
});

describe('titles', () => {
  it('firstHeadingTitle reads the first heading as text: entities decoded, tags and brackets out', () => {
    expect(firstHeadingTitle('<div><h2>Sales &amp; <em>growth</em></h2><h1>Later</h1></div>')).toBe('Sales & growth');
    expect(firstHeadingTitle('<h1>&lt;script&gt;x</h1>')).toBe('scriptx');
    expect(firstHeadingTitle('<h1>Héllo 👋 wörld</h1>')).toBe('Héllo 👋 wörld');
  });

  it('a computed heading has no title, and its static text survives', () => {
    expect(firstHeadingTitle('<h1>{$name}</h1>')).toBeNull();
    expect(firstHeadingTitle('<h1>Report {$year}</h1>')).toBe('Report');
  });

  it('reads a Markdown heading, and null without any heading', () => {
    expect(firstHeadingTitle('<Markdown id="m">{`intro\n\n## From **Markdown**`}</Markdown>')).toBe('From Markdown');
    expect(firstHeadingTitle('<p>no heading</p>')).toBeNull();
    expect(firstHeadingTitle('')).toBeNull();
    expect(firstHeadingTitle(null)).toBeNull();
    expect(firstHeadingTitle(undefined)).toBeNull();
    expect(firstHeadingTitle('<h1>   </h1>')).toBeNull();
  });

  it('caps a title at 120 characters', () => {
    expect(firstHeadingTitle(`<h1>${'a'.repeat(300)}</h1>`)).toHaveLength(120);
  });

  it('rowTitle prefers a non-blank title, then the heading, then Untitled', () => {
    expect(UNTITLED).toBe('Untitled');
    expect(rowTitle({ title: ' Mine ', heading: 'H' })).toBe('Mine');
    expect(rowTitle({ title: '   ', heading: 'H' })).toBe('H');
    expect(rowTitle({ title: null, heading: '' })).toBe('Untitled');
    expect(rowTitle({})).toBe('Untitled');
  });

  it('displayTitle derives the heading from source, or uses the one carried', () => {
    expect(displayTitle({ title: 'T', source: '<h1>H</h1>' })).toBe('T');
    expect(displayTitle({ title: '', source: '<h1>H</h1>' })).toBe('H');
    expect(displayTitle({ source: '<p>x</p>', heading: 'ignored' })).toBe('Untitled');
    expect(displayTitle({ heading: 'Carried' })).toBe('Carried');
    expect(displayTitle({})).toBe('Untitled');
  });
});

describe('social preview', () => {
  it('pins the preview geometry', () => {
    expect([SOCIAL_PREVIEW_WIDTH, SOCIAL_PREVIEW_HEIGHT, SOCIAL_PREVIEW_MIN_CROP_WIDTH]).toEqual([1600, 840, 400]);
    expect(SOCIAL_PREVIEW_OVERVIEW_GENERATION).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(SOCIAL_PREVIEW_OVERVIEW_GENERATION)).toBe(true);
  });

  it('reads the uploaded image value raw, and its id only when it is a reference', () => {
    const source = writeSocialPreviewImage('<Helmet><title>t</title></Helmet><p>x</p>', 'img_1-A');
    expect(socialPreviewImageValue(source)).toBe('ref:img_1-A');
    expect(socialPreviewImage(source)).toBe('img_1-A');
    const raw = source.replace('ref:img_1-A', 'https://x.test/a.png');
    expect(socialPreviewImageValue(raw)).toBe('https://x.test/a.png');
    expect(socialPreviewImage(raw)).toBeNull();
    expect(socialPreviewImageValue('<p>none</p>')).toBeNull();
    expect(socialPreviewImageValue(writeSocialPreviewImage(source, null))).toBeNull();
  });

  it('refuses to write an image id outside the reference alphabet', () => {
    expect(() => writeSocialPreviewImage('<p>x</p>', 'a"b')).toThrow('Invalid image reference');
  });

  it('imageCropMaxWidth is the full width for a tall image and scales down for a short one', () => {
    expect(imageCropMaxWidth(840)).toBe(1600);
    expect(imageCropMaxWidth(5000)).toBe(1600);
    expect(imageCropMaxWidth(420)).toBe(800);
    expect(imageCropMaxWidth(0)).toBe(0);
  });

  it('defaultImageCrop centres the widest crop, and clampImageCrop keeps a crop inside the image', () => {
    expect(defaultImageCrop(840)).toEqual({ x: 0, y: 0, width: 1600 });
    expect(defaultImageCrop(420)).toEqual({ x: 400, y: 0, width: 800 });
    expect(clampImageCrop({ x: -10, y: -10, width: 5000 }, 2000)).toEqual({ x: 0, y: 0, width: 1600 });
    expect(clampImageCrop({ x: 9999, y: 9999, width: 10 }, 2000)).toEqual({ x: 1200, y: 2000 - 210, width: 400 });
    expect(clampImageCrop({ x: 0, y: 0, width: 400 }, 105).width).toBe(200);
  });
});

describe('CSP origin sets', () => {
  const set = (connect: string[], img: string[] = []) => ({ ...emptyCspExtensions(), connect, img });

  it('names the six directives, and a fresh empty set is mutable and independent', () => {
    expect(CSP_DIRECTIVES).toEqual(['connect', 'script', 'style', 'img', 'frame', 'media']);
    const a = emptyCspExtensions();
    a.connect.push('https://a.test');
    expect(emptyCspExtensions().connect).toEqual([]);
    expect(Object.keys(a)).toEqual([...CSP_DIRECTIVES]);
    expect(Object.isFrozen(EMPTY_CSP_EXTENSIONS)).toBe(true);
  });

  it('hasCspExtensions answers for any directive asking for anything', () => {
    expect(hasCspExtensions(emptyCspExtensions())).toBe(false);
    expect(hasCspExtensions(EMPTY_CSP_EXTENSIONS)).toBe(false);
    for (const d of CSP_DIRECTIVES) expect(hasCspExtensions({ ...emptyCspExtensions(), [d]: ['https://a.test'] }), d).toBe(true);
  });

  it('subtract is what a asks for that b does not hold, and undoes a merge', () => {
    const a = set(['https://a.test', 'https://b.test'], ['https://i.test']);
    const b = set(['https://b.test']);
    expect(subtractCspExtensions(a, b)).toEqual(set(['https://a.test'], ['https://i.test']));
    expect(subtractCspExtensions(a, a)).toEqual(emptyCspExtensions());
    expect(subtractCspExtensions(mergeCspExtensions(b, a), b)).toEqual(subtractCspExtensions(a, b));
  });

  it('cspOriginMatches: exact, or a wildcard admitting any subdomain depth on the same port', () => {
    expect(cspOriginMatches('https://api.test', 'https://api.test')).toBe(true);
    expect(cspOriginMatches('https://*.example.com', 'https://a.example.com')).toBe(true);
    expect(cspOriginMatches('https://*.example.com', 'https://a.b.example.com')).toBe(true);
    expect(cspOriginMatches('https://*.example.com:8443', 'https://a.example.com:8443')).toBe(true);
  });

  it.each([
    ['https://*.example.com', 'https://example.com'],
    ['https://*.example.com', 'https://evilexample.com'],
    ['https://*.example.com', 'http://a.example.com'],
    ['https://*.example.com', 'https://a.example.com:8443'],
    ['https://*.example.com:8443', 'https://a.example.com'],
    ['https://*.example.com', 'https://a.example.com/path'],
    ['https://*.example.com', 'not a url'],
    ['https://api.test', 'https://API.test'],
  ])('cspOriginMatches(%s, %s) is false', (declared, origin) => {
    expect(cspOriginMatches(declared, origin)).toBe(false);
  });

  it('every origin parseCspOrigin writes matches itself', () => {
    for (const written of ['https://a.test', 'https://*.b.test', 'https://c.test:444']) {
      const parsed = parseCspOrigin(written);
      expect(parsed.ok && cspOriginMatches(parsed.origin, parsed.origin)).toBe(true);
    }
  });
});

describe('asset URLs', () => {
  it('canonicalAssetUrl applies WHATWG normalization, and passes a non-URL through', () => {
    expect(canonicalAssetUrl('HTTPS://Example.COM:443/a b')).toBe('https://example.com/a%20b');
    expect(canonicalAssetUrl('http://x.test')).toBe('http://x.test/');
    expect(canonicalAssetUrl('not a url')).toBe('not a url');
    expect(canonicalAssetUrl('')).toBe('');
  });

  it('urlHash is the sha256 of the canonical URL, so spelling variants share one key', () => {
    expect(urlHash('https://x.test/a.png')).toMatch(/^[0-9a-f]{64}$/);
    expect(urlHash('HTTPS://X.TEST:443/a.png')).toBe(urlHash('https://x.test/a.png'));
    expect(urlHash('https://x.test/b.png')).not.toBe(urlHash('https://x.test/a.png'));
    expect(assetUrlFor('https://x.test/a.png')).toBe(`/assets/${urlHash('https://x.test/a.png')}`);
  });

  it('isWebUrl is true for an absolute http(s) source only', () => {
    expect(isWebUrl('https://x.test')).toBe(true);
    expect(isWebUrl('HTTP://x.test')).toBe(true);
    for (const value of ['//x.test', '/a.png', 'ref:abc', 'data:image/png;base64,AA', 'ftp://x.test', '']) expect(isWebUrl(value), value).toBe(false);
  });

  it('externalCssUrls reads each absolute url() once, in order, any quoting', () => {
    const css = `a{background:url(https://x.test/a.png)} b{background:url("https://x.test/b.png")} c{src:url( 'https://x.test/a.png' )} d{background:url(/local.png)} e{background:url(data:x)}`;
    expect(externalCssUrls(css)).toEqual(['https://x.test/a.png', 'https://x.test/b.png']);
    expect(externalCssUrls('')).toEqual([]);
  });

  it('mapExternalCssUrls rewrites only what the lookup holds, keeping the quote', () => {
    const css = `a{background:url("https://x.test/a.png")} b{background:url(https://x.test/b.png)}`;
    const mapped = mapExternalCssUrls(css, (url) => url.endsWith('a.png'));
    expect(mapped).toBe(`a{background:url("${assetUrlFor('https://x.test/a.png')}")} b{background:url(https://x.test/b.png)}`);
    expect(mapExternalCssUrls(css, () => null)).toBe(css);
    expect(externalCssUrls(mapped)).toEqual(['https://x.test/b.png']);
  });
});
