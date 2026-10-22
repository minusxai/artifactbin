import type {
  CompiledReadiness,
  ReadinessClock,
} from "./readiness-contracts.ts";
export function createCompiledReadiness(
  clock: ReadinessClock,
): CompiledReadiness {
  let hydrated = false;
  const pending = new Set<() => void>();
  return {
    defer(start) {
      let stopped = false,
        cancel = () => {};
      const begin = () => {
        pending.delete(begin);
        if (!stopped)
          cancel = clock.schedule(() => {
            if (!stopped) {
              stopped = true;
              start();
            }
          });
      };
      if (hydrated) begin();
      else {
        if (pending.size >= 10000)
          throw Error("Compiled widget readiness limit");
        pending.add(begin);
      }
      return () => {
        stopped = true;
        pending.delete(begin);
        cancel();
      };
    },
    ready() {
      if (hydrated) return;
      hydrated = true;
      for (const begin of [...pending]) begin();
    },
  };
}
const readiness = createCompiledReadiness({
  schedule(start) {
    const timer = setTimeout(start, 0);
    return () => clearTimeout(timer);
  },
});
/** Exact archived kit edge adapter. Engines are already bundled; no legacy readiness events or transport. */
export const deferEngine = (_host: Element, start: () => void) =>
  readiness.defer(start);
let announced = false;
export const markCompiledReady = () => {
  if (announced) return;
  announced = true;
  // Frozen kit widgets use both the latched marker and a one-time readiness event.
  document.documentElement.setAttribute("data-mx-ready", "");
  document.dispatchEvent(new Event("mx:ready"));
  readiness.ready();
};
