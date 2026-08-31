/**
 * Ingesting a DATA FILE — the contracts.
 *
 * Everything here converges on the shape `publishDataset` already accepts
 * (a flat array of objects), so no new artifact tier and nothing downstream
 * changes: `ref:<id>`, <Question>, <Number>, <Param> and Vega are untouched.
 *
 * The one thing ingest must do that the JSON path never had to: DECIDE TYPES.
 * CSV has none — every cell is a string — and handing raw parser output to
 * inferColumns types every column `string`, which silently breaks a Vega
 * quantitative encoding. Measured, not assumed: see data-artifacts-v2.md §2.
 */

/** What we were handed. Both forms end at the same rows. */
export type DatasetSource =
  | { kind: 'csv'; text: string }
  | { kind: 'sheetUrl'; url: string }
  | { kind: 'csvUrl'; url: string };

/** Types the caller declared for columns — they win over the sniffer. */
export interface DeclaredColumn { name: string; type: string }

export interface IngestResult {
  /** Flat objects, coerced — fed straight to publishDataset. At most MAX_ROWS_LIMIT. */
  rows: Record<string, unknown>[];
  /** Rows KEPT (rows.length). */
  rowCount: number;
  /** Rows the source actually had, which may exceed rowCount. */
  totalRows: number;
  /** True when the source had more rows than the limit. Never silent. */
  truncated: boolean;
  /** The header order as it appeared, so column order survives the round trip. */
  headers: string[];
}

export type IngestErrorCode =
  | 'empty'            // no content at all
  | 'no_header'        // header row missing or entirely blank
  | 'too_many_rows'    // over MAX_DATASET_ROWS
  | 'too_large'        // over MAX_DATASET_BYTES
  | 'not_a_sheet_url'  // not a docs.google.com spreadsheet link
  | 'csv_fetch_failed' // the csvUrl fetch was refused (lib/web-ingest names why)
  | 'sheet_not_public' // fetched, but Google did not give us CSV
  | 'fetch_failed';    // network/timeout

/** Carries a code so routes can map to HTTP without string-matching messages. */
export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

/**
 * Caps. There is currently NO limit anywhere (10k rows / 604 KB was accepted),
 * which is survivable while only agents hand-write JSON and an outage once we
 * accept uploaded files. Generous for a story dataset, far below where a single
 * row hurts Postgres.
 */
export const MAX_DATASET_ROWS = 500_000;
export const MAX_DATASET_BYTES = 50 * 1024 * 1024;

/** A parsed CSV, before any type decisions. */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}
