/**
 * The comment task's `changed` predicate and its thread reading.
 *
 * The module is `lib/score/kinds/comment` rather than the spike's
 * `lib/score/comment`: the kind OWNS its predicates, its setup and its check
 * names in one file, and a re-export existing only to keep an old test path
 * alive is a second address for one topic.
 *
 * The two document fixtures are REAL served documents from this product
 * (`GET /a/<id>/raw?chrome=0`), not hand-written HTML: `product.ts` carries the
 * scar from a hand-written island fixture that made a working function return 0
 * for two documents whose queries had run perfectly.
 *
 * Two cases per predicate — what it accepts, and what it refuses. The
 * near-misses were each measured against the real fixture, so they are grouped
 * rather than dropped: a scorer that fails a CORRECT answer is how a gate gets
 * turned off, and the reason a given input is on the accepting side is the part
 * worth keeping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetOk,
  assetsServed,
  captionAfter,
  imageCount,
  needsSourceIdentity,
  paragraphWords,
  splitAcrossParagraphs,
  splitVerbatim,
  threadMetrics,
  urlsKept,
} from '../lib/score/kinds/comment';
import { assetUrlFor } from '../../services/app/lib/story/asset-url';

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', `comment-${name}.html`), 'utf8');

/** The paragraph the task's comment is anchored to, exactly as the seed publishes it. */
const SEEDED =
  'The support team closed 1,284 tickets last quarter. Median first response was three hours, and the backlog fell by half.';

describe('splitAcrossParagraphs — the task\'s `changed` check', () => {
  it('accepts the real split and the near misses an agent writes, not the seed as published', () => {
    expect(splitAcrossParagraphs(fixture('seed'), SEEDED)).toBe(false);
    expect(splitAcrossParagraphs(fixture('split'), SEEDED)).toBe(true);
    expect(splitVerbatim(fixture('split'), SEEDED)).toBe(true);

    // A CI gate that fails a CORRECT split is how a gate gets turned off, and exact word equality
    // fails both of these — measured against the real fixture before the predicate was relaxed.
    // Punctuation at the seam, and the capital that follows a new sentence boundary, are the agent
    // writing English rather than the agent losing words.
    const unpunctuated = fixture('split').replace('tickets last quarter.</p>', 'tickets last quarter</p>');
    expect(splitAcrossParagraphs(unpunctuated, SEEDED)).toBe(true);
    expect(splitVerbatim(unpunctuated, SEEDED)).toBe(false);
    const recapitalised = fixture('split').replace('>Median first', '>median first');
    expect(splitAcrossParagraphs(recapitalised, SEEDED)).toBe(true);
    expect(splitVerbatim(recapitalised, SEEDED)).toBe(false);

    // The annotation anchor and the SSR stamps are ours, not the agent's.
    const stripped = fixture('split').replace(/ data-(mx-ast|annotation-anchor)="[^"]*"/g, '');
    expect(splitAcrossParagraphs(stripped, SEEDED)).toBe(true);
  });

  it('refuses a split that lost words, re-ordered the halves, or changed a number', () => {
    const lossy = fixture('split').replace(', and the backlog fell by half.', '.');
    expect(splitAcrossParagraphs(lossy, SEEDED)).toBe(false);

    const words = paragraphWords(fixture('split'));
    expect(words.length).toBe(4); // the served document really has four <p>s
    const reordered = fixture('split')
      .replace('The support team closed 1,284 tickets last quarter.', '@@A@@')
      .replace('Median first response was three hours, and the backlog fell by half.', 'The support team closed 1,284 tickets last quarter.')
      .replace('@@A@@', 'Median first response was three hours, and the backlog fell by half.');
    expect(splitAcrossParagraphs(reordered, SEEDED)).toBe(false);

    expect(splitAcrossParagraphs(fixture('split').replace('1,284', '1284'), SEEDED)).toBe(false);
  });
});

