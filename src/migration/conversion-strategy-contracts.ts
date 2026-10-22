import type { ArchivedCompilerPort } from "./conversion/compiled/contracts.ts";
export type MigrationConversionStrategy =
  | "strict"
  | "archived-static"
  | "archived-functional";
export interface MigrationConversionOptions {
  strategy: MigrationConversionStrategy;
  /** Explicit opt-in path; never discovered or used as a fallback. */
  legacyRoot?: string;
  fontBundle?: import("./conversion/compiled/fonts/capture-contracts.ts").CapturedFontBundleInput;
  compiler?: ArchivedCompilerPort;
  localCompiler?: import("./conversion/compiled/local-contracts.ts").ArchivedLocalOptions["compiler"];
}
