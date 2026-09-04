/**
 * Shared request-body → stored-content translation for POST and PUT. A body
 * carries exactly ONE content field:
 *   - `markup`   — THE document: story JSX over the kit, the data embeds, the
 *     HTML vocabulary and <Helmet>. The ONLY document input there is.
 *   - `dataset` | `viz` | `image` | `pdf` — the data tiers
 *   - `format: 'folder'` — the ONE body with no content field at all. A folder
 *     is a document whose source the CREATE door stamps (lib/folders
 *     folderScaffold), so there is nothing for a caller to send and nothing
 *     here to parse: it leaves with `content: ''`, `source: ''`.
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
import { ingestPdfFromUrl } from '@/lib/web-ingest/pdf';
import type { AssetWarning, WebAssetKind } from '@/lib/web-assets';
import { publishDataset, publishVizRecipe, publishImage, publishPdf } from './data-tiers';


export const MAX_CONTENT_BYTES = 2_000_000;

/**
 * THE format vocabulary — the wire, the DB, the pages and MCP all speak the
 * same values; `markup` is THE document format and the rest are data tiers.
 *
 * The runtime list and the type are ONE declaration, so a reader that has to
 * ask "is this a format we serve?" (the page, the raw route) cannot drift from
 * the type the wire is checked against.
 */
export const ARTIFACT_FORMATS = ['markup', 'dataset', 'viz', 'image', 'pdf', 'folder'] as const;
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number];

import type { SourceRepair } from '@/lib/jsx/repair';

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
  /**
   * Changes the door made to the source on the way in (lib/jsx/repair) — today
   * only the shell-escaped backtick. Present ONLY when something was changed,
   * and present is the point: the door is allowed to repair an agent's markup
   * exactly because it names what it did, rather than rewriting SQL in silence.
   */
  repairs?: SourceRepair[];
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
  /**
   * "Is the caller already over their stored-byte quota?" — asked BEFORE a
   * tier stores something large, and answered by lib/asset-quota under the
   * caller's identity (account-keyed for a claimed token, token-keyed for an
   * anonymous one). Absent ⇒ nothing is charged (preview: a draft that
   * previews stores nothing, so there is nothing to bill).
   *
   * A closure rather than a token id, for the reason importAsset is one: this
   * module has no business knowing who is publishing, only whether the door
   * is open. It is a PRE-check and not a reservation — an account a byte under
   * the cap stores its file and is refused the next one, which is the same
   * rule importWebAsset ships.
   *
   * And by its ABSENCE it is what tells the BYTE tiers they are being
   * previewed. Every other member above degrades to "do less"; the PDF and
   * image tiers cannot, because storing the bytes IS publishing one, so they
   * refuse by name instead (`*_not_previewable`, below).
   */
  overByteQuota?: () => Promise<boolean>;
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
  const dataPresent = (['dataset', 'sheetUrl', 'csvUrl', 'imageUrl', 'viz', 'image', 'pdf', 'pdfUrl'] as const).filter((k) => body[k] !== undefined && body[k] !== null);
  const present = [...textPresent, ...dataPresent];
  /*
   * A FOLDER IS THE ONE BODY WITH NO CONTENT. Its source is a product-owned
   * constant the create door stamps with the row's own id — which cannot be
   * known here, because the id is minted at INSERT — so this returns the empty
   * stored state and `createArtifact` fills it in. A body that names the format
   * AND sends content is still the one-of refusal: it is asking for two things.
   */
  if (body.format === 'folder' && present.length === 0) {
    return { format: 'folder', content: '', source: '', meta: {}, derivedTitle: null };
  }
  if (present.length !== 1) return json({ error: 'one_of_markup_dataset_viz_image_pdf' }, 400);
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
  /*
   * THE IMAGE TIER, BOTH SHAPES — the upload and the URL import — behind one
   * gate, because the cost is the same object either way.
   *
   * NO HOOK, NO TIER. `/api/preview` promises that a draft persists nothing,
   * and this is the tier that cannot keep it: storing the bytes IS publishing
   * an image, and the object would then exist with no artifact row naming it —
   * THE DB IS THE ONLY INDEX, so nothing could ever find it again, bill it, or
   * delete it. Any credential could have filled the disk a few megabytes at a
   * time. So a caller with no quota to charge is refused BY NAME rather than
   * quietly given the tier for free. It costs the product nothing: the only
   * caller of /api/preview here is the editor's draft-CSS compile, which sends
   * `markup` (its data re-run goes to /api/query), and the docs never teach the
   * route. The PDF tier answers `pdf_not_previewable` to the same question.
   *
   * Asked BEFORE the fetch, so a caller over their cap cannot spend our
   * bandwidth either — and so a preview is not an image-fetch primitive.
   */
  if (kind === 'image' || kind === 'imageUrl') {
    if (!ctx.overByteQuota) {
      return json({
        error: 'image_not_previewable',
        details: ['an image cannot be previewed — previewing stores nothing, and storing the bytes IS publishing it. POST it to /api/artifacts instead.'],
      }, 400);
    }
    if (await ctx.overByteQuota()) {
      return json({ error: 'quota_exceeded', details: ['this account is over its stored-byte quota — delete assets you no longer need'] }, 403);
    }
    if (kind === 'imageUrl') {
      const ingested = await ingestImageFromUrl(String(body.imageUrl));
      if (ingested instanceof Response) return ingested;
      return { ...ingested, derivedTitle: typeof body.title === 'string' ? null : imageTitleFromUrl(String(body.imageUrl)) };
    }
    return await publishImage(body, body.image as string);
  }
  /*
   * THE ONE PLACE THE BYTE QUOTA IS CHARGED at this door, and it guards both
   * PDF shapes at once — the upload and the import — because the cost is the
   * same 25 MB either way. Asked BEFORE the fetch, so a caller over their cap
   * cannot spend our bandwidth either.
   *
   * NO HOOK, NO TIER, for the reason written out over the image tier above —
   * at 25 MB a time rather than a few. The two tiers refuse identically
   * because they are the same failure: an object stored with no artifact row
   * naming it, in an app where THE DB IS THE ONLY INDEX.
   */
  if (kind === 'pdf' || kind === 'pdfUrl') {
    if (!ctx.overByteQuota) {
      return json({
        error: 'pdf_not_previewable',
        details: ['a pdf cannot be previewed — previewing stores nothing, and storing the file IS publishing it. POST it to /api/artifacts instead.'],
      }, 400);
    }
    if (await ctx.overByteQuota()) {
      return json({ error: 'quota_exceeded', details: ['this account is over its stored-byte quota — delete assets you no longer need'] }, 403);
    }
    if (kind === 'pdfUrl') {
      const ingested = await ingestPdfFromUrl(String(body.pdfUrl));
      if (ingested instanceof Response) return ingested;
      return { ...ingested, derivedTitle: typeof body.title === 'string' ? null : imageTitleFromUrl(String(body.pdfUrl)) };
    }
    return await publishPdf(body, body.pdf as string);
  }
  if (kind === 'viz') return publishVizRecipe(body, body.viz);
  const value = body[kind] as string;
  const sizeError = tooLarge(value);
  if (sizeError) return sizeError;

  // The document — `markup` (story JSX). publishJsx owns
  // theme/template/colorMode validation.
  return publishJsx(body, value, ctx);
}
