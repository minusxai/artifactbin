import type { DatasetColumn } from "../contracts.ts";
/** Null preserves legacy untyped arguments: finite JSON scalars, never a guessed string type. */
export type DatasetMutationParameterType = DatasetColumn["type"] | null;
/** Publication-bound mapping from a control's row field to one fixed SQL parameter. */
export interface DatasetMutationRowParameter {
  param: string;
  type: DatasetMutationParameterType;
}
export type DatasetMutationRowParameters = Readonly<
  Record<string, DatasetMutationRowParameter>
>;
/** The edited scalar's fixed SQL slot. Inferred from its exact authored cell's typed column. */
export interface DatasetMutationValueParameter {
  param: string;
  type: DatasetColumn["type"];
}
