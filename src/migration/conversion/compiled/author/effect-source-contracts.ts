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
