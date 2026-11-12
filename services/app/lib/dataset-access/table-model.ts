/**
 * ONE TABLE AS A ROLE READS AND WRITES IT (./linked): the columns it may select, the columns each write rule lets it
 * name and what it may change. SQL uses stored `source` names. Persisted Hasura-style `field` identifiers
 * still address collaborative cells and policy metadata.
 */
import type { DatasetBoolExp, DatasetTableName, Scalar } from '@artifactbin/contracts';

export type HasuraScalar = 'String' | 'Float' | 'Boolean';
export interface HasuraColumn {
  /** The persisted field identifier (lib/datasets/graphql-names). */
  field: string;
  /** The stored source column it reads. */
  source: string;
  type: HasuraScalar;
  /** A text column the policy names in `collaborative_columns`: its cells may be edited collaboratively. */
  collaborative?: boolean;
}
export interface HasuraTableModel {
  root: string;
  /** The engine table the reads compile against. */
  table: DatasetTableName;
  /** The columns the role may select, in declared order. */
  columns: readonly HasuraColumn[];
  /** The select rule's row limit, when it has one. */
  limit?: number;
  /** May the role select this table (default true)? Without it `columns` is empty and only `write` applies. */
  select?: boolean;
  write?: HasuraWriteModel;
  /** What `_can` and `<root>_can` answer for this caller; absent, every answer is false. */
  can?: HasuraCan;
}
/**
 * Whether a row-addressed rule (update, delete) admits a row: for every row (owner, editor, an empty filter), for
 * none (no usable rule), or as the rule's filter decides for that row under the caller's session.
 */
export type HasuraRowCan = boolean | { filter: DatasetBoolExp; session: Readonly<Record<string, Scalar>> };
export interface HasuraCan { insert: boolean; update: HasuraRowCan; delete: HasuraRowCan }
/** The columns each of the role's write rules lets it name; an absent key is a rule the role does not have. */
export interface HasuraWriteModel {
  /** Columns an insert may name: the rule's columns less its presets. */
  insert?: readonly HasuraColumn[];
  /** Columns `_set` may name (`_inc`: the numeric ones): the rule's columns less its presets. */
  update?: readonly HasuraColumn[];
  delete?: boolean;
}
