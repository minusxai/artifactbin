import type { CompiledControlOptionsLifecycle } from "./control-options-contracts.ts";
/** Each boot releases or cancels the previous completion before starting another. */
export function createControlOptionsLifecycle(): CompiledControlOptionsLifecycle {
  let active: AbortController | undefined;
  let disposed = false;
  return {
    begin() {
      if (disposed) return null;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      return {
        signal: controller.signal,
        finish() {
          if (active === controller) active = undefined;
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active?.abort();
      active = undefined;
    },
  };
}
