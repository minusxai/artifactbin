/**
 * A DOCUMENT'S SHEET WITH THE CLASSES ITS DATA BRINGS (lib/data/story/story-css RUNTIME CLASSES).
 *
 * A document's Tailwind is compiled at save from the classes its markup names. A class its rows fill
 * (`className="{$_row.cls}"`, the row saying `bg-lime-500`) is on the element and has no rule. Three places
 * close that gap, all with the same compile (`compileStoryCssWithExtras`, the document's WHOLE ordered sheet):
 *
 *  - SERVE: the rows the server draws (the guest snapshot) carry their classes in the first byte, so the served
 *    sheet already has them (lib/publish/prepared/serve.server, `restyle`) — no flash, no request;
 *  - THE DOOR: classes that arrive later (a control moved, the page's own engine ran) are asked for at
 *    `GET /a/:id/css?v=<version>&k=<compile environment>&x=<classes>` (app/a/[id]/css), and the page swaps its
 *    sheet in place (lib/islands/runtime-css);
 *  - THE OFFLINE FILE, which has no server: compiled at export from the rows it carries.
 *
 * THE DOOR'S ANSWER is a function of its URL alone — the version's source, the compile environment and the sorted
 * classes — so it is immutable: a year's max-age and an ETag. Public only where anyone may read the document;
 * otherwise private (the reader's own cache), under the same read ACL as the page and the uniform 404.
 *
 * Only a document whose classes are filled at runtime (`hasRuntimeClasses`) carries the page data `css`: every
 * other page never loads the client half and never asks.
 */
import type { ArtifactRow } from '@/lib/artifacts';
import { compileStoryCssWithExtras, STORY_RECIPE_UNION, storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { extractClassCandidates, hasRuntimeClasses, isRuntimeClassToken, RUNTIME_CLASS_LIMIT, runtimeClassExtras } from '@/lib/data/story/story-css';
import { runtimeCssPath } from '@/lib/page-styles';
import type { IslandPageData } from '@/lib/islands';
import { etagOf } from '@/lib/http/revalidation';

/** The door's parameters: the version, the compile environment the page was served under, the classes (space-separated). */
const RUNTIME_CSS_PARAMS = { version: 'v', compile: 'k', extras: 'x' } as const;

/** A year: the answer never changes for its URL. */
const IMMUTABLE = 'max-age=31536000, immutable';

/**
 * The page data `css` of `row` (the version served) when it fills classes at runtime, else null. `origin` prefixes
 * the door (the document's own origin; '' for a same-origin relative door). `extras`: what the served sheet already
 * compiled in (the snapshot's classes), which the page must not ask for again.
 */
export function runtimeCssData(row: Pick<ArtifactRow, 'id' | 'version' | 'source'>, origin: string, extras: readonly string[] = []): RuntimeCssPageData | null {
  const { version, compile } = RUNTIME_CSS_PARAMS;
  return runtimeCssPageData(row.source, `${origin.replace(/\/+$/, '')}${runtimeCssPath(row.id)}?${version}=${row.version}&${compile}=${storyCssCompileVersion()}`, extras);
}

type RuntimeCssPageData = NonNullable<IslandPageData['css']>;

/** The page data `css` of `source` asking at `url` (a host's own door: the local preview's), else null. */
export function runtimeCssPageData(source: string | null | undefined, url: string, extras: readonly string[] = []): RuntimeCssPageData | null {
  if (!source || !hasRuntimeClasses(source)) return null;
  return { url, known: extractClassCandidates(source), ...(extras.length ? { extras: [...extras] } : {}) };
}

/** The classes a door's URL asks for (`x`, space-separated), sorted and deduped; null when one is not a class or there are too many. */
export function askedRuntimeClasses(url: URL): string[] | null {
  const tokens = (url.searchParams.get(RUNTIME_CSS_PARAMS.extras) ?? '').split(' ').filter(Boolean);
  if (tokens.length > RUNTIME_CLASS_LIMIT || !tokens.every(isRuntimeClassToken)) return null;
  return [...new Set(tokens)].sort();
}

/**
 * The classes a server-drawn story carries that its stored sheet has no rule for: every class attribute of `html`
 * the document does not name and the recipe union does not hold. Empty for a document that fills no class at
 * runtime, whatever it draws (its sheet already covers everything it can render).
 */
export function renderedRuntimeClasses(source: string | null | undefined, html: string): string[] {
  if (!source || !hasRuntimeClasses(source)) return [];
  const known = new Set([...extractClassCandidates(source), ...STORY_RECIPE_UNION]);
  return runtimeClassExtras(extractClassCandidates(html), known);
}

/** The door's request, parsed; `error` names what makes it unanswerable (a 400). */
export type RuntimeCssRequest =
  | { version: number; compile: string | null; extras: string[] }
  | { error: string };

export function parseRuntimeCssRequest(url: URL): RuntimeCssRequest {
  const params = url.searchParams;
  const version = Number(params.get(RUNTIME_CSS_PARAMS.version));
  if (!Number.isInteger(version) || version < 1) return { error: 'invalid_version' };
  const extras = askedRuntimeClasses(url);
  if (!extras) return { error: 'invalid_classes' };
  return { version, compile: params.get(RUNTIME_CSS_PARAMS.compile), extras };
}

/** The door's answer for a version the reader may read. */
export interface RuntimeCssAnswer {
  css: string;
  etag: string;
  cacheControl: string;
}

/**
 * `row`'s sheet with `extras` compiled in. `anyone`: the document is readable without a credential (the answer may
 * sit in a shared cache). A page served under another compile environment (a deploy since) is answered with this
 * one's sheet, uncached: its URL no longer names what it gets.
 */
export async function runtimeCssAnswer(row: Pick<ArtifactRow, 'id' | 'version' | 'source'>, request: Extract<RuntimeCssRequest, { version: number }>, anyone: boolean): Promise<RuntimeCssAnswer> {
  const environment = storyCssCompileVersion();
  const css = (await compileStoryCssWithExtras(row.source ?? '', request.extras)) ?? '';
  const current = request.compile === environment;
  return { css, etag: etagOf({ id: row.id, version: row.version, environment, extras: request.extras }), cacheControl: current ? `${anyone ? 'public' : 'private'}, ${IMMUTABLE}` : 'private, no-cache' };
}
