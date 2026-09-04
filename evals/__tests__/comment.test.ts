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
  it('is FALSE for the seed as published (one paragraph)', () => {
    expect(splitAcrossParagraphs(fixture('seed'), SEEDED)).toBe(false);
  });

  it('is TRUE once the paragraph reads across two <p> elements', () => {
    expect(splitAcrossParagraphs(fixture('split'), SEEDED)).toBe(true);
  });

  it('is FALSE when the split lost words', () => {
    const lossy = fixture('split').replace(', and the backlog fell by half.', '.');
    expect(splitAcrossParagraphs(lossy, SEEDED)).toBe(false);
  });

  it('is FALSE when the halves were re-ordered', () => {
    const words = paragraphWords(fixture('split'));
    expect(words.length).toBe(4); // the served document really has four <p>s
    const reordered = fixture('split')
      .replace('The support team closed 1,284 tickets last quarter.', '@@A@@')
      .replace('Median first response was three hours, and the backlog fell by half.', 'The support team closed 1,284 tickets last quarter.')
      .replace('@@A@@', 'Median first response was three hours, and the backlog fell by half.');
    expect(splitAcrossParagraphs(reordered, SEEDED)).toBe(false);
  });

  // The near misses. A CI gate that fails a CORRECT split is how a gate gets turned off, and
  // exact word equality fails both of the first two — measured against the real fixture before
  // the predicate was relaxed. Punctuation at the seam, and the capital that follows a new
  // sentence boundary, are the agent writing English rather than the agent losing words.
  it('is TRUE when the first half drops its terminal period', () => {
    const h = fixture('split').replace('tickets last quarter.</p>', 'tickets last quarter</p>');
    expect(splitAcrossParagraphs(h, SEEDED)).toBe(true);
    expect(splitVerbatim(h, SEEDED)).toBe(false);
  });

  it('is TRUE when the second half is re-capitalised', () => {
    const h = fixture('split').replace('>Median first', '>median first');
    expect(splitAcrossParagraphs(h, SEEDED)).toBe(true);
    expect(splitVerbatim(h, SEEDED)).toBe(false);
  });

  it('still refuses a changed NUMBER — 1,284 is not 1284', () => {
    const h = fixture('split').replace('1,284', '1284');
    expect(splitAcrossParagraphs(h, SEEDED)).toBe(false);
  });

  it('splitVerbatim is TRUE for the split the real agent wrote', () => {
    expect(splitVerbatim(fixture('split'), SEEDED)).toBe(true);
  });

  it('ignores the annotation anchor and the ast stamps', () => {
    const stripped = fixture('split').replace(/ data-(mx-ast|annotation-anchor)="[^"]*"/g, '');
    expect(splitAcrossParagraphs(stripped, SEEDED)).toBe(true);
  });
});

describe('threadMetrics — `responded` and `resolved`', () => {
  const human = { author: { kind: 'human', label: null, transport: 'browser' } };
  const agent = { author: { kind: 'agent', label: 'Claude Code', transport: 'http' } };

  it('an untouched open thread answers neither', () => {
    expect(threadMetrics([{ status: 'open', thread: [human] }])).toEqual({
      responded: false, resolved: false, agentLabel: '',
    });
  });

  it('a resolved thread with an agent reply answers both, and names the agent', () => {
    expect(threadMetrics([{ status: 'resolved', thread: [human, agent] }])).toEqual({
      responded: true, resolved: true, agentLabel: 'Claude Code (http)',
    });
  });

  it('a resolve with no reply is resolved but NOT responded — the two checks are independent', () => {
    expect(threadMetrics([{ status: 'resolved', thread: [human] }])).toEqual({
      responded: false, resolved: true, agentLabel: '',
    });
  });

  it('a HUMAN second comment is not a response — the check is about the agent', () => {
    const m = threadMetrics([{ status: 'open', thread: [human, human] }]);
    expect(m.responded).toBe(false);
  });

  it('no annotations at all answers false rather than throwing', () => {
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
describe('urlsKept — the URL survives in the stored markup', () => {
  const A = 'https://minusx.ai/_next/static/media/logo.bda07120.svg';
  const B = 'https://minusx.ai/use_cases/growth_v2.webp';

  it('is TRUE only when EVERY asked-for URL is there verbatim', () => {
    expect(urlsKept(`<img src="${A}"/><img src="${B}"/>`, [A, B])).toBe(true);
  });

  it('is FALSE when one URL is missing', () => {
    expect(urlsKept(`<img src="${A}"/>`, [A, B])).toBe(false);
  });

  it('is FALSE when the product rewrote the source into our address', () => {
    // The regression this check exists for: the retired `ref:` rewrite, and any
    // future one. Storage must read back what the author wrote.
    expect(urlsKept(`<img src="/assets/${'0'.repeat(64)}"/>`, [A])).toBe(false);
  });

  it('is FALSE with nothing asked for — a check with no subject is not a pass', () => {
    expect(urlsKept('<p>hi</p>', [])).toBe(false);
  });
});

describe('assetsServed — the reader is sent to OUR origin', () => {
  const A = 'https://minusx.ai/_next/static/media/logo.bda07120.svg';
  const B = 'https://minusx.ai/use_cases/growth_v2.webp';
  const served = (body: string) => `<html><head></head><body>${body}</body></html>`;

  it('is TRUE when every asked-for URL is served from /assets/<its hash>', () => {
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="${assetUrlFor(B)}"/>`), [A, B])).toBe(true);
  });

  it('accepts a query the address may grow — the rule is the PREFIX', () => {
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}?v=1"/>`), [A])).toBe(true);
  });

  it('is FALSE when an <img> still points at the source host', () => {
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="${B}"/>`), [A, B])).toBe(false);
  });

  it('is FALSE when a DIFFERENT image on the page points at the source host', () => {
    // "No request to the source host" is the claim, and one stray <img> breaks it
    // whether or not it is one of the two the comment named.
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="https://minusx.ai/other.png"/>`), [A])).toBe(false);
  });

  it('is FALSE when a URL is served from the address of the OTHER one', () => {
    expect(assetsServed(served(`<img src="${assetUrlFor(A)}"/><img src="${assetUrlFor(A)}"/>`), [A, B])).toBe(false);
  });

  it('is FALSE when nothing was asked for', () => {
    expect(assetsServed(served('<p>hi</p>'), [])).toBe(false);
  });
});

