export interface MigrationStorageMeasurement {
  pages: number;
  sources: number;
  normalizedSourceBytes: number;
  largestNormalizedSourceBytes: number;
  /** UTF8 JSON representation, not PostgreSQL heap/index/WAL allocation. */
  uniqueBackendJsonBytes: number;
  rawArchiveRows: number;
  rawArchiveSourceBytes: number;
}
