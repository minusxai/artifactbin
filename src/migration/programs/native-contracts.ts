import type { ProgramResolverSource } from "../../programs/runtime-contracts.ts";
/** A bounded compatibility mapping, not a claim that a Node host was allocated. */
export interface NativeProgramResolver {
  kind: "native-receipt-resolver";
  originalSourceSha256: string;
  resolver: ProgramResolverSource;
  compute: { vcpu: number; memoryMiB: number; ttlSeconds: number };
  execution: "bounded-straight-line";
  output: "stdout-stderr-exit-code";
  authority: "owner-only";
  concurrency: "no-overlap";
  /** Resource reservations are preserved provenance, not isolate guarantees. */
  computeCompatibility: "original-reservation-not-provided";
}
export interface NativeProgramReceipt {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export type NativeProgramAdmission =
  | {
      kind: "resolver-compatible";
      sourceSha256: string;
      program: NativeProgramResolver;
    }
  | {
      kind: "remote-runtime-required";
      sourceSha256: string;
      capabilities: readonly string[];
    }
  | { kind: "invalid-source" | "unsupported-source"; sourceSha256: string };
export interface NativeProgramExclusionDecision {
  sourceSha256: string;
  decision: "remote-agent-runtime-not-migrated";
}
export interface NativeProgramExclusion extends NativeProgramExclusionDecision {
  format: "program";
  reason: "remote-runtime-required";
}
