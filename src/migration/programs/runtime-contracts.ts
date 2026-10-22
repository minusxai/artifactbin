import type {
  AuthorBindings,
  AuthorNames,
  AuthorState,
  Row,
  Scalar,
} from "../conversion/compiled/author/contracts.ts";
/** Created by trusted page/version admission. Names and defaults are never supplied by authored code. */
export interface ProgramBindingManifest extends AuthorNames {
  readonly defaults: Readonly<Record<string, Scalar>>;
}
/** The host fixes page/version/caller authority and registered operations before constructing this port.
 * Implementations perform fresh permission checks, preserve mutation request identity, and never retry unknown writes.
 */
export interface ProgramBindingTransport {
  authorize(signal: AbortSignal): Promise<void>;
  query(
    name: string,
    values: Readonly<Record<string, AuthorState>>,
    signal: AbortSignal,
  ): Promise<Row[]>;
  mutate(
    name: string,
    args: Readonly<Row>,
    row: Readonly<Row> | undefined,
    operationId: string,
    values: Readonly<Record<string, AuthorState>>,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface OwnedProgramBindings {
  readonly bindings: AuthorBindings;
  /** Authorization completes before module evaluation or any query dispatch. */
  start(): Promise<void>;
  drain(): Promise<void>;
  /** Cancels admission and waits for all entered transport calls, including failures. Idempotent. */
  close(): Promise<void>;
}
/** Offline compilation; never registers or activates a backend. */
export interface ProgramResolverSource {
  readonly source: string;
  readonly sourceSha256: string;
  readonly scriptSha256: string;
  readonly operation: "Mutation.run";
  readonly reuse: "one-shot";
  readonly activation: "not-activated";
}
export type CompileProgramResolver = (
  script: string,
  manifest: ProgramBindingManifest,
) => Promise<ProgramResolverSource>;
/** Host-owned invocation identity. Prefixing prevents operation-1 colliding across runs. */
export interface ProgramInvocationAuthority {
  readonly principal: import("../../backend/contracts.ts").BackendPrincipal;
  readonly requestId: string;
  readonly manifest: ProgramBindingManifest;
  readonly transport: ProgramBindingTransport;
}
/** Trusted in-memory preparation only; persisting or exposing this needs explicit admission wiring. */
export interface PreparedProgramResolver {
  readonly backend: import("../../backend/contracts.ts").CompiledBackend;
  readonly manifest: ProgramBindingManifest;
  readonly scriptSha256: string;
}