describe('assetOk — the bytes behind the address', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('wants a 200 and an image content type', () => {
    expect(assetOk({ status: 200, contentType: 'image/webp', bytes: bytes('a'), sourceBytes: null })).toBe(true);
    expect(assetOk({ status: 404, contentType: 'image/webp', bytes: bytes('a'), sourceBytes: null })).toBe(false);
    expect(assetOk({ status: 200, contentType: 'text/html', bytes: bytes('a'), sourceBytes: null })).toBe(false);
  });

  it('a RASTER image is only required to be an image — it is re-encoded on the way in', () => {
    expect(assetOk({ status: 200, contentType: 'image/webp', bytes: bytes('re-encoded'), sourceBytes: bytes('original') })).toBe(true);
  });

  it('an SVG must be byte-IDENTICAL to its source — the optimiser leaves it alone', () => {
    expect(needsSourceIdentity('image/svg+xml')).toBe(true);
    expect(needsSourceIdentity('image/webp')).toBe(false);
    expect(assetOk({ status: 200, contentType: 'image/svg+xml', bytes: bytes('<svg/>'), sourceBytes: bytes('<svg/>') })).toBe(true);
    expect(assetOk({ status: 200, contentType: 'image/svg+xml', bytes: bytes('<svg/>'), sourceBytes: bytes('<svg />') })).toBe(false);
  });

  it('an SVG with no source to compare against is NOT a pass', () => {
    expect(assetOk({ status: 200, contentType: 'image/svg+xml', bytes: bytes('<svg/>'), sourceBytes: null })).toBe(false);
  });
});

describe('the recorded rows — evidence, never a gate', () => {
  const A = 'https://minusx.ai/use_cases/growth_v2.webp';
  const served = (body: string) => `<html><body>${body}</body></html>`;

  it('imageCount counts the <img>s in the body', () => {
    expect(imageCount(served(`<img src="a"/><p>x</p><img src="b"/>`))).toBe(2);
    expect(imageCount(served('<p>no pictures</p>'))).toBe(0);
  });

  it('captionAfter sees a <figcaption> that follows the image', () => {
    expect(captionAfter(served(`<figure><img src="${assetUrlFor(A)}"/><figcaption>Signups by month</figcaption></figure>`), A)).toBe(true);
  });

  it('…and a plain sibling line under it', () => {
    expect(captionAfter(served(`<img src="${assetUrlFor(A)}"/><em>Signups by month</em>`), A)).toBe(true);
  });

  it('is FALSE when the image is followed by nothing', () => {
    expect(captionAfter(served(`<img src="${assetUrlFor(A)}"/>`), A)).toBe(false);
  });

  it('is FALSE when what follows is a body paragraph rather than a caption', () => {
    const long = 'word '.repeat(40);
    expect(captionAfter(served(`<img src="${assetUrlFor(A)}"/><p>${long}</p>`), A)).toBe(false);
  });

  it('is FALSE when the image is not on the page at all', () => {
    expect(captionAfter(served('<p>nothing here</p>'), A)).toBe(false);
  });
});
