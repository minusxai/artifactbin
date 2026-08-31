/**
 * WEB FONTS, INGEST-AND-OWN. A document names a family; this module resolves
 * it ONCE per deployment and every reader is served OUR copy.
 *
 * Why not just let the document link fonts.googleapis.com: a served document's
 * CSP admits `font-src 'self' data:` and nothing else, so a link would simply
 * not paint — but the deeper reason is that a hotlink ships every reader's IP
 * to Google on every view, which is the same reader-privacy line the image
 * rule draws (a German court has treated it as a GDPR violation outright).
 * Copying keeps the document self-contained, exportable, and readable offline
 * for as long as the deployment lives.
 *
 * The shape is the map-tile allowlist, not the open web: TWO pinned hosts
 * (css2 for the metadata, gstatic for the files), so this is never a general
 * proxy. The bytes go to the object store content-addressed — one copy per
 * distinct file across every document and every family that shares it — and
 * the `webfonts` row is the family→faces index the renderer reads.
 *
 * Bundled families short-circuit: a document asking for Inter or JetBrains
 * Mono resolves against the compiled-in catalog and fetches nothing.
 */
import { getDb } from '@/lib/db';
import { objectKey, objectStore } from '@/lib/object-store';
import { STORY_FONT_FAMILIES, type StoryFontAsset } from '@/lib/data/story/story-fonts';
import { fetchWebResource } from '@/lib/web-ingest/fetch';
import { WebIngestError } from '@/lib/web-ingest/guard';
import { isWoff2 } from '@/lib/web-ingest/sniff';
import { parseGoogleFontCss } from './google';

/** The two pinned upstreams. Overridable ONLY by tests (never reaches the network). */
let sources = { cssBase: 'https://fonts.googleapis.com', fileHost: 'fonts.gstatic.com' };
export function setWebFontSourcesForTests(next: { cssBase: string; fileHost: string } | null): void {
  sources = next ?? { cssBase: 'https://fonts.googleapis.com', fileHost: 'fonts.gstatic.com' };
}

/** One face of a resolved family, pointing at our own origin. */
export type WebFontAsset = StoryFontAsset;

export class UnknownFontError extends Error {
  constructor(public readonly family: string, message: string) {
    super(message);
    this.name = 'UnknownFontError';
  }
}

/** A family name is a css identifier, not free text — it lands in a stylesheet. */
export const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,48}$/;

const MAX_FONT_BYTES = 2_000_000;
/** Only the latin upright is preloaded — the same rule the bundled catalog follows. */
const isCritical = (f: { subset: string; style?: string }) => f.subset === 'latin' && !f.style;

async function readRow(family: string): Promise<WebFontAsset[] | null> {
  const db = await getDb();
  const r = await db.query<{ assets: WebFontAsset[] }>('SELECT assets FROM webfonts WHERE family = $1', [family]);
  return r.rows[0]?.assets ?? null;
}

/**
 * Resolve a family to faces served from THIS origin, fetching and storing on
 * first use. Throws UnknownFontError when Google has no such family (or the
 * name is not one) — the publish door turns that into a 400 naming it, because
 * a document that silently falls back to sans-serif looks like it worked.
 */
export async function resolveWebFont(familyIn: string): Promise<WebFontAsset[]> {
  const family = familyIn.trim();
  if (!FAMILY_RE.test(family)) {
    throw new UnknownFontError(family, `"${family}" is not a font family name`);
  }
  // Bundled families never leave the process.
  if (STORY_FONT_FAMILIES.includes(family)) return [];

  const cached = await readRow(family);
  if (cached) return cached;

  const cssUrl = `${sources.cssBase}/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@0,400;0,700;1,400&display=swap`;
  let css: string;
  try {
    const got = await fetchWebResource(cssUrl, {
      maxBytes: 200_000,
      accept: 'text/css',
      // css2 CONTENT-NEGOTIATES on the User-Agent: an unrecognized one gets
      // legacy TTF with no subset comments, which this pipeline cannot use
      // (and would silently store as "no faces"). A modern browser UA is what
      // makes it answer woff2 + per-subset unicode-ranges.
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      allowHosts: (h) => h === new URL(sources.cssBase).hostname,
    });
    css = got.bytes.toString('utf8');
  } catch (error) {
    if (error instanceof WebIngestError) {
      throw new UnknownFontError(family, `"${family}" is not a Google Font we can fetch (${error.code})`);
    }
    throw error;
  }

  const faces = parseGoogleFontCss(css);
  if (faces.length === 0) throw new UnknownFontError(family, `"${family}" is not a Google Font`);

  const store = objectStore();
  const assets: WebFontAsset[] = [];
  for (const face of faces) {
    const file = await fetchWebResource(face.url, {
      maxBytes: MAX_FONT_BYTES,
      allowHosts: (h) => h === sources.fileHost,
    }).catch((e) => { throw e instanceof WebIngestError ? new UnknownFontError(family, `"${family}": ${e.message}`) : e; });
    if (!isWoff2(file.bytes)) throw new UnknownFontError(family, `"${family}": a face did not arrive as woff2`);
    // Content-addressed: two families sharing a file cost one object, and the
    // URL changes only when the bytes do — which is what makes it immutable.
    const key = objectKey('webfont', file.bytes);
    await store.put(key, file.bytes, 'font/woff2');
    assets.push({
      family: face.family,
      url: `/webfonts/${key.split('/')[1]}.woff2`,
      weight: face.weight,
      ...(face.style ? { style: face.style } : {}),
      ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      ...(isCritical(face) ? { preload: true } : {}),
    });
  }

  const db = await getDb();
  // Two publishes racing the same new family both resolve; the loser's row is
  // simply not written — identical bytes, identical URLs, so either wins.
  await db.query(
    `INSERT INTO webfonts (family, assets) VALUES ($1, $2::jsonb) ON CONFLICT (family) DO NOTHING`,
    [family, JSON.stringify(assets)],
  );
  return (await readRow(family)) ?? assets;
}

/** The stored faces for families a document already resolved — render path, never fetches. */
export async function webFontAssets(families: string[]): Promise<WebFontAsset[]> {
  const wanted = [...new Set(families.map((f) => f.trim()).filter((f) => FAMILY_RE.test(f)))];
  if (wanted.length === 0) return [];
  const db = await getDb();
  const r = await db.query<{ assets: WebFontAsset[] }>('SELECT assets FROM webfonts WHERE family = ANY($1)', [wanted]);
  return r.rows.flatMap((row) => row.assets);
}

/** The object key a served `/webfonts/<hash>.woff2` request names, or null. */
/**
 * THE DB IS THE ONLY INDEX: is this file one some family resolved? Answered
 * from the `webfonts` table before the object store is ever asked, so a
 * well-formed hash nobody resolved is a 404 that never reaches S3.
 */
export async function isKnownWebFontFile(file: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.query('SELECT 1 FROM webfonts WHERE assets @> $1::jsonb LIMIT 1', [JSON.stringify([{ url: `/webfonts/${file}` }])]);
  return r.rows.length > 0;
}

export function webFontObjectKey(file: string): string | null {
  const m = /^([0-9a-f]{32})\.woff2$/.exec(file);
  return m ? `webfont/${m[1]}` : null;
}
