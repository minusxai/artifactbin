// `inferColumns` and the dataset column types live in @artifactbin/utils/shape; re-exported
// under the local names the engine imports (src/engine.ts) and the package re-exports (src/index.ts).
export { inferColumns } from '@artifactbin/utils/shape';
export type { ColumnType, DatasetColumn } from '@artifactbin/utils/shape';
