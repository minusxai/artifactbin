import type { SavedQueryRegistration } from "../persistence/dataset-queries-contracts.ts";
import type { RegisteredServerQueryPlan } from "../datasets/query/contracts.ts";
import type { DatasetBrowserBinding } from "./datasets/planner-contracts.ts";
import type { CompiledLegacyServerModule } from "./server-module-contracts.ts";
/** Offline-only compiler result. No authored module is evaluated. */
export interface MigrationQueryFlow {
  values: readonly {
    name: string;
    kind: "scalar" | "table";
    type: string;
    default: unknown;
    rows?: readonly Record<string, unknown>[];
    columns?: readonly { name: string; type: string }[];
  }[];
  queries: readonly {
    name: string;
    engine: string;
    source?: string;
    sql: string;
    reads: {
      queries: readonly string[];
      values: readonly string[];
      imports: readonly string[];
      builtins: readonly string[];
    };
  }[];
  imports: readonly {
    name: string;
    ref: string;
    tables: readonly {
      name: string;
      columns: readonly { name: string; type: string }[];
    }[];
  }[];
  mutations: readonly {
    name: string;
    target: { local?: string; import?: string };
  }[];
}
export interface MigrationQueryCompilerInput {
  source: string;
  bindings: readonly DatasetBrowserBinding[];
}
export interface MigrationQueryCompilerOutput {
  flow: MigrationQueryFlow;
  module: CompiledLegacyServerModule;
}
export type MigrationQueryCompiler = (
  input: MigrationQueryCompilerInput,
) => Promise<MigrationQueryCompilerOutput | null>;
/** Registered identity is attached only after link rewriting and normal HTML preparation. */
export interface MigrationQueryReceipt {
  pageVersion: number;
  moduleSourceSha256: string;
  flowSourceSha256: string;
  compilerIdentity: string;
  plan: Omit<RegisteredServerQueryPlan, "registration">;
}

export interface MigrationSavedQueryRegistration
  extends SavedQueryRegistration {
  readonly migrationProvenance: {
    flowSourceSha256: string;
    compilerIdentity: string;
  };
}
