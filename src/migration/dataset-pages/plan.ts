import { validDatasetBinding } from "../conversion/compiled/dataset-reader.ts";
import type {
  StandaloneDatasetPageInput,
  StandaloneDatasetPagePlan,
} from "./contracts.ts";
/** Accept only the importer supplied browser projection, never a raw source catalog. */
export function planStandaloneDatasetPage(
  input: StandaloneDatasetPageInput,
): StandaloneDatasetPagePlan {
  if (
    !input ||
    typeof input.title !== "string" ||
    input.title.length > 10000 ||
    input.coreUrl !== "/af/v1/core.js"
  )
    throw Error("Invalid standalone dataset page");
  if (input.source?.kind === "external" && input.source.registered === false)
    return {
      kind: "unavailable",
      title: input.title,
      coreUrl: input.coreUrl,
      reason: "external-registration-required",
    };
  if (
    input.source?.kind !== "stored" ||
    !validDatasetBinding(input.source.binding)
  )
    throw Error("Invalid standalone dataset page");
  return {
    kind: "ready",
    title: input.title,
    coreUrl: input.coreUrl,
    binding: structuredClone(input.source.binding),
  };
}
