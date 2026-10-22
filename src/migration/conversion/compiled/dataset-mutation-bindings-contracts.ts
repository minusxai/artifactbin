import type { CompiledDatasetMutation } from "./dataset-mutations-contracts.ts";
import type { DatasetMutationParameterType } from "../../../datasets/mutation/parameter-contracts.ts";
/** Owned immutable public metadata; no transport, state, source AST or SQL. */
export interface AdmittedCompiledDatasetMutation
  extends Readonly<CompiledDatasetMutation> {
  readonly flatParamTypes: Readonly<
    Record<string, DatasetMutationParameterType>
  >;
}
export type AdmitCompiledDatasetMutationBindings = (
  bindings: unknown,
) => readonly AdmittedCompiledDatasetMutation[];
