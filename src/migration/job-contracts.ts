import type { MigrationDatasetSource } from "./dataset-source-contracts.ts";
import type {
  Converter,
  MigrationManifest,
  MigrationMaps,
  MigrationPlan,
  SqlReader,
} from "./contracts.ts";
import type { MigrationConversionStrategy } from "./conversion-strategy-contracts.ts";
import type { StreamManifest } from "./stream-contracts.ts";
import type {
  MigrationReadiness,
  MigrationReadinessRow,
} from "./dependency-contracts.ts";
import type { MigrationMediaIndex } from "./media-contracts.ts";
export interface MigrationJobOptions {
  sourceDirectory: string;
  indexDirectory: string;
  schema: string;
  reportPath: string;
  apply: boolean;
  concurrency: 1 | 2;
  origin: string;
  legacyOrigins: readonly string[];
  editorManageRestricted: boolean;
  conversionStrategy: MigrationConversionStrategy;
  archivedRoot?: string;
  conversionCacheDirectory?: string;
  datasets?: { receiptsPath: string; relationDirectory: string };
  media?: { planPath: string; receiptsPath: string; stagingDirectory?: string };
}
export interface MigrationJobPorts {
  /** Called only after the entire corpus and dependency graph have passed planning. */
  connectDestination?: () => Promise<{
    db: SqlReader;
    close: () => Promise<void>;
  }>;
  convert?: Converter;
}
export interface MigrationJobSource {
  manifest: StreamManifest;
  base: MigrationManifest;
  maps: MigrationMaps;
  ids: string[];
  identitySummary: Record<string, number>;
  groupSummary: Record<string, number>;
  media: MigrationMediaIndex | null;
  datasets?: MigrationDatasetSource;
  resourceMap?: Readonly<Record<string, string>>;
  readArtifact: (id: string) => Promise<MigrationManifest>;
}
export type JobInventory = Record<
  string,
  { total: number; ready: number; blocked: number }
>;
export interface JobTotals {
  created: number;
  unchanged: number;
  blocked: number;
  errors: number;
}
export type MigrationPagePlanner = (
  artifact: MigrationManifest,
) => Promise<MigrationPlan>;
export interface MigrationJobPlan {
  inventory: JobInventory;
  totals: JobTotals;
  readiness: MigrationReadiness;
  readinessRows: MigrationReadinessRow[];
  pageDigests: Map<string, string>;
  linksRequireLegacyOrigin: boolean;
  conversionProvenance: Record<string, number>;
}

export interface MigrationJobSummary {
  complete: true;
  dryRun: boolean;
  inventory: JobInventory;
  dependencyBlocked: number;
  readinessReport: string;
  result: JobTotals;
  identitySummary: Record<string, number>;
  groupSummary: Record<string, number>;
  conversionStrategy: MigrationConversionStrategy;
  conversionCache?: { hits: number; misses: number; invalid: number };
  conversionProvenance: Record<string, number>;
}
