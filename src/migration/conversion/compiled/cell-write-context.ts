import {validCellUserChoiceBindings} from "./cell-user-choice-runtime.ts";
/** Offline-only cross-check against the archived compiler's actual inferred query columns. */
import type { DatasetColumn } from "../../../datasets/contracts.ts";
import type { CompiledDatasetMutation } from "./dataset-mutations-contracts.ts";
import {
  readLegacyCellWriteSites,
  typeLegacyCellWriteSites,
} from "./cell-write-source.ts";
export interface CompiledCellWriteFlow {
  queries: readonly {
    name: string;
    columns: readonly { name: string; type?: DatasetColumn["type"] | null }[];
  }[];
  values: readonly {
    name: string;
    kind: string;
    columns?: readonly DatasetColumn[];
  }[];
}
export function validateCompiledCellWriteContexts(
  source: string,
  flow: CompiledCellWriteFlow,
  bindings: readonly CompiledDatasetMutation[],
  sourceAdmission:import("./local-contracts.ts").CompiledSourceAdmission="strict",
  userChoices:readonly import("./cell-user-choice-contracts.ts").CompiledCellUserChoiceBinding[]=[],
): void {
  if(!validCellUserChoiceBindings(userChoices))throw Error("Invalid cell choice binding");
  const columns: Record<string, readonly import("./cell-write-contracts.ts").LegacyCellWriteColumn[]> = Object.create(null);
  for (const query of flow.queries)
    columns[query.name] = query.columns;
  for (const value of flow.values)
    if (value.kind === "table") columns[value.name] = value.columns ?? [];
  const sites = typeLegacyCellWriteSites(
    readLegacyCellWriteSites(source,undefined,sourceAdmission),
    columns,
    sourceAdmission,
  );
  for(const choice of userChoices)if(!sites.some(site=>site.implicitUserOptions&&site.dataName===choice.queryName&&site.column===choice.column))throw Error("Unused cell choice binding");
  for (const site of sites) {
    const matches = bindings.filter((b) => b.name === site.mutationName);
    if(site.implicitUserOptions){
      const choices=userChoices.filter(c=>c.queryName===site.dataName&&c.column===site.column);
      if(choices.length!==1||choices[0]!.backendNamespace!==matches[0]?.backendNamespace)throw Error("Missing registered cell choice route");
    }
    if (matches.length !== 1 || matches[0]!.valueParam?.type !== site.type)
      throw Error("Editing cell type mismatch");
  }
  for (const binding of bindings)
    if (
      binding.valueParam &&
      !sites.some((s) => s.mutationName === binding.name)
    )
      throw Error("Missing editing cell source");
}
