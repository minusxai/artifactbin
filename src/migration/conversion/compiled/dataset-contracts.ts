/** Metadata only. Dataset rows and storage addresses never enter compiled page source. */
export interface CompiledDatasetColumn {
  name: string;
  type: string;
}
export interface CompiledDatasetBinding {
  name: string;
  legacyRef: string;
  backendNamespace: string;
  backendHref: string;
  /** Pinned dataset version, not the backend's compiled version. */
  version: number;
  tables: readonly {
    schema: string;
    table: string;
    columns: readonly CompiledDatasetColumn[];
  }[];
}
export interface DatasetReadArguments {
  binding: string;
  schema: string;
  table: string;
  offset: number;
  limit: number;
}
export interface DatasetReadWindow {
  version: number;
  schema: string;
  table: string;
  columns: CompiledDatasetColumn[];
  rows: Record<string, string | number | boolean | null>[];
  offset: number;
  nextOffset: number | null;
  totalRows: number;
}
export type DatasetReadRequest = (
  namespace: string,
  args: DatasetReadArguments,
) => Promise<DatasetReadWindow>;
export interface DatasetReadLimits {
  maxBytes: number;
  maxRows: number;
  timeoutMs: number;
  pageSize: number;
}

export interface DatasetReadBudget {
  bytes: number;
  rows: number;
}
