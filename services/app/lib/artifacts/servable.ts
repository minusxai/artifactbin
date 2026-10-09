/**
 * A STORED DOCUMENT THE CURRENT CODE STILL SERVES — or the one refusal for one it no longer does.
 *
 * Two stored shapes are retired, and nothing converts them any more:
 *  - a markup row without `meta.dataSyntax: 2` (lib/dataflow/data-syntax): written for the
 *    previous query engine, whose converter was deleted once production had run it;
 *  - a markup row whose stored document is not a graph this code decodes. lib/artifacts/document
 *    hands such a row back with `source: null` beside the `document` it could not read; a row with
 *    only the retired `source` column and no graph is the same case.
 *
 * Neither is guessed at, converted on the fly or rendered stale. Every read path that serves a
 * document's content (the render doors, the version read-back, the editor's read, a restore) passes
 * the row through {@link servableDocument}, which throws {@link UnservableDocument}; the door answers
 * it through {@link refusingUnservable}. On production such rows survive only in archived versions and
 * trashed heads, and the database dump taken before the backfills holds their bytes.
 */
import { json } from '../http/http';
import { hasCurrentDataSyntax } from '@/lib/dataflow/data-syntax';

const STATUS = 410;
const CODE = 'unservable_document';

/** The refusal, thrown by {@link servableDocument}; a door answers it through {@link refusingUnservable}. */
export class UnservableDocument extends Error {
  readonly status = STATUS;
  readonly code = CODE;
  constructor(readonly version: number, readonly reason: 'data_syntax' | 'unreadable') {
    super(reason === 'data_syntax'
      ? `Version ${version} of this document predates the current data syntax and is no longer converted; restore it from the backup if it is needed.`
      : `Version ${version} of this document is stored in a form this server no longer reads; restore it from the backup if it is needed.`);
    this.name = 'UnservableDocument';
  }

  /** The refusal as a door answers it. */
  response(headers: Record<string, string> = {}): Response {
    return json({ error: this.code, message: this.message }, this.status, headers);
  }
}

interface StoredRow {
  format: string;
  version: number;
  meta?: unknown;
  source?: string | null;
  document?: unknown;
}

const isGraph = (document: unknown): boolean =>
  !!document && typeof document === 'object' && (document as { kind?: unknown }).kind === 'graph';

/** Why the current code does not serve this row, or null when it does. Only markup is judged. */
export function unservable(row: StoredRow): UnservableDocument | null {
  if (row.format !== 'markup') return null;
  // A row read without its `document` column is judged by the source it decoded to.
  if (('document' in row && !isGraph(row.document)) || typeof row.source !== 'string') return new UnservableDocument(row.version, 'unreadable');
  if (!hasCurrentDataSyntax(row.meta)) return new UnservableDocument(row.version, 'data_syntax');
  return null;
}

/** THE CHECK the read paths call: the row unchanged when the current code serves it, else {@link UnservableDocument} thrown. */
export function servableDocument<T extends StoredRow>(row: T): T {
  const refusal = unservable(row);
  if (refusal) throw refusal;
  return row;
}

/** A door's work, with a thrown {@link UnservableDocument} answered as its 410; any other error propagates. */
export async function refusingUnservable(work: () => Promise<Response>, headers: Record<string, string> = {}): Promise<Response> {
  try { return await work(); }
  catch (error) {
    if (error instanceof UnservableDocument) return error.response(headers);
    throw error;
  }
}