describe('threadMetrics — `responded` and `resolved`', () => {
  const human = { author: { kind: 'human', label: null, transport: 'browser' } };
  const agent = { author: { kind: 'agent', label: 'Claude Code', transport: 'http' } };

  it('answers the two independently, and names the agent that replied', () => {
    expect(threadMetrics([{ status: 'open', thread: [human] }])).toEqual({
      responded: false, resolved: false, agentLabel: '',
    });
    expect(threadMetrics([{ status: 'resolved', thread: [human, agent] }])).toEqual({
      responded: true, resolved: true, agentLabel: 'Claude Code (http)',
    });
    // A resolve with no reply is resolved but NOT responded.
    expect(threadMetrics([{ status: 'resolved', thread: [human] }])).toEqual({
      responded: false, resolved: true, agentLabel: '',
    });
  });

  it('a HUMAN second comment is not a response, and no annotations answers false rather than throwing', () => {
    expect(threadMetrics([{ status: 'open', thread: [human, human] }]).responded).toBe(false);
    expect(threadMetrics([])).toEqual({ responded: false, resolved: false, agentLabel: '' });
  });
});

/**
 * THE IMAGE VARIANT (`comment-image.eval.json`) — the same conversation with a
 * different request: the comment asks for two pictures BY URL.
 *
 * Three predicates, and the split between them is the point. `urls_kept` is
 * about STORAGE (the URL the agent wrote is the URL it reads back — the whole
 * promise of URL-kept assets); `assetsServed` is about the READER (what a
 * browser is actually told to fetch); `assetOk` is about the BYTES behind that
 * address. All three are pure — the wire reads live in the kind.
 */
const A = 'https://minusx.ai/_next/static/media/logo.bda07120.svg';
const B = 'https://minusx.ai/use_cases/growth_v2.webp';
const served = (body: string) => `<html><head></head><body>${body}</body></html>`;

describe('urlsKept — the URL survives in the stored markup', () => {
  it('is TRUE only when EVERY asked-for URL is there verbatim', () => {
    expect(urlsKept(`<img src="${A}"/><img src="${B}"/>`, [A, B])).toBe(true);
    expect(urlsKept(`<img src="${A}"/>`, [A, B])).toBe(false);
  });

  it('refuses a rewritten source, and a check with no subject is not a pass', () => {
    // The regression this check exists for: the retired `ref:` rewrite, and any
    // future one. Storage must read back what the author wrote.
    expect(urlsKept(`<img src="/assets/${'0'.repeat(64)}"/>`, [A])).toBe(false);
    expect(urlsKept('<p>hi</p>', [])).toBe(false);
  });
});

