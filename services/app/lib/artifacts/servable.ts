import { json } from '../http';

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

/** Native HTML requires source bytes. Retired markup is never rendered or converted. */
export function unservable(row: StoredRow): UnservableDocument | null {
 if(row.format==='markup'||row.format==='program')return new UnservableDocument(row.version,'unreadable');
 if(row.format==='html'&&!(typeof row.source==='string'&&row.source.trim()))return new UnservableDocument(row.version,'unreadable');
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
