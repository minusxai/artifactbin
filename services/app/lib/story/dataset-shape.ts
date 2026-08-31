/**
 * Column types and inference live with the SQL service (the engine infers the
 * same way); the viz kind is the document's.
 *
 * From `@artifactbin/utils/shape`, never the package root: the root also carries
 * HTTP clients and reaches `node:http` — and this
 * module is in the READER's graph, where that is not a size regression but a
 * build failure ("Could not resolve node:http", see CLAUDE.md on the browser
 * bundle holding no server config). The subpath is the pure half.
 */
export type { ColumnType, DatasetColumn } from '@artifactbin/contracts';
export { inferColumns } from '@artifactbin/utils/shape';
import type { ColumnType } from '@artifactbin/contracts';

export const columnVizKind = (t: ColumnType): 'quantitative' | 'temporal' | 'nominal' =>
  t === 'number' ? 'quantitative' : t === 'date' ? 'temporal' : 'nominal';
