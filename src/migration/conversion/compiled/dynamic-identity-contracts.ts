export interface DynamicIdentityValues {
  readonly values: Readonly<Record<string, unknown>>;
  readonly row?: Readonly<Record<string, unknown>>;
}
export interface DynamicIdentityController {
  /** Synchronous validation; throws without assigning any identities on collision. */
  flush(): void;
  dispose(): void;
}
export interface DynamicIdentityScope { readonly tag: 'repeat' | 'table'; readonly owner: string; readonly column?: string }
/** Unowned native instances remain DOM identifiers and never become comment anchors. */
export type DynamicIdentityOwnership = 'page' | 'unowned-instance' | 'unrelated' | 'invalid';
