/**
 * THE OFFLINE ARTIFACT FILE — what a downloaded `.html` carries.
 *
 * One JSON block inside the file (`#afbin-file`) holds everything the page
 * needs to render, edit and comment without a network: the document source,
 * the runtime island (URLs stripped), compiled CSS with fonts inlined, the
 * data snapshot with precomputed filter variants, the comment threads and a
 * journal of offline edits. The server writes it at download
 * (lib/offline/download.server.ts); the file's own Save rewrites it
 * (lib/offline/file-html.ts). Both sides go through this contract.
 *
 * `base` is the version the file was downloaded from, so a later sync can
 * three-way merge `source` onto whatever the artifact has become. Nothing in
 * this file is trusted by the server: a sync re-validates all of it.
 */
import type { AnnotationWire } from '@/lib/annotations';
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { DataflowState, Scalar, TableResult } from '@/lib/story/dataflow';

export const ARTIFACT_FILE_FORMAT = 1 as const;

/** One precomputed filter combination: the Values it was run with, and the queries whose results differ from the base. */
export interface ArtifactFileVariant {
  values: Record<string, Scalar>;
  tables: Record<string, TableResult>;
  errors: Record<string, string>;
}

export interface ArtifactFileSnapshot {
  /** ISO time the queries ran; shown in the file's top bar. */
  at: string;
  /** The results at the document's values when downloaded. */
  state: DataflowState;
  /** Results for other filter combinations, computed by the server's own engine. */
  variants: ArtifactFileVariant[];
  /**
   * Values that feed a query but could not be precomputed (free text, dates,
   * numbers, or past the cap). Their controls are disabled offline with
   * OFFLINE_FILTER_REASON.
   */
  frozen: string[];
}

export interface ArtifactFileEdit {
  at: string;
  /** The name picked in the file (or the downloader's account label). */
  by: string;
  summary: string;
}

export interface ArtifactFileCss {
  base: string;
  compiled: string | null;
  author: string | null;
}

export interface ArtifactFile {
  format: typeof ARTIFACT_FILE_FORMAT;
  /** Where the file came from, e.g. https://app.artifactbin.dev. */
  origin: string;
  artifactId: string;
  /** Link to the live document, shown in the top bar. */
  liveUrl: string;
  /** Who downloaded it, as a display label, and when. */
  downloadedBy: string;
  downloadedAt: string;
  base: { version: number; editId: string; source: string };
  /** The document now — equal to base.source until someone edits the file. */
  source: string;
  metadata: {
    title: string;
    description: string | null;
    theme: string | null;
    template: string | null;
    colorMode: 'light' | 'dark' | null;
  };
  /**
   * The document's stylesheet, in the three parts the runtime takes them
   * (PreparedStoryRuntime's baseCss / compiledCss / authorCss), every font and
   * image URL inlined as a data: URI:
   *  - `base`: the runtime's own sheet and the theme's fonts;
   *  - `compiled`: the Tailwind sheet for `source` — the one part an edit in
   *    the file recompiles (lib/offline/file-backend);
   *  - `author`: the document's own `<Helmet>` `<style>`.
   */
  css: ArtifactFileCss;
  /** The runtime island for `source`, with no server URLs (queryUrl, mutateUrl, assetsUrl …) and images as data: URIs. */
  island: StoryIslandData;
  snapshot: ArtifactFileSnapshot;
  journal: ArtifactFileEdit[];
  /** Server threads visible to the downloader, plus threads and replies made in a file. */
  threads: AnnotationWire[];
  /** Ids of threads and replies created in a file and not yet on the server. */
  localIds: string[];
  /** Which offline bundle this file carries. */
  bundle: 'core' | 'mermaid';
}

export class ArtifactFileError extends Error {}

