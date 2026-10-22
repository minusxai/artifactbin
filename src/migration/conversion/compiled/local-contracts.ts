import type {
  ArchivedStaticOutput,
  CompiledMigrationInput,
  CompiledMigrationOptions,
} from "./contracts.ts";
import type { ConversionResult } from "../contracts.ts";
/** Only scalar page data. Queries, shared mutations and author code are excluded. */
export interface LocalScalarDeclaration {
  name: string;
  type: "string" | "number" | "boolean";
  default: string | number | boolean | null;
}
export interface ArchivedLocalOutput extends ArchivedStaticOutput {
  javascript: string;
  queryNames?: string[];
  declarations: LocalScalarDeclaration[];
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
    compiler: "archived-local";
    build: string;
    mode: "local-scalars";
    modules: string[];
  };
}
