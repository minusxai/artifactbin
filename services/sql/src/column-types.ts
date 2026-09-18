import type {ColumnType} from '@artifactbin/contracts';
/** Logical user identity stores the same stable scalar in tables and row parameters. */
export const COLUMN_SQL_TYPES:Record<ColumnType,string>={string:'VARCHAR',number:'DOUBLE',boolean:'BOOLEAN',date:'DATE',timestamp:'TIMESTAMPTZ',user:'VARCHAR'};
