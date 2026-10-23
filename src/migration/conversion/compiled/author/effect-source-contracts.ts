export interface PreparedAuthorEffects {
  readonly source: string;
  /** Collision-free imported runtime port name used by the compiled initializer. */
  readonly lifetimeIdentifier: string;
  readonly windowIdentifier: string;
  readonly capabilities: readonly (
    | "effects"
    | "window-scalars"
    | "owned-listeners"
    | "owned-timers"
  )[];
}
/** Components keep a single shared initializer; every window resource belongs to a Solid owner. */
export interface PreparedOwnedAuthorComponents extends PreparedAuthorEffects {
  readonly exports: readonly string[];
}
/** Exact standalone legacy timer-await lowering; other awaits are refused by compilation. */
export type LowerLegacyTimerAwait = (source: string, lifetimeIdentifier: string) => string;
