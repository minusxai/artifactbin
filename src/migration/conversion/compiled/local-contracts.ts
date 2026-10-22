import type {
  ArchivedStaticOutput,
  CompiledMigrationInput,
  CompiledMigrationOptions,
} from "./contracts.ts";
import type { ConversionResult } from "../contracts.ts";
/** Mutable viewer data; queries are derived, never persisted. */
export interface LocalScalarDeclaration {
  name: string;
  type: "string" | "number" | "boolean";
  default: string | number | boolean | null;
}
export interface LocalTableDeclaration {
  name: string;
  type: "table";
  default: Record<string, string | number | boolean | null>[];
  columns: { name: string; type: "string" | "number" | "boolean" }[];
}
export type LocalDeclaration = LocalScalarDeclaration | LocalTableDeclaration;
export interface ArchivedLocalOutput extends ArchivedStaticOutput {
  javascript: string;
  queryNames?: string[];
  datasetNames?: string[];
  authorExports?: string[];
  chartPlans?: number;
  declarations: LocalDeclaration[];
  /** Audited migration-time bundle inputs; no authored source or absolute paths. */
  modules: string[];
}
export interface ArchivedLocalOptions
  extends Omit<CompiledMigrationOptions, "compiler"> {
  compiler?: {
    compile(input: CompiledMigrationInput): Promise<ArchivedLocalOutput>;
  };
}
export interface CompiledLocalResult extends ConversionResult {
  provenance?: {
    compiler: "archived-local" | "archived-author";
    build: string;
    mode:
      | "local-scalars"
      | "authored-components"
      | "historical-data-unavailable";
    modules: string[];
  };
}
