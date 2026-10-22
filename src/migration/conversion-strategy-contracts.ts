import type { ArchivedCompilerPort } from "./conversion/compiled/contracts.ts";
export type MigrationConversionStrategy =
  | "strict"
  | "archived-static"
  | "archived-functional";
export type MigrationSourceAdmission = "strict" | "offline-prototype";
export interface MigrationConversionOptions {
  /** Explicit offline migration opt-in; normal runtime isolation and binding checks still apply. */
  sourceAdmission?: MigrationSourceAdmission;
  strategy: MigrationConversionStrategy;
  /** Explicit opt-in path; never discovered or used as a fallback. */
  legacyRoot?: string;
  fontBundle?: import("./conversion/compiled/fonts/capture-contracts.ts").CapturedFontBundleInput;
  compiler?: ArchivedCompilerPort;
  localCompiler?: import("./conversion/compiled/local-contracts.ts").ArchivedLocalOptions["compiler"];
}
