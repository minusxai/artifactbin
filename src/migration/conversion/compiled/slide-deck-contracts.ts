/** Static source structure; generated IDs remain compiler-owned, authored IDs do not. */
export interface CompiledSlideDeck {
  readonly slides: readonly {readonly id?: string; readonly title: string}[];
}
export interface SlideDeckRuntime {
  dispose(): void;
  refresh(): void;
}