describe('assetsServed — the reader is sent to OUR origin', () => {
  it('is TRUE when every asked-for URL is served from /assets/<its hash>, query and all', () => {
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="${assetUrlFor(B)}"/>`), [A, B])).toBe(true);
    // The rule is the PREFIX: the address may grow a query.
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}?v=1"/>`), [A])).toBe(true);
  });

  it('is FALSE for any <img> left on the source host, a doubled address, or nothing asked for', () => {
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="${B}"/>`), [A, B])).toBe(false);
    // "No request to the source host" is the claim, and one stray <img> breaks it
    // whether or not it is one of the two the comment named.
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="https://minusx.ai/other.png"/>`), [A])).toBe(false);
    // …and one URL served from the address of the OTHER one is not two served assets.
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="${assetUrlFor(A)}"/>`), [A, B])).toBe(false);
    expect(assetsServed(served('<p>hi</p>'), [])).toBe(false);
  });
});

describe('assetOk — the bytes behind the address', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('wants a 200 and an image content type, and a raster only has to be an image', () => {
    expect(assetOk({ status: 200, contentType: 'image/webp', bytes: bytes('a'), sourceBytes: null })).toBe(true);
    expect(assetOk({ status: 404, contentType: 'image/webp', bytes: bytes('a'), sourceBytes: null })).toBe(false);
    expect(assetOk({ status: 200, contentType: 'text/html', bytes: bytes('a'), sourceBytes: null })).toBe(false);
    // A raster is re-encoded on the way in, so its bytes are expected to differ from the source.
    expect(assetOk({ status: 200, contentType: 'image/webp', bytes: bytes('re-encoded'), sourceBytes: bytes('original') })).toBe(true);
  });

  it('an SVG must be byte-IDENTICAL to its source, and no source to compare against is not a pass', () => {
    expect(needsSourceIdentity('image/svg+xml')).toBe(true);
    expect(needsSourceIdentity('image/webp')).toBe(false);
    expect(assetOk({ status: 200, contentType: 'image/svg+xml', bytes: bytes('<svg/>'), sourceBytes: bytes('<svg/>') })).toBe(true);
    expect(assetOk({ status: 200, contentType: 'image/svg+xml', bytes: bytes('<svg/>'), sourceBytes: bytes('<svg />') })).toBe(false);
    expect(assetOk({ status: 200, contentType: 'image/svg+xml', bytes: bytes('<svg/>'), sourceBytes: null })).toBe(false);
  });
});

describe('the recorded rows — evidence, never a gate', () => {
  it('imageCount counts the <img>s in the body', () => {
    expect(imageCount(served(`<img src="a"/><p>x</p><img src="b"/>`))).toBe(2);
    expect(imageCount(served('<p>no pictures</p>'))).toBe(0);
  });

  it('captionAfter sees a caption under the image, and nothing else', () => {
    expect(captionAfter(served(`<figure><img src="${assetUrlFor(B)}"/><figcaption>Signups by month</figcaption></figure>`), B)).toBe(true);
    // …and a plain sibling line under it.
    expect(captionAfter(served(`<img src="${assetUrlFor(B)}"/><em>Signups by month</em>`), B)).toBe(true);
    expect(captionAfter(served(`<img src="${assetUrlFor(B)}"/>`), B)).toBe(false);
    // A body paragraph following the image is not a caption.
    expect(captionAfter(served(`<img src="${assetUrlFor(B)}"/><p>${'word '.repeat(40)}</p>`), B)).toBe(false);
    expect(captionAfter(served('<p>nothing here</p>'), B)).toBe(false);
  });
});

/**
 * …and the same three predicates against a REAL served document rather than
 * hand-written HTML — the scar `product.ts` carries, and the reason the two
 * `comment-*.html` fixtures above are real too.
 *
 * This one is `GET /a/<id>/raw?chrome=0` for the markup the claude-code leg
 * actually wrote for this task, republished against the prod build: the URLs
 * mapped to `/assets/<hash>`, the `<figure>`/`<figcaption>` pair, the box and
 * blur the row contributed, and the `data-mx-ast` stamps every SSR'd node
 * carries. Nothing here is what one would have written by hand.
 */
describe('the asset predicates over a real served document', () => {
  const html = fixture('image-served');

  it('serves both from our origin, counts the two pictures and sees the one caption', () => {
    expect(assetsServed(html, [A, B])).toBe(true);
    expect(imageCount(html)).toBe(2);
    expect(captionAfter(html, B)).toBe(true);
    // The logo carries no caption — the comment only asked for one.
    expect(captionAfter(html, A)).toBe(false);
  });

  /**
   * `replaceAll`, and the reason is a thing only a real document shows: the
   * address appears in the HEAD first, as `<link rel="preload" as="image">`, so
   * a single `replace` rewrote the preload and left the `<img>` alone — and the
   * predicate correctly stayed true, because it reads the BODY. Which is also
   * why the body is enough: the renderer only preloads an asset it is about to
   * draw, so there is no source-host preload without a source-host `<img>`
   * under it.
   */
  it('…and turns FALSE the moment the picture goes back to the source host', () => {
    expect(assetsServed(html.replaceAll(assetUrlFor(B), B), [A, B])).toBe(false);
  });
});
