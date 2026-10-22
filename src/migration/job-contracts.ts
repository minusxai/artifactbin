import type { MigrationJobDatasets } from "./job-dataset-contracts.ts";
import type { BackendHost } from "../backend/contracts.ts";
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
  historicalUnavailable?: import("./historical-unavailable-contracts.ts").HistoricalUnavailablePolicy;
  sourceQueryRegistrations?: readonly import("../datasets/source-query/contracts.ts").MigrationSourceQueryRegistration[];
  ownershipOverride?: import("./ownership-override-contracts.ts").MigrationOwnershipOverride;
  excludedNativeProgramSources?: readonly import("./programs/native-contracts.ts").NativeProgramExclusionDecision[];
  sourceDirectory: string;
  indexDirectory: string;
  schema: string;
  /** Trusted operator role used only for runtime schema DDL during destination preparation. */
  runtimeOwnerRole?: string;
  reportPath: string;
  apply: boolean;
  /** Compare existing destination only; cannot be combined with apply. */
  verifyOnly?: boolean;
  /** Reproduce final admitted HTML and record exact UTF8 storage inputs without connecting to a destination. */
  measureStorage?: boolean;
  concurrency: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  origin: string;
  legacyOrigins: readonly string[];
  editorManageRestricted: boolean;
  conversionStrategy: MigrationConversionStrategy;
  sourceAdmission?: import("./conversion-strategy-contracts.ts").MigrationSourceAdmission;
  archivedRoot?: string;
  fontBundle?: import("./conversion/compiled/fonts/capture-contracts.ts").CapturedFontBundleInput;
  conversionCacheDirectory?: string;
  retainedCompilerIdentities?: readonly string[];
  datasets?: { receiptsPath: string; relationDirectory: string };
  supplementalAssets?: { receiptsPath: string; objectsDirectory: string };
  media?: { planPath: string; receiptsPath: string; stagingDirectory?: string };
}
export interface MigrationJobPorts {
  /** Called only after the entire corpus and dependency graph have passed planning. */
  connectDestination?: () => Promise<{
    db: SqlReader;
    close: () => Promise<void>;
  }>;
  convert?: Converter;
  backendHost?: BackendHost;
  compilerIdentity?: () => Promise<string>;
}
export interface MigrationJobSource {
  manifest: StreamManifest;
  base: MigrationManifest;
  maps: MigrationMaps;
  ids: string[];
  identitySummary: Record<string, number>;
  groupSummary: Record<string, number>;
  supplementalAssets?: import("./assets/projection-contracts.ts").MigrationSupplementalProjection;
  media: MigrationMediaIndex | null;
  datasets?: MigrationDatasetSource;
  preparedDatasets?: MigrationJobDatasets;
  resourceMap?: Readonly<Record<string, string>>;
  /** Verified default-version aliases, scoped to exact source literals before conversion. */
  resourceMapAliases?: Readonly<Record<string, string>>;
  readArtifact: (id: string) => Promise<MigrationManifest>;
}
export type JobInventory = Record<
  string,
  { total: number; ready: number; blocked: number; excluded?: number }
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
  historicalUnavailable?: import("./historical-unavailable-contracts.ts").HistoricalUnavailableCounts;
  exclusions?: readonly import("./programs/native-contracts.ts").NativeProgramExclusion[];
  totalExcluded?: number;
  inventory: JobInventory;
  totals: JobTotals;
  readiness: MigrationReadiness;
  readinessRows: MigrationReadinessRow[];
  pageDigests: Map<string, string>;
  linksRequireLegacyOrigin: boolean;
  conversionProvenance: Record<string, number>;
  compilerIdentity?: string;
}

export interface MigrationJobSummary {
  historicalUnavailable?: import("./historical-unavailable-contracts.ts").HistoricalUnavailableCounts;
  exclusions?: readonly import("./programs/native-contracts.ts").NativeProgramExclusion[];
  totalExcluded?: number;
  complete: true;
  dryRun: boolean;
  inventory: JobInventory;
  dependencyBlocked: number;
  readinessReport: string;
  verificationReport?: string;
  storageReport?: string;
  datasets?: {
    imports: MigrationJobDatasets["scan"]["statistics"];
    verifiedObjects: number;
    verifiedBytes: number;
    preparedBindings: number;
    blockedPages: number;
    omittedUnmappedTokenPrincipals: number;
    unavailableProfileImages: number;
    historicalUnavailableRevisions: number;
  };
  supplementalAssets?: {
    verifiedAvatars: number;
    verifiedCommentVariants: number;
    unavailableAvatars: number;
    unavailableAttachments: number;
  };
  result: JobTotals;
  identitySummary: Record<string, number>;
  groupSummary: Record<string, number>;
  conversionStrategy: MigrationConversionStrategy;
  sourceAdmission?: import("./conversion-strategy-contracts.ts").MigrationSourceAdmission;
  conversionCache?: { hits: number; misses: number; invalid: number };
  conversionProvenance: Record<string, number>;
  compilerIdentity?: string;
}
