import type { BackendJson } from "../../backend/contracts.ts";

/** Conversion is offline planning. Neither analysis nor a plan activates code. */
export interface LegacyProgramIdentity {
  readonly legacyId: string;
  readonly version: number;
  readonly sourceSha256: string;
  readonly deleted: boolean;
}
export interface LegacyProgramSchedule {
  readonly legacyScheduleId: string;
  readonly owner: string;
  readonly cron: string;
  readonly timezone: string;
  readonly input: BackendJson;
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryBackoffSeconds: number;
}
export type LegacyProgramInput = LegacyProgramIdentity &
  (
    | { readonly kind: "native-command"; readonly source: string }
    | {
        readonly kind: "page-handler";
        readonly script: string;
        /** Exact, independently admitted page bindings; never inferred from arbitrary code. */
        readonly bindings: {
          readonly signals: readonly string[];
          readonly queries: readonly string[];
          readonly mutations: readonly string[];
        };
      }
  );
export type ProgramConversionBlocker =
  | "invalid-source"
  | "source-identity-mismatch"
  | "unsupported-module"
  | "dynamic-module"
  | "undeclared-binding"
  | "unsupported-host-capability"
  | "native-runtime-required"
  | "execution-budget-incompatible";
export interface ProgramRequestPlan {
  readonly kind: "request-resolver";
  readonly identity: LegacyProgramIdentity;
  readonly backendSource: string;
  readonly backendSourceSha256: string;
  /** Side effects are possible even if a handler was previously called a query. */
  readonly operation: "Mutation.run";
  readonly inputEncoding: "bounded-json-string";
  readonly outputEncoding: "bounded-json-string";
  readonly lifecycle: "fresh-invocation-dispose-and-drain";
  readonly authority: "fresh-caller-and-registered-bindings";
  readonly activation: "not-activated";
}
export interface ProgramConversionRefusal {
  readonly kind: "requires-adapter";
  readonly identity: LegacyProgramIdentity;
  readonly blockers: readonly ProgramConversionBlocker[];
  /** Generic capability names only; never source snippets, arguments or environment values. */
  readonly capabilities: readonly string[];
}
export type ProgramConversionPlan =
  | ProgramRequestPlan
  | ProgramConversionRefusal;
export interface ProgramSchedulePlan {
  readonly source: LegacyProgramSchedule;
  readonly activation: "not-activated";
  readonly target: "live-head";
  readonly concurrency: "no-overlap-coalesced";
  readonly retries: "preserve-request-identity-and-backoff";
  readonly blocker: "scheduler-runtime-required";
}
/** AST-only reading and deterministic generation; never evaluates archived code. */
export type PlanLegacyProgram = (
  input: LegacyProgramInput,
) => ProgramConversionPlan;
