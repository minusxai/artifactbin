/**
 * WHERE A PAGE READ'S ROWS CAME FROM: the `source` the page SQL door puts on every successful read's answer
 * (`{columns, rows, source}`), and the page runtime keeps on the rows (`rows.source`, out of iteration and JSON).
 * `<af-chart>` and `<af-data-table>` label themselves from it (lib/html-component-specs data-source). Never on a
 * refusal, and never a dataset's ID or a connection's details: only the page's own link names and a time.
 *
 * - `live`: read just now on a connection as the reader; `at` is when.
 * - `snapshot`: stored rows (an uploaded or stored dataset); `at` is when the newest of them was stored, `names` the
 *   page's links the statement read.
 * - `file`: rows from files beside the page, read in the frame (a draft's linked CSV or JSON, lib/page-drafts); `names`
 *   the files' paths. A file carries no time, so none is said.
 * A replayed stored answer would be another kind, `cached` (`at`: when it was read); nothing answers one yet.
 */
export type SqlAnswerSource = { kind: 'live' | 'snapshot'; at: string; names?: string[] } | { kind: 'file'; names: string[] };

/** A live read's source, stamped now. */
export const liveSource = (): SqlAnswerSource => ({ kind: 'live', at: new Date().toISOString() });
