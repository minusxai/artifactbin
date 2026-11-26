/**
 * native-v1's image node, READ side only (native-schema.ts): the codec reads `<img src alt title>` from stored HTML with
 * lib/markdown's source rule, the shared state carries it, validation checks it, saving keeps it and Markdown reads
 * show it. Nothing writes a new one in this release: an agent's HTML revision keeps the images its base holds and
 * refuses any other, and the legacy migration refuses them as before.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '../../html-page';
import { applyRegionRevision, compactRegion, convertLegacyPage, createRegionState, openRegionDoc, regionHtml, regionMarkdown, validateRegionState, validateRegionUpdate } from '..';
import { readNativeHtml } from '../native-html';
import { nativeDocument } from '../native-state';

const kind = 'rich-native-v1';
const SAVED = '<p data-af-id="p1">See <img data-af-id="i1" src="ref:abcdef12" alt="A &amp; B" title="Chart"> and <img data-af-id="i2" src="https://i.example/p.png?a=1&amp;b=2" alt=""></p>';
const refusal = (run: () => unknown) => { try { run(); } catch (error) { return (error as { details?: string[] }).details; } return undefined; };

describe('reading an image', () => {
  it('reads from stored HTML only when asked, and writes it back in normal form', () => {
    expect(refusal(() => readNativeHtml(SAVED))).toEqual(['attribute src']);
    expect(refusal(() => readNativeHtml('<p><img></p>'))).toEqual(['node img']);
    const doc = readNativeHtml(SAVED, { images: true });
    const images: unknown[] = [];
    doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs); });
    expect(images).toEqual([
      { src: 'ref:abcdef12', alt: 'A & B', title: 'Chart', afId: 'i1' },
      { src: 'https://i.example/p.png?a=1&b=2', alt: '', title: null, afId: 'i2' },
    ]);
    expect(regionHtml(kind, createRegionState(kind, SAVED).state)).toBe(SAVED);
  });

  it.each([
    ['javascript:alert(1)', 'image source'], ['http://i.example/p.png', 'image source'], ['//host.example/p.png', 'image source'],
    ['data:image/png;base64,AA', 'image source'], ['', 'image source'],
  ])('refuses the source %j', (src, detail) => {
    expect(refusal(() => readNativeHtml(`<p><img src="${src}" alt="x"></p>`, { images: true }))).toEqual([detail]);
  });
  it('allows relative sources and uploads, as lib/markdown does', () => {
    for (const src of ['/a/x/raw', 'p.png', 'ref:abcdef12', 'https://i.example/p.png']) expect(() => readNativeHtml(`<p><img src="${src}"></p>`, { images: true })).not.toThrow();
  });
  it.each([
    ['an image inside a mark', '<p><a href="https://e.example"><img src="ref:abcdef12"></a></p>', 'image mark'],
    ['another attribute', '<p><img src="ref:abcdef12" onerror="x"></p>', 'attribute onerror'],
    ['a title past 512 characters', `<p><img src="ref:abcdef12" title="${'t'.repeat(513)}"></p>`, 'image title'],
    ['an image outside a textblock', '<img src="ref:abcdef12">', 'invalid native structure'],
  ])('refuses %s', (_name, html, detail) => {
    expect(refusal(() => readNativeHtml(html, { images: true }))).toEqual([detail]);
  });
});

describe('an image in the shared state', () => {
  it('round-trips through Yjs and passes the server\'s tree validation', () => {
    const { state } = createRegionState(kind, SAVED);
    const doc = openRegionDoc(state, { kind });
    expect(() => validateRegionState(kind, doc)).not.toThrow();
    const copy = openRegionDoc(Y.encodeStateAsUpdate(doc), { kind });
    expect(nativeDocument(copy).toJSON()).toEqual(readNativeHtml(SAVED, { images: true }).toJSON());
  });

  it.each([
    ['a refused source', { src: 'javascript:alert(1)', alt: 'x' }, 'image source'],
    ['a title past 512 characters', { src: 'ref:abcdef12', title: 't'.repeat(513) }, 'image title'],
    ['an attribute it does not have', { src: 'ref:abcdef12', onerror: 'x' }, 'native attribute'],
  ])('an update forging an image with %s is refused', (_name, attrs, detail) => {
    const { state } = createRegionState(kind, '<p data-af-id="p1">a</p>');
    const doc = openRegionDoc(state, { kind, clientId: 77 });
    const before = Y.encodeStateVector(doc);
    const image = new Y.XmlElement('image');
    for (const [key, value] of Object.entries(attrs)) image.setAttribute(key, value);
    (doc.getXmlFragment('native-v1').get(0) as Y.XmlElement).insert(1, [image]);
    expect(refusal(() => validateRegionUpdate(kind, state, Y.encodeStateAsUpdate(doc, before), 77))).toEqual([detail]);
  });

  it('saving keeps the image and its id in the saved page', () => {
    const page = canonicalizeHtmlPage(`<html><body><article data-af-id="doc" data-af-editable="rich-native-v1">${SAVED}</article></body></html>`);
    const { state } = createRegionState(kind, SAVED);
    const doc = openRegionDoc(state, { kind, clientId: 5 });
    ((doc.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Now ');
    const saved = compactRegion({ savedHtml: page.html, ledger: page.ledger, regionId: 'doc', state: Y.encodeStateAsUpdate(doc) });
    expect(saved.html).toContain('<p data-af-id="p1">Now See <img data-af-id="i1" src="ref:abcdef12" alt="A &amp; B" title="Chart"> and <img data-af-id="i2" src="https://i.example/p.png?a=1&amp;b=2" alt=""></p>');
  });

  it('reads as Markdown image syntax', () => {
    expect(regionMarkdown(kind, SAVED)).toBe('See ![A & B](ref:abcdef12 "Chart") and ![](https://i.example/p.png?a=1&b=2)');
  });
});

describe('no write creates an image node yet', () => {
  const revise = (html: string) => {
    const { state, snapshot } = createRegionState(kind, SAVED);
    const { update } = applyRegionRevision({ kind, live: state, savedSnapshot: snapshot, html });
    const doc = openRegionDoc(state, { kind });
    Y.applyUpdate(doc, update);
    return regionHtml(kind, Y.encodeStateAsUpdate(doc));
  };
  it('an agent\'s HTML revision keeps the images the document holds', () => {
    expect(revise(SAVED.replace('See ', 'Look at '))).toBe(SAVED.replace('See ', 'Look at '));
    expect(revise('<p data-af-id="p1">Only <img src="ref:abcdef12" alt="A &amp; B" title="Chart"></p>')).toBe('<p data-af-id="p1">Only <img data-af-id="i1" src="ref:abcdef12" alt="A &amp; B" title="Chart"></p>');
  });
  it('an agent\'s HTML revision naming any other image refuses, as before images existed', () => {
    expect(refusal(() => revise(`${SAVED}<p><img src="ref:zzzzzz99" alt="new"></p>`))).toEqual(['node img']);
    expect(refusal(() => revise(SAVED.replace('alt="A &amp; B"', 'alt="changed"')))).toEqual(['node img']);
    const { state, snapshot } = createRegionState(kind, '<p>no images</p>');
    expect(refusal(() => applyRegionRevision({ kind, live: state, savedSnapshot: snapshot, html: '<p><img src="ref:abcdef12"></p>' }))).toEqual(['attribute src']);
  });
  it('the legacy migration refuses a region with an image, as before', () => {
    expect(() => convertLegacyPage('<article data-af-id="r" data-af-editable="rich"><p>a <img src="ref:abcdef12"></p></article>')).toThrow();
  });
});
