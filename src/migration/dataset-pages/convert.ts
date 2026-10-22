import type { ConversionOutput } from "../contracts.ts";
import type { StandaloneDatasetPageInput } from "./contracts.ts";
import { planStandaloneDatasetPage } from "./plan.ts";
import { renderStandaloneDatasetPage } from "./render.ts";
/** Opt-in adapter for a separate additive import; existing format dispatch is unchanged. */
export function convertStandaloneDatasetPage(
  input: StandaloneDatasetPageInput,
): ConversionOutput {
  const plan = planStandaloneDatasetPage(input);
  const ids =
    plan.kind === "ready"
      ? [
          "dataset-table",
          "dataset-status",
          "dataset-grid",
          "dataset-previous",
          "dataset-next",
          "dataset-refresh",
        ]
      : [];
  return {
    classification: plan.kind === "ready" ? "functional" : "renderable",
    html: renderStandaloneDatasetPage(plan),
    identities: Object.fromEntries(ids.map((id) => [id, id])),
    issues: plan.kind === "unavailable" ? [{ code: plan.reason }] : [],
  };
}
