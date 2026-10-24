import type { MigrationMaps, PlannedPage } from "../contracts.ts";
import type { MigrationOwnershipOverride } from "../ownership-override-contracts.ts";
import type { NativeSelectedPage, NativeRevisionKey } from "./contracts.ts";
import type {
  NativeAssemblyInput,
  NativeAssemblyResult,
} from "./assemble-contracts.ts";
export interface NativeV3BundleDependency {
  path: string;
  kind: "asset" | "dataset";
  id: string;
  revision: string;
  state?: string;
  sha256?: string;
}
type Scalar = string | number | boolean | null;
export interface NativeV3QueryProgram {
  scalars: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "date" | "timestamp" | "user";
      default: Scalar;
    }
  >;
  queries: readonly {
    name: string;
    sql: string;
    /** Explicit mapped dataset catalog; omitted queries use the local engine. */
    source?: string;
    dependencies: readonly string[];
  }[];
  imports: readonly { alias: string; binding: string; table: string }[];
}
export interface NativeV3MutationProgram {
  name: string;
  kind: "insert" | "delete";
  sql: string;
  target: { datasetId: string; schema: string; table: string };
  values: Record<
    string,
    {
      type: "string" | "number" | "boolean";
      nullable: boolean;
      parameter: string;
      default?: Scalar;
    }
  >;
  builtins: readonly { name: "_me.id" | "_now" | "_tz"; parameter: string }[];
  expectedAffected: 1;
  reset: readonly string[];
}
export interface NativeV3BackendLink {
  kind: "backend";
  name: string;
  backendId: string;
  version: string;
}
export interface NativeV3PreparedBackend {
  link: NativeV3BackendLink;
  backend: { name: string; source: string; compiled: string; typeDefs: string };
  envelope: unknown;
}
export interface NativeV3Page {
  pageId: string;
  version: number;
  revision: string;
  html: string;
  nextNodeId: number;
  links: readonly NativeV3BackendLink[];
}
export interface NativeV3Ledger {
  allocatedIds: readonly string[];
  nextNodeId: number;
}
export type NativeV3ProgramReceipt = {
  namespace: string;
  backendId: string;
  planSha256: string;
  programSha256: string;
  provenance: {
    compilerSha256: string;
    sourceSha256: string;
    sqlEngineSha256: string;
  };
  operations: NativeAssemblyInput["backends"][number]["operations"];
} & (
  | { kind: "query"; program: NativeV3QueryProgram }
  | { kind: "mutation"; program: NativeV3MutationProgram }
);
export interface NativeV3AssemblyReceipt {
  key: NativeRevisionKey;
  sourceRowSha256: string;
  input: NativeAssemblyInput;
  result: NativeAssemblyResult;
  programs: readonly NativeV3ProgramReceipt[];
  sha256: string;
}
/** Existing v2 maps contain ACTOR strings, not v3 database IDs. This separate trusted projection never creates credentials. */
export interface NativeV3IdentityMaps {
  actors: Readonly<Record<string, { userId: string }>>;
  users: Readonly<Record<string, { userId: string; email: string | null }>>;
  tokens: Readonly<Record<string, { tokenId: string }>>;
}
export interface NativeV3ProjectionInput {
  /** Explicit latest-head import; omission preserves the historical projection contract. */
  revisionScope?: "history" | "latest";
  selection: {
    sourceNamespace: string;
    manifestSha256: string;
    page: NativeSelectedPage;
  };
  planned: PlannedPage;
  plannedSha256: string;
  maps: MigrationMaps;
  targets: NativeV3IdentityMaps;
  targetIdentitySha256: string;
  ownershipOverride?: MigrationOwnershipOverride;
  assemblies: readonly NativeV3AssemblyReceipt[];
  /** Digest of concrete B/C relation projections, not a fabricated successful-empty receipt. */
  relationSha256?: string;
}
export interface NativeV3Preflight {
  revisionScope: "history" | "latest";
  assemblies: readonly NativeV3AssemblyReceipt[];
  access: Pick<NativeV3HistoryImport, "visibility" | "linkRole" | "shares">;
}
/** Actual v3 canonicalizer/registry functions supplied by the reviewed host bridge; no copied renderer/parser or SQL execution. */
export interface NativeV3PublicationHost {
  /** Actual publication-bundle rewrite over verified staged module/resource objects, before canonical source/program binding. */
  prepareBundle?(
    receipt: NativeV3AssemblyReceipt,
    pageId: string,
  ): {
    html: string;
    pageId: string;
    sourceHtmlSha256: string;
    assetsSha256: string;
    dependencies: readonly NativeV3BundleDependency[];
    fileDigests: readonly { path: string; sha256: string }[];
  };
  canonicalize(
    html: string,
    options: { previousHtml: string; ledger: NativeV3Ledger },
  ): { html: string; ledger: NativeV3Ledger; nodeIds: readonly string[] };
  prepareQuery(
    page: NativeV3Page,
    receipt: Extract<NativeV3ProgramReceipt, { kind: "query" }>,
  ): NativeV3PreparedBackend;
  prepareMutation(
    page: NativeV3Page,
    receipt: Extract<NativeV3ProgramReceipt, { kind: "mutation" }>,
  ): NativeV3PreparedBackend;
  verifyProgram(
    page: NativeV3Page,
    prepared: NativeV3PreparedBackend,
    kind: "query" | "mutation",
    ownerId: string,
  ): void;
}
/** JSON wire mirror of native-history-import/contracts.ts; prepared envelopes are produced by the actual injected host. */
export interface NativeV3HistoryImport {
  sourceNamespace: string;
  sourceId: string;
  selectionSha256: string;
  projectionSha256: string;
  relationSha256?: string;
  pageId: string;
  owner: { userId: string; tokenId: string };
  visibility: "public" | "private" | "unlisted";
  linkRole: "viewer" | "commenter" | "editor";
  shares: { email: string; role: "viewer" | "commenter" | "editor" }[];
  headVersion: number;
  revisions: {
    htmlPublicationDependencies?: readonly NativeV3BundleDependency[];
    page: NativeV3Page;
    ledger: NativeV3Ledger;
    sourceSha256: string;
    title: string | null;
    description: string | null;
    createdAt: string;
    actorUserId: string | null;
    actorTokenId: string | null;
    queries: NativeV3PreparedBackend[];
    mutations: NativeV3PreparedBackend[];
  }[];
}

export interface NativeV3PublicationModules {
  prepareBundle?: NativeV3PublicationHost["prepareBundle"];
  canonicalizeHtmlPage: NativeV3PublicationHost["canonicalize"];
  prepareRegisteredQueryBackend(
    name: string,
    id: string,
    page: NativeV3Page,
    program: NativeV3QueryProgram,
    provenance: NativeV3ProgramReceipt["provenance"],
  ): NativeV3PreparedBackend;
  prepareRegisteredMutationBackend(
    name: string,
    id: string,
    page: NativeV3Page,
    program: NativeV3MutationProgram,
    provenance: NativeV3ProgramReceipt["provenance"],
  ): NativeV3PreparedBackend;
  registeredPlan(
    page: NativeV3Page,
    link: NativeV3BackendLink,
    record: NativeV3PreparedBackend["backend"] & {
      backendId: string;
      pageId: string;
      version: string;
      ownerId: string;
      secretBindings: string[];
    },
  ): unknown;
  registeredMutationPlan: NativeV3PublicationModules["registeredPlan"];
}
