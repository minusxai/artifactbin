/** Reserve toolbar space without replacing author body layout or its responsive rules. */
export interface LocalLayout {
  /** Re-measure author root padding with only the platform inset temporarily absent. */
  refresh(): void;
  /** Remove the inset and resize listener, restoring authored geometry. */
  dispose(): void;
}
export interface LocalLayoutOptions {
  document: Document;
  inset: number;
}
