import type { ConversionOutput } from "../contracts.ts";
export interface VizRecipePageInput {
  format: "viz";
  title: string;
  coreUrl: string;
  /** Exact archived JSON text, including whitespace; never a normalized reserialization. */
  source: string;
  sourceVersion: number;
  sourceSha256: string;
}
export interface VizRecipeSlot {
  name: string;
  label: string;
  accepts: readonly ("nominal" | "quantitative" | "temporal")[];
  multi?: boolean;
}
export interface VizRecipePagePlan {
  title: string;
  coreUrl: string;
  source: string;
  description: string;
  engine: "vega-lite" | "vega";
  slots: readonly VizRecipeSlot[];
  provenance: { format: "viz"; sourceVersion: number; sourceSha256: string };
}
export interface VizRecipePageConversion extends ConversionOutput {
  vizRecipeProvenance: VizRecipePagePlan["provenance"];
}
