/** Render failures belong to the requested view, never the authentication snapshot. */
export interface LibraryViewState {
  pending: boolean;
  error: string | null;
}
export interface LibraryViewStateOptions {
  changed(state: LibraryViewState): void;
}
/** Invalidating an authority transition prevents old views and errors from committing. */
export interface LibraryViewStateController {
  getSnapshot(): LibraryViewState;
  invalidate(): void;
  render(task: (current: () => boolean) => Promise<void>): Promise<boolean>;
}
