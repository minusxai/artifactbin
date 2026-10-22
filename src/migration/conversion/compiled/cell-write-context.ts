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
): void {
  const columns: Record<string, readonly DatasetColumn[]> = Object.create(null);
  for (const query of flow.queries)
    columns[query.name] = query.columns as readonly DatasetColumn[];
  for (const value of flow.values)
    if (value.kind === "table") columns[value.name] = value.columns ?? [];
  const sites = typeLegacyCellWriteSites(
    readLegacyCellWriteSites(source),
    columns,
  );
  for (const site of sites) {
    const matches = bindings.filter((b) => b.name === site.mutationName);
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
