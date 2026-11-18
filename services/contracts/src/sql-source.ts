/**
 * WHERE A PAGE READ'S ROWS CAME FROM: the `source` the page SQL door puts on every successful read's answer
 * (`{columns, rows, source}`), and the page runtime keeps on the rows (`rows.source`, out of iteration and JSON).
 * `<af-chart>` and `<af-data-table>` label themselves from it (lib/html-component-specs data-source). Never on a
 * refusal, and never a dataset's ID or a connection's details: only the page's own link names and a time.
 *
 * - `live`: read just now on a connection as the reader; `at` is when.
 * - `snapshot`: stored rows (an uploaded or stored dataset); `at` is when the newest of them was stored, `names` the
 *   page's links the statement read.
 * A replayed stored answer would be a third kind, `cached` (`at`: when it was read); nothing answers one yet.
 */
type SqlSourceKind = 'live' | 'snapshot';
export interface SqlAnswerSource { kind: SqlSourceKind; at: string; names?: string[] }

/** A live read's source, stamped now. */
export const liveSource = (): SqlAnswerSource => ({ kind: 'live', at: new Date().toISOString() });
