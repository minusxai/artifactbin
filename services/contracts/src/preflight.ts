/**
 * Publication preflight: the dependency vocabulary shared by the CLI and the server.
 *
 * A document's local dependencies are described by hash, never by bytes. The
 * server validates the document against the declared formats and reports which
 * assets the actor already owns, so the CLI uploads only what is missing.
 * Datasets are the exception: their rows must be present for query validation.
 */

/** A local image, PDF or generic file, described without its bytes. */
export interface PreflightAssetDependency {
  /** The placeholder id used in the document, `local000001` style; substituted by the CLI after publication. */
  id: string;
  /** Lower-case hex sha256 of the exact local file bytes (the bytes the CLI would upload). */
  sha256: string;
  /** Byte length of those bytes. */
  size: number;
  /** The local basename; its extension decides the format the server validates against. */
  filename: string;
}

/** A local CSV or JSON dataset, sent with its rows because validation queries them. */
export interface PreflightDatasetDependency {
  id: string;
  input: {dataset: unknown};
}

export type PreflightDependency = PreflightAssetDependency | PreflightDatasetDependency;

export const PREFLIGHT_ASSET_FORMATS = ['image', 'pdf', 'file'] as const;
export type PreflightAssetFormat = typeof PREFLIGHT_ASSET_FORMATS[number];

/** One line per declared dependency in a successful preflight response. */
export interface PreflightDependencyResult {
  id: string;
  format: PreflightAssetFormat | 'dataset';
  /**
   * An artifact the actor OWNS (never merely edits) whose current head was
   * uploaded from bytes with this sha256, and which is not deleted. The CLI
   * references it instead of uploading. Always null for datasets.
   */
  existing: string | null;
}

export const SHA256_HEX = /^[a-f0-9]{64}$/;
/** The largest dependency list a single preflight accepts. */
export const MAX_PREFLIGHT_DEPENDENCIES = 100;

export const isPreflightAssetDependency = (value: PreflightDependency): value is PreflightAssetDependency => 'sha256' in value;
