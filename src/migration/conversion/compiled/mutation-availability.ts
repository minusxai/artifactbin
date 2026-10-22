import type {
  CompiledMutationAvailability,
  CompiledMutationAvailabilityPorts,
} from "./mutation-availability-contracts.ts";
const denied = "Shared data editing is unavailable.";
export function createCompiledMutationAvailability(
  ports: CompiledMutationAvailabilityPorts,
): CompiledMutationAvailability {
  const allowed = new Set<string>();
  let generation = 0,
    disposed = false;
  let stops: Array<() => void> = [];
  const stop = () => {
    generation++;
    allowed.clear();
    const prior = stops;
    stops = [];
    for (const release of prior) release();
    ports.changed();
  };
  const reconnect = () => {
    stop();
    if (disposed) return;
    const current = generation;
    for (const binding of ports.bindings) {
      try {
        const release = ports.watch(binding, (value) => {
          if (disposed || current !== generation) return;
          const descriptor =
            value && typeof value === "object"
              ? Object.getOwnPropertyDescriptor(value, "canAttempt")
              : undefined;
          if (descriptor && "value" in descriptor && descriptor.value === true)
            allowed.add(binding.name);
          else allowed.delete(binding.name);
          ports.changed();
        });
        if (disposed || current !== generation) release();
        else stops.push(release);
      } catch {
        allowed.delete(binding.name);
        ports.changed();
      }
    }
  };
  reconnect();
  return {
    unavailable: (name) => (!disposed && allowed.has(name) ? null : denied),
    reconnect,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
    },
  };
}
