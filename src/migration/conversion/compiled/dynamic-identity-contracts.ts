export interface DynamicIdentityValues {
  readonly values: Readonly<Record<string, unknown>>;
  readonly row?: Readonly<Record<string, unknown>>;
}
export interface DynamicIdentityController {
  /** Synchronous validation; throws without assigning any identities on collision. */
  flush(): void;
  dispose(): void;
}
