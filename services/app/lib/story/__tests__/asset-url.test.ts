/**
 * WHAT THE MAPPED `<img>` ACTUALLY SAYS — the address, the version, the
 * variants and when the browser is allowed to wait.
 *
 * Three separate promises live in this one pure module, and each was a hole:
 *
 *  1. R19 — `/assets/<hash>` is served `immutable`, so a `refresh_asset` never
 *     reaches a reader whose browser already fetched the old bytes. The
 *     ADDRESS cannot move (a stored document names the URL and the mapping is
 *     derived from it), so the CACHE KEY moves instead: `?v=<first 8 hex of the
 *     object key>`, taken from the row the lookup already returns. A refresh
 *     repoints the row, the next render emits a new `?v=`, and the old copy
 *     stays valid at its own address forever.
 *  2. Everything below the fold is downloaded before anything is read. A
 *     document is a page of pictures more often than not, and the first
 *     viewport is two of them at most.
 *  3. A phone downloads the desktop image. The row records the width, so the
 *     markup can offer both and let the browser choose.
 *
 * The CAPTURE render (`chrome=0`) is the exception to 2 and 3 together, and it
 * is one flag rather than three: /export photographs that frame, so a lazy
 * image is a photograph of nothing and a `sizes` hint against a headless
 * viewport is a photograph of the 640px copy.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { assetUrlFor, mapExternalImageSources, type WebAssetBox } from '../asset-url';

const URL_A = 'https://cdn.example/photo.png';

/** A row as `lookupWebAssets` returns it: the key is what the version is cut from. */
const box = (over: Partial<WebAssetBox> = {}): WebAssetBox => ({
  object_key: 'webasset/1a2b3c4d5e6f70819202122232425262',
  width: 1600, height: 900, placeholder: null, ...over,
});

const wide = box({ small_object_key: 'webasset/ffeeddccbbaa99887766554433221100', small_width: 1280 });

const imgs = (n: number, url = URL_A) =>
  `<div>${Array.from({ length: n }, (_, i) => `<img src="${url}" alt="i${i}" />`).join('')}</div>`;

const mapped = (source: string, lookup: (u: string) => WebAssetBox | boolean, opts?: { capture?: boolean }) => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('parse');
  return mapExternalImageSources(parsed.nodes, lookup, opts);
};

/** Every attribute of the nth `<img>`, lowercased names → values. */
const attrsOf = (nodes: unknown, n: number): Record<string, unknown> => {
  const out: Array<Record<string, unknown>> = [];
  const walk = (list: any[]) => {
    for (const node of list) {
      if (node?.type !== 'element') continue;
      if (!node.isComponent && node.tag.toLowerCase() === 'img') {
        out.push(Object.fromEntries(node.attributes.map((a: any) => [a.name, a.value.json])));
      }
      walk(node.children);
    }
  };
  walk(nodes as any[]);
  return out[n] ?? {};
};

describe('assetUrlFor', () => {
  it('is the bare address when all the caller knows is that we hold a copy', () => {
    // The editor's own push has no rows to consult (components/InPlaceEditor).
    expect(assetUrlFor(URL_A)).toMatch(/^\/assets\/[0-9a-f]{64}$/);
    expect(assetUrlFor(URL_A, true)).toMatch(/^\/assets\/[0-9a-f]{64}$/);
  });

  it('carries a content-derived version when the caller holds the row', () => {
    expect(assetUrlFor(URL_A, box())).toBe(`${assetUrlFor(URL_A)}?v=1a2b3c4d`);
  });

  it('changes when the object does, and only then — this is R19', () => {
    const before = assetUrlFor(URL_A, box());
    const after = assetUrlFor(URL_A, box({ object_key: 'webasset/00000000deadbeefdeadbeefdeadbeef' }));
    expect(after).not.toBe(before);
    expect(after.split('?')[0]).toBe(before.split('?')[0]); // the ADDRESS never moves
    expect(assetUrlFor(URL_A, box())).toBe(before);         // same bytes, same key, same url
  });
});

