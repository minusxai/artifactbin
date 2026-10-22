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
