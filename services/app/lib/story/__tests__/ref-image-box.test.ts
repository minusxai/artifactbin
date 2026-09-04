/**
 * An image must arrive in a box the page already reserved.
 *
 * Measured on production: a 1.04 MB photograph in markup with no width or
 * height, so everything below it jumped when the bytes landed — seconds later,
 * because the file was what came off someone's phone. The bytes are dealt with
 * at publish (lib/images/optimise); this is the other half, which costs
 * nothing at all: the store already knows how big the image is, so the markup
 * can say so.
 *
 * It rides the ref map because that is what both render paths consume — the
 * served document's runtime and the editor's canvas — so an image that
 * reserves its space in one and not the other has nowhere to come from.
 */
import { describe, expect, it } from 'vitest';
import { IMAGE_SIZES, resolveRefProps } from '../ref-data';
import type { RefDataMap } from '../ref-data';

const img = { isComponent: false, tag: 'img' };
const sized: RefDataMap = { abc123: { kind: 'image', url: '/a/abc123/raw?v=2', width: 1200, height: 800 } };
const bare: RefDataMap = { abc123: { kind: 'image', url: '/a/abc123/raw?v=2' } };

describe('a ref image', () => {
  it('carries the box it will occupy', () => {
    expect(resolveRefProps(img, { src: 'ref:abc123' }, sized))
      .toEqual({ src: '/a/abc123/raw?v=2', width: '1200', height: '800' });
  });

  it('still resolves when the store never recorded a size (everything published before this)', () => {
    expect(resolveRefProps(img, { src: 'ref:abc123' }, bare)).toEqual({ src: '/a/abc123/raw?v=2' });
  });

  /*
   * The author's own sizing WINS. `width`/`height` here are the intrinsic
   * dimensions — an aspect ratio for the browser to reserve — and an author
   * who has said otherwise means it.
   */
  it('never overrides dimensions the author wrote', () => {
    expect(resolveRefProps(img, { src: 'ref:abc123', width: 300 }, sized))
      .toEqual({ src: '/a/abc123/raw?v=2' });
  });

  // A <Video> poster is a background, not a laid-out element: sizing it by the
  // poster's intrinsic pixels would fight the player's own box.
  it('sizes an <img> and not a Video poster', () => {
    expect(resolveRefProps({ isComponent: true, tag: 'Video' }, { poster: 'ref:abc123' }, sized))
      .toEqual({ poster: '/a/abc123/raw?v=2' });
  });
});

/*
 * THE SECOND WIDTH — the copy a phone downloads instead of the desktop's.
 *
 * An upload wide enough to be worth it is stored twice (lib/images/optimise)
 * and both copies come off the same artifact, `?w=` apart. It rides the ref map
 * for the same reason the box and the blur do: both render paths consume it, so
 * an image that offers two widths in one and one in the other has nowhere to
 * come from.
 */
const wide: RefDataMap = {
  abc123: {
    kind: 'image', url: '/a/abc123/raw?v=2', width: 1600, height: 1200,
    smallUrl: '/a/abc123/raw?v=2&w=1280', smallWidth: 1280,
  },
};

describe('a ref image stored at two widths', () => {
  it('offers both, and says what column they are read in', () => {
    expect(resolveRefProps(img, { src: 'ref:abc123' }, wide)).toMatchObject({
      src: '/a/abc123/raw?v=2',
      srcSet: '/a/abc123/raw?v=2&w=1280 1280w, /a/abc123/raw?v=2 1600w',
      sizes: IMAGE_SIZES,
    });
  });

  it('offers one when only one was stored', () => {
    expect(resolveRefProps(img, { src: 'ref:abc123' }, sized)).not.toHaveProperty('srcSet');
  });

  it("never overrides an author's own srcset", () => {
    expect(resolveRefProps(img, { src: 'ref:abc123', srcSet: '/mine 1x' }, wide)).not.toHaveProperty('srcSet');
    expect(resolveRefProps(img, { src: 'ref:abc123', srcset: '/mine 1x' }, wide)).not.toHaveProperty('srcSet');
  });

  it('offers none behind a Video poster', () => {
    expect(resolveRefProps({ isComponent: true, tag: 'Video' }, { poster: 'ref:abc123' }, wide))
      .toEqual({ poster: '/a/abc123/raw?v=2' });
  });
});

/*
 * THE BLUR — what the reader looks at while the real bytes travel.
 *
 * The store already computes a ~95-byte blurred webp at publish
 * (lib/images/optimise) and it has been sitting in `meta.placeholder`,
 * rendered by nothing: the tests asserted it was PRODUCED and nothing asserted
 * it was CONSUMED, so the suite stayed green while the feature did not exist.
 * These are the consumption tests.
 *
 * It rides as a `background-image` on the <img> itself rather than a wrapper:
 * the element is transparent until its bytes paint, so the blur shows through
 * and is covered the instant they arrive — no JavaScript, so it behaves the
 * same in the SSR string, in hydration, and in a prose document that ships no
 * runtime at all.
 */
const blurred: RefDataMap = {
  abc123: { kind: 'image', url: '/a/abc123/raw?v=2', width: 1200, height: 800, blur: 'data:image/webp;base64,UklGRi' },
};

describe('a ref image with a blur', () => {
  it('carries it as a background under the image', () => {
    const patch = resolveRefProps(img, { src: 'ref:abc123' }, blurred);
    expect(patch).toMatchObject({ src: '/a/abc123/raw?v=2', width: '1200', height: '800' });
    // An OBJECT — React rejects a string `style` prop outright.
    expect(patch!.style).toEqual({
      backgroundImage: 'url(data:image/webp;base64,UklGRi)',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
    });
  });

  /*
   * More than a third of production images have dimensions and NO blur (the
   * tiny ones, where a 16px thumbnail is degenerate). Missing is the ordinary
   * case, not an edge case.
   */
  it('renders no background when the store recorded no blur', () => {
    expect(resolveRefProps(img, { src: 'ref:abc123' }, sized)!.style).toBeUndefined();
  });

  /*
   * The patch is applied with cloneElement, and props merge SHALLOWLY — a
   * `style` here would REPLACE the author's outright rather than merge with
   * it. So an author who wrote their own style keeps it, and loses the blur.
   */
  it("never overwrites the author's own style", () => {
    expect(resolveRefProps(img, { src: 'ref:abc123', style: 'opacity:0.5' }, blurred))
      .toEqual({ src: '/a/abc123/raw?v=2', width: '1200', height: '800' });
  });

  it('does not put a blur behind a Video poster', () => {
    expect(resolveRefProps({ isComponent: true, tag: 'Video' }, { poster: 'ref:abc123' }, blurred))
      .toEqual({ poster: '/a/abc123/raw?v=2' });
  });
});
