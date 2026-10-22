/** Declared test execution requirements; names describe capabilities, not product modules. */
export type TestCapability =
  | "unit"
  | "local"
  | "database"
  | "browser"
  | "isolate";
export type TestBrowser = "chromium" | "firefox" | "webkit";
export type MigrationTestRequirement =
  | "archived-compiler"
  | "migration-database";
export interface TestRequirements {
  migration?: readonly MigrationTestRequirement[];
  build: boolean;
  postgres: boolean;
  browsers: TestBrowser[];
  backend: boolean;
}
export interface TestDescriptor {
  file: string;
  capability: TestCapability;
  requirements: TestRequirements;
}
export type TestStage =
  | TestCapability
  | "integration"
  | "all"
  | "required-migration";

/** Resource limits for selecting test-file parallelism, independent of the host. */
export interface TestConcurrencyResources {
  availableParallelism: number;
  ci: boolean;
}
export interface RequiredMigrationInputs {
  archivedRoot: string;
  databaseUrl: string;
}
