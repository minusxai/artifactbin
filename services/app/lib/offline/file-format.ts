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
  /** Compiled CSS for `source`; every font URL inlined as a data: URI. */
  css: string;
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

/**
 * Validates an untrusted value as an ArtifactFile. Throws ArtifactFileError with
 * a reader-facing message: a newer `format` says the file needs a newer
 * artifactbin; anything malformed says the file is damaged. Returns the value
 * unchanged when it is valid.
 */
export function parseArtifactFile(value: unknown): ArtifactFile {
  void value;
  throw new Error('not implemented: parseArtifactFile');
}
