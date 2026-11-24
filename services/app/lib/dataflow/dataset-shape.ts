/**
 * Column types and inference live with the SQL service (the engine infers the
 * same way).
 *
 * From `@artifactbin/utils/shape`, never the package root: the root also carries
 * HTTP clients and reaches `node:http` — and this
 * module is in the READER's graph, where that is not a size regression but a
 * build failure ("Could not resolve node:http"). The subpath is the pure half.
 */
export type { ColumnType, DatasetColumn } from '@artifactbin/contracts/sql';
export { inferColumns } from '@artifactbin/utils/shape';
