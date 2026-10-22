import type { CompiledAuthorPlan } from "./author-document-contracts.ts";
import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
import type { ConversionResult } from "../contracts.ts";
export interface CompiledMigrationInput {
  source: string;
  /** Set only by the explicit author-document offline migration route. */
  authorPlan?: CompiledAuthorPlan;
  coreUrl: string;
  /** Explicit manifest bindings; metadata only, never dataset rows. */
  datasetBindings?: readonly CompiledDatasetBinding[];
  /** Explicit importer decision for an archived revision without historical authorization. */
  datasetUnavailable?: { reason: "historical-binding-unavailable" };
  /** Exact archived img URL -> verified ACL media endpoint. Static assembler only. */
  resourceMap?: Readonly<Record<string, string>>;
  theme?: string | null;
  template?: string | null;
  colorMode?: "light" | "dark";
}
export interface ArchivedStaticOutput {
  html: string;
  css: string;
  title: string;
  build: string;
  /** Native wrappers required by the archived CSS. No app chrome or transports. */
  rootAttributes: Record<string, string>;
  capabilities: string[];
}
export interface ArchivedCompilerPort {
  compile(input: CompiledMigrationInput): Promise<ArchivedStaticOutput>;
}
export interface CompiledMigrationOptions {
  legacyRoot?: string;
  compiler?: ArchivedCompilerPort;
  timeoutMs?: number;
}
export interface CompiledMigrationResult extends ConversionResult {
  provenance?: {
    compiler: "archived-static";
    build: string;
    mode: "static-only";
  };
}
export const MAX_COMPILED_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPILED_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_COMPILER_TIME_MS = 60_000;
