/**
 * Shared request-body → stored-content translation for POST and PUT. A body
 * carries exactly ONE content field:
 *   - `markup`   — THE document: story JSX over the kit, the data embeds, the
 *     HTML vocabulary and <Helmet>. The ONLY document input there is.
 *   - `dataset` | `viz` | `image` — the data tiers
 *
 * markdown and html are not inputs: HTML is the VOCABULARY inside a document,
 * and markdown is not an authoring language here at all. Both are rejected by
 * name so an agent that sends the old shape is told what replaced it instead
 * of reading "one of".
 *
 * Returns the stored fields or the error Response the route should send.
 */
import { json } from '../http';
import { publishJsx } from './jsx-tier';
import { ingestDataset, IngestError } from '@/lib/data-ingest';
import { ingestImageFromUrl } from '@/lib/web-ingest/image';
import type { AssetWarning, WebAssetKind } from '@/lib/web-assets';
import { publishDataset, publishVizRecipe, publishImage } from './data-tiers';


export const MAX_CONTENT_BYTES = 2_000_000;

/**
 * THE format vocabulary — the wire, the DB, the pages and MCP all speak the
 * same values; `markup` is THE document format and the rest are data tiers.
 *
 * The runtime list and the type are ONE declaration, so a reader that has to
 * ask "is this a format we serve?" (the page, the raw route) cannot drift from
 * the type the wire is checked against.
 */
export const ARTIFACT_FORMATS = ['markup', 'dataset', 'viz', 'image'] as const;
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number];

export interface StoredContent {
  format: ArtifactFormat;
  content: string; // what /a/<id> serves
  source: string | null; // markup source for round-trip editing
  meta: Record<string, unknown>;
  /** Title derived from the source's first heading — used only when the body has no title. */
  derivedTitle: string | null;
  /**
   * External URLs the document names that could NOT be imported (lib/web-assets).
   * Never a refusal: the document publishes and the reply says what failed and
   * how to fix it, because losing a whole document over one dead image link is
   * the worse answer. Absent when everything imported.
   */
  warnings?: AssetWarning[];
}

function tooLarge(value: string): Response | null {
  if (Buffer.byteLength(value, 'utf8') > MAX_CONTENT_BYTES) {
    return json({ error: 'too_large', maxBytes: MAX_CONTENT_BYTES }, 413);
  }
  return null;
}

/** "https://x.com/a/team-logo.png?v=2" → "team-logo" — a serviceable default title. */
const imageTitleFromUrl = (url: string): string | null => {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '').trim();
    return name || null;
  } catch { return null; }
};

export interface ContentInputCtx {
  /** Resolve a `ref:<id>` against the caller's own artifacts. Absent ⇒ ref checks skipped (preview). */
  loadRef?: import('./refs').RefLoader;
  /**
   * Import one external URL into the global asset cache under the caller's
   * identity (lib/artifacts assetImporterFor), answering null on success or the
   * warning to report. Absent ⇒ the door fetches nothing (preview: a draft that
   * previews must publish, and importing belongs to publish alone).
   */
  importAsset?: (url: string, kind: WebAssetKind) => Promise<AssetWarning | null>;
  /**
   * Resolve one font family the document names, answering a Response only when
   * it cannot be had. Absent ⇒ no resolution (preview): the door still
   * validates the NAME, so a draft that previews still publishes.
   */
  resolveFont?: (family: string) => Promise<Response | null>;
}

export async function parseContentInput(body: Record<string, unknown>, ctx: ContentInputCtx = {}): Promise<StoredContent | Response> {
  // Retired inputs, answered by name.
  const RETIRED: Record<string, string> = {
    markdown: 'markdown is not an authoring format here — send markup: prose is ordinary HTML tags (<h1>, <p>, <ul>…)',
    html: 'html is vocabulary inside markup now — send markup; put <style>/<script>/<title> in a top-level <Helmet>',
    jsx: 'the jsx field is retired — send markup',
  };
  for (const [key, hint] of Object.entries(RETIRED)) {
    if (typeof body[key] === 'string' && (body[key] as string).length > 0) {
      return json({ error: 'markup_only', hint }, 400);
    }
  }

  const textPresent = (['markup'] as const).filter(
    (k) => typeof body[k] === 'string' && (body[k] as string).length > 0,
  );
  // Data tiers carry structured payloads, not strings.
  const dataPresent = (['dataset', 'sheetUrl', 'csvUrl', 'imageUrl', 'viz', 'image'] as const).filter((k) => body[k] !== undefined && body[k] !== null);
  const present = [...textPresent, ...dataPresent];
  if (present.length !== 1) return json({ error: 'one_of_markup_dataset_viz_image' }, 400);
  const kind = present[0];
  // `dataset` accepts a JSON array (what an agent hand-writes) OR raw CSV text
  // (what a file or a sheet actually contains); `sheetUrl` fetches a public
  // Google Sheet. All three converge on the same rows — see lib/data-ingest.
  if (kind === 'dataset' || kind === 'sheetUrl' || kind === 'csvUrl') {
    const source =
      kind === 'sheetUrl' ? { kind: 'sheetUrl' as const, url: String(body.sheetUrl) }
      : kind === 'csvUrl' ? { kind: 'csvUrl' as const, url: String(body.csvUrl) }
      : typeof body.dataset === 'string' ? { kind: 'csv' as const, text: body.dataset }
      : null;
    if (!source) return await publishDataset(body, body.dataset); // already-typed JSON rows
    try {
      // Declared columns win over the sniffer — see lib/data-ingest/coerce.ts.
      const declared = Array.isArray(body.columns) ? (body.columns as { name: string; type: string }[]) : [];
      const ingested = await ingestDataset(source, declared);
      return await publishDataset({ ...body, __totalRows: ingested.totalRows, __truncated: ingested.truncated }, ingested.rows);
    } catch (error) {
      if (error instanceof IngestError) return json({ error: 'invalid_dataset', code: error.code, details: [error.message] }, 400);
      throw error;
    }
  }
  if (kind === 'imageUrl') {
    const ingested = await ingestImageFromUrl(String(body.imageUrl));
    if (ingested instanceof Response) return ingested;
    return { ...ingested, derivedTitle: typeof body.title === 'string' ? null : imageTitleFromUrl(String(body.imageUrl)) };
  }
  if (kind === 'viz') return publishVizRecipe(body, body.viz);
  if (kind === 'image') return await publishImage(body, body.image as string);
  const value = body[kind] as string;
  const sizeError = tooLarge(value);
  if (sizeError) return sizeError;

  // The document — `markup` (story JSX). publishJsx owns
  // theme/template/colorMode validation.
  return publishJsx(body, value, ctx);
}
