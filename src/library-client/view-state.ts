import type {
  LibraryViewState,
  LibraryViewStateController,
  LibraryViewStateOptions,
} from "./view-state-contracts.ts";
export function createLibraryViewState(
  options: LibraryViewStateOptions,
): LibraryViewStateController {
  let generation = 0;
  let state: LibraryViewState = { pending: false, error: null };
  const getSnapshot = () => ({ ...state });
  function publish(next: LibraryViewState) {
    state = next;
    options.changed(getSnapshot());
  }
  return {
    getSnapshot,
    invalidate() {
      generation++;
      publish({ pending: false, error: null });
    },
    async render(task) {
      const version = ++generation;
      const current = () => version === generation;
      publish({ pending: true, error: null });
      try {
        await task(current);
        if (!current()) return false;
        publish({ pending: false, error: null });
        return true;
      } catch (error) {
        if (current())
          publish({
            pending: false,
            error: error instanceof Error ? error.message : String(error),
          });
        return false;
      }
    },
  };
}
