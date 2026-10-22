import type {
  ArchivedRuntimeCapability,
  ArchivedRuntimePlan,
  ArchivedRuntimeRequirements,
} from "./runtime-plan-contracts.ts";

/** Every capability explicitly chooses a graph. Person navigation requires its source adapter. Other read bindings and
 * resources do not by themselves replace the frozen manifest. These are compiler requirements, never grants. */
const graphRequirements: Readonly<
  Record<ArchivedRuntimeCapability, "source" | "manifest">
> = {
  sql: "source",
  author: "source",
  charts: "source",
  "dataset-mutations": "source",
  "data-controls": "source",
  "slide-deck": "source",
  mermaid: "source",
  "dialog-focus": "source",
  person: "source",
  viewer: "manifest",
  members: "manifest",
  fonts: "manifest",
  context: "manifest",
};
const requirementCapabilities: Readonly<
  Record<keyof ArchivedRuntimeRequirements, ArchivedRuntimeCapability>
> = {
  sql: "sql",
  author: "author",
  charts: "charts",
  datasetMutations: "dataset-mutations",
  dataControls: "data-controls",
  slideDeck: "slide-deck",
  mermaid: "mermaid",
  dialogFocus: "dialog-focus",
  person: "person",
  viewer: "viewer",
  members: "members",
  fonts: "fonts",
  context: "context",
};
export function archivedRuntimePlan(
  requirements: ArchivedRuntimeRequirements,
): ArchivedRuntimePlan {
  const capabilities = (
    Object.keys(
      requirementCapabilities,
    ) as (keyof ArchivedRuntimeRequirements)[]
  )
    .filter((key) => requirements[key])
    .map((key) => requirementCapabilities[key]);
  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    kitGraph: capabilities.some(
      (capability) => graphRequirements[capability] === "source",
    )
      ? "source"
      : "manifest",
  });
}