describe('lazy loading', () => {
  it('leaves the first two images eager and lets the browser wait for the rest', () => {
    const nodes = mapped(imgs(4), () => box());
    expect(attrsOf(nodes, 0).loading).toBeUndefined();
    expect(attrsOf(nodes, 1).loading).toBeUndefined();
    expect(attrsOf(nodes, 2)).toMatchObject({ loading: 'lazy', decoding: 'async' });
    expect(attrsOf(nodes, 3)).toMatchObject({ loading: 'lazy', decoding: 'async' });
  });

  it('counts every image in document order, mapped or not', () => {
    // Two `ref:` uploads above the fold means the first URL-kept image is third.
    const source = '<div><img src="ref:aaa111" /><img src="ref:bbb222" />'
      + `<img src="${URL_A}" alt="third" /></div>`;
    expect(attrsOf(mapped(source, (u) => u === URL_A && box()), 2).loading).toBe('lazy');
  });

  it("never overrides an author's own loading", () => {
    const source = `<div><img src="${URL_A}" alt="a" /><img src="${URL_A}" alt="b" />`
      + `<img src="${URL_A}" loading="eager" alt="mine" /></div>`;
    expect(attrsOf(mapped(source, () => box()), 2).loading).toBe('eager');
  });

  it('is off for a capture: /export photographs the frame, and a lazy image is a photograph of nothing', () => {
    const nodes = mapped(imgs(4), () => box(), { capture: true });
    for (const i of [0, 1, 2, 3]) expect(attrsOf(nodes, i).loading).toBeUndefined();
  });
});

describe('size variants', () => {
  it('offers both widths and the column they are read in', () => {
    const a = attrsOf(mapped(imgs(1), () => wide), 0);
    expect(a.srcSet).toBe(
      `${assetUrlFor(URL_A, wide)}&w=1280 1280w, ${assetUrlFor(URL_A, wide)} 1600w`,
    );
    expect(a.sizes).toBe('(max-width: 640px) 100vw, 768px');
  });

  it('offers none when the source was never wide enough to have a second copy', () => {
    const a = attrsOf(mapped(imgs(1), () => box()), 0);
    expect(a.srcSet).toBeUndefined();
    expect(a.sizes).toBeUndefined();
  });

  it('offers none for a capture, which wants the full variant and nothing to choose from', () => {
    const a = attrsOf(mapped(imgs(1), () => wide, { capture: true }), 0);
    expect(a.srcSet).toBeUndefined();
    expect(a.sizes).toBeUndefined();
    expect(a.src).toBe(assetUrlFor(URL_A, wide));
  });

  /*
   * The separator follows the ADDRESS, not the row: `?v=` is added only when
   * the key's last segment is hex, so a row without one must still produce a
   * well-formed query rather than `/assets/<hash>&w=1280`.
   */
  it('opens the query when there is no version to hang it off', () => {
    const noKey = { width: 1600, small_object_key: 'small', small_width: 1280 };
    expect(attrsOf(mapped(imgs(1), () => noKey), 0).srcSet)
      .toBe(`${assetUrlFor(URL_A)}?w=1280 1280w, ${assetUrlFor(URL_A)} 1600w`);
  });

  it("never overrides an author's own srcset", () => {
    const source = `<img src="${URL_A}" srcset="/mine 1x" alt="a" />`;
    expect(attrsOf(mapped(source, () => wide), 0).srcset).toBe('/mine 1x');
    expect(attrsOf(mapped(source, () => wide), 0).srcSet).toBeUndefined();
  });

  it('leaves a <Video> poster alone — it is a background, not a laid-out image', () => {
    const parsed = parseJsx(`<Video src="https://v.example/v.mp4" poster="${URL_A}" />`);
    if (!parsed.ok) throw new Error('parse');
    const out = JSON.stringify(mapExternalImageSources(parsed.nodes, () => wide));
    expect(out).toContain(assetUrlFor(URL_A, wide));
    expect(out).not.toContain('srcSet');
    expect(out).not.toContain('loading');
  });
});
