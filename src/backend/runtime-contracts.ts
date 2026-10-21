/** A controllable clock owns both time and scheduled transitions. */
export interface BackendClock {
  now(): number;
  after(ms: number, callback: () => void): () => void;
}
export interface BackendWork {
  readonly closed: boolean;
  /** Capture ownership synchronously, before operation's first await. */
  own<T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  /** FIFO admission; the returned release is single-use. */
  admit(signal?: AbortSignal): Promise<() => void>;
  /** Cancel entrants and queued work, and drain them plus the resource owner's barrier. */
  close(resources: () => Promise<void>, verify?: () => void): Promise<void>;
}
export interface SandboxLease<T> {
  readonly value: T;
  /** Only a healthy reusable lease may return to the pool; release is single-use. */
  release(reusable: boolean): Promise<boolean>;
}
export interface SandboxPool<T> {
  /** null explicitly chooses a one-use resource. Capacity includes pending creations. */
  acquire(
    key: string | null,
    create: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<SandboxLease<T>>;
  /** Invalidating a busy resource never releases its caller's exclusive lease. */
  retire(value: T): Promise<boolean>;
  /** Block acquisition and await pending creations, busy leases and all prior retirements. */
  close(): Promise<void>;
  /** Called only after the host has independently proven every suspect container absent. */
  recovered(): void;
}
export interface SandboxPoolOptions<T> {
  max: number;
  idleMs: number;
  clock?: BackendClock;
  healthy(value: T): boolean;
  dispose(value: T): Promise<boolean>;
}
/** Complete trusted identity of a reusable isolate; viewer/page identity is deliberately absent. */
export interface SandboxIdentity {
  readonly owner: string;
  readonly fileId: string;
  readonly version: string;
  readonly bundleHash: string;
  readonly imageId: string;
  readonly duplex: boolean;
  readonly env: Readonly<Record<string, string>>;
}
/** Per-invocation frame state, quotas and capability authority, with no OS dependency. */
export interface SandboxCallProtocol {
  receive(raw: Uint8Array): void;
  /** Abort handlers, suppress further dispatch/replies and await actual handler settlement.
   * Trusted handlers must cooperate with abort; an uncooperative handler keeps drain pending. */
  close(): Promise<void>;
}
export interface SandboxCallOptions {
  readonly principal: import("./contracts.ts").BackendPrincipal;
  readonly handler?: import("./contracts.ts").BackendCapabilityHandler;
  readonly signal: AbortSignal;
  reply(frame: import("./contracts.ts").BackendJson): void;
  result(value: import("./contracts.ts").BackendJson): void;
  failure(error: import("./contracts.ts").BackendHostError): void;
}
