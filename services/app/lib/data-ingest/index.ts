import { coerceRows } from './coerce';
import { parseCsv } from './csv';
import { fetchSheetCsv } from './sheets';
import { fetchCsvFromUrl } from './csv-url';
import { MAX_ROWS_LIMIT } from '@/lib/config';
import { IngestError, MAX_DATASET_BYTES, type DatasetSource, type DeclaredColumn, type IngestResult } from './types';

export * from './types';

/**
 * Any supported source → the flat rows `publishDataset` already takes.
 *
 * The BYTE cap rejects; the ROW cap (MAX_ROWS_LIMIT) truncates and records
 * `totalRows`/`truncated`. A big sheet is a legitimate source and its first N
 * rows are useful where a 400 is not — but a chart built from a sample
 * believing it is the set is wrong without looking wrong, which is the failure
 * this whole tier exists to avoid, so the truncation is never silent.
 */
export async function ingestDataset(source: DatasetSource, declared: DeclaredColumn[] = []): Promise<IngestResult> {
  const text =
    source.kind === 'csv' ? source.text
    : source.kind === 'csvUrl' ? await fetchCsvFromUrl(source.url)
    : await fetchSheetCsv(source.url);

  // Byte cap first — before parsing, so an oversized file costs nothing.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_DATASET_BYTES) {
    throw new IngestError('too_large', `Dataset is ${Math.round(bytes / 1024 / 1024)} MB; the limit is ${MAX_DATASET_BYTES / 1024 / 1024} MB.`);
  }

  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) throw new IngestError('empty', 'No data found.');
  if (rows.length === 0) throw new IngestError('empty', 'The file has a header row but no data rows.');
  // Truncate rather than reject: a big sheet is a legitimate source, and the
  // first N rows are useful where a 400 is not. Recorded, never silent —
  // callers surface totalRows so nobody charts a sample believing it is the set.
  const kept = rows.length > MAX_ROWS_LIMIT ? rows.slice(0, MAX_ROWS_LIMIT) : rows;
  return {
    rows: coerceRows(headers, kept, declared),
    rowCount: kept.length,
    totalRows: rows.length,
    truncated: rows.length > MAX_ROWS_LIMIT,
    headers,
  };
}
