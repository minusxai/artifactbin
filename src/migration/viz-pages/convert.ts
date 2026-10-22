import type {
  VizRecipePageInput,
  VizRecipePageConversion,
} from "./contracts.ts";
import { planVizRecipePage } from "./plan.ts";
import { renderVizRecipePage } from "./render.ts";
/** Explicit opt-in adapter; ordinary imports and frozen conversion inputs are unchanged. */
export function convertVizRecipePage(
  input: VizRecipePageInput,
): VizRecipePageConversion {
  const plan = planVizRecipePage(input),
    ids = [
      "viz-recipe-description",
      "viz-recipe-slots",
      "viz-recipe-copy",
      "viz-recipe-download",
      "viz-recipe-status",
      "viz-recipe-source",
    ];
  return {
    classification: "functional",
    html: renderVizRecipePage(plan),
    identities: Object.fromEntries(ids.map((id) => [id, id])),
    issues: [],
    vizRecipeProvenance: plan.provenance,
  };
}