/** Reader-facing reasons, shown in place of a disabled control. */
export const OFFLINE_FILTER_REASON = 'This filter needs a connection. Showing data as of the download.';
export const OFFLINE_MUTATION_REASON = 'Saving data needs artifactbin. Open the live version.';
export const OFFLINE_QUERY_REASON = 'Running queries needs a connection.';
export const OFFLINE_ASSET_REASON = 'Adding web images, fonts, files or icons needs a connection.';

/** What a reader sees for a file this build cannot read. */
const NEWER_MESSAGE = 'This file was saved by a newer artifactbin. Open it in a current version of artifactbin, or open the live version.';
const DAMAGED_MESSAGE = 'This file is damaged and cannot be opened. Download it again from artifactbin.';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isStringOrNull = (v: unknown) => v === null || isString(v);
const isStringList = (v: unknown) => Array.isArray(v) && v.every(isString);
const isRecordOf = (v: unknown, ok: (x: unknown) => boolean) => isObject(v) && Object.values(v).every(ok);
const isTable = (v: unknown) => isObject(v) && Array.isArray(v.rows) && Array.isArray(v.columns);
const isState = (v: unknown) => isObject(v) && isObject(v.values) && isRecordOf(v.tables, isTable) && isRecordOf(v.errors, isString);
const isVariant = (v: unknown) => isObject(v) && isObject(v.values) && isRecordOf(v.tables, isTable) && isRecordOf(v.errors, isString);
const isEdit = (v: unknown) => isObject(v) && isString(v.at) && isString(v.by) && isString(v.summary);

/**
 * The shape checks, top-level first. Deliberately structural rather than a
 * full schema of every node and table: the file's own code only needs these
 * fields to be the right KIND to render without throwing, and the server
 * re-validates everything a sync sends it.
 */
function isWellFormed(v: Json): boolean {
  const { base, metadata, island, snapshot } = v;
  return isString(v.origin) && isString(v.artifactId) && isString(v.liveUrl)
    && isString(v.downloadedBy) && isString(v.downloadedAt)
    && isObject(base) && typeof base.version === 'number' && Number.isInteger(base.version) && isString(base.editId) && isString(base.source)
    && isString(v.source)
    && isObject(metadata) && isString(metadata.title) && isStringOrNull(metadata.description)
      && isStringOrNull(metadata.theme) && isStringOrNull(metadata.template)
      && (metadata.colorMode === null || metadata.colorMode === 'light' || metadata.colorMode === 'dark')
    && isObject(v.css) && isString(v.css.base) && isStringOrNull(v.css.compiled) && isStringOrNull(v.css.author)
    && isObject(island) && Array.isArray(island.nodes) && isObject(island.refData)
    && isObject(snapshot) && isString(snapshot.at) && isState(snapshot.state)
      && Array.isArray(snapshot.variants) && snapshot.variants.every(isVariant) && isStringList(snapshot.frozen)
    && Array.isArray(v.journal) && v.journal.every(isEdit)
    && Array.isArray(v.threads) && v.threads.every(isObject)
    && isStringList(v.localIds)
    && (v.bundle === 'core' || v.bundle === 'mermaid');
}

/**
 * Validates an untrusted value as an ArtifactFile. Throws ArtifactFileError with
 * a reader-facing message: a newer `format` says the file needs a newer
 * artifactbin; anything malformed says the file is damaged. Returns the value
 * unchanged when it is valid.
 */
export function parseArtifactFile(value: unknown): ArtifactFile {
  if (!isObject(value)) throw new ArtifactFileError(DAMAGED_MESSAGE);
  // The format is checked BEFORE the shape: a newer file is allowed to look
  // different, and saying "damaged" about it would send the reader the wrong way.
  const format = value.format;
  if (typeof format === 'number' && Number.isInteger(format) && format > ARTIFACT_FILE_FORMAT) throw new ArtifactFileError(NEWER_MESSAGE);
  if (format !== ARTIFACT_FILE_FORMAT || !isWellFormed(value)) throw new ArtifactFileError(DAMAGED_MESSAGE);
  return value as unknown as ArtifactFile;
}
