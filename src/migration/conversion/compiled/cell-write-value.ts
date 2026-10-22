import type { DatasetMutationValueParameter } from "../../../datasets/mutation/parameter-contracts.ts";
import { datasetMutationScalar } from "../../../datasets/mutation/parameter-scalars.ts";
import { validLocalValue } from "./local-state.ts";
/** Exact archived mutation-request empty-value normalization; no primitive coercion. */
export function normalizeCompiledCellValue(
  binding: DatasetMutationValueParameter,
  value: unknown,
): string | number | boolean | null {
  const normalized = binding.type !== "string" && value === "" ? null : value;
  if (
    !datasetMutationScalar(normalized) ||
    !validLocalValue(
      { name: "cell", type: binding.type, default: null },
      normalized,
    )
  )
    throw Error("Invalid registered cell value");
  return normalized;
}
