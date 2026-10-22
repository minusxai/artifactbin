import type {
  CompiledQueryController,
  CompiledQueryPorts,
  CompiledQueryConfiguration,
  CompiledQueryAnswer,
} from "./query-controller-contracts.ts";
import { completeControlOptions } from "./control-options.ts";
import { controlPageRequest } from "./data-controls.ts";
/** Owns query evaluation lifetimes. Transports, state, identities and DOM remain at their boundaries. */
export function createCompiledQueryController(
  configuration: CompiledQueryConfiguration,
  ports: CompiledQueryPorts,
): CompiledQueryController {
  let generation = 0,
    disposed = false,
    scope = new AbortController();
  const queries = new Set(configuration.queries);
  const check = (current: number, signal: AbortSignal) => {
    if (disposed || current !== generation || signal.aborted)
      throw Error("Query snapshot cancelled");
    if (ports.availability() !== "ready")
      throw Error("Query inputs unavailable");
  };
  const wait = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(Error("Query snapshot cancelled"));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  const retire = () => {
    generation++;
    scope.abort();
    scope = new AbortController();
  };
  return {
    async refresh() {
      if (disposed || ports.availability() === "blocked") return false;
      retire();
      const current = generation,
        signal = scope.signal;
      ports.publish({ state: "pending" });
      try {
        check(current, signal);
        ports.engine.prepare();
        const deadline = ports.clock.now() + configuration.deadlineMs;
        while (!ports.engine.ready()) {
          check(current, signal);
          if (ports.clock.now() > deadline)
            throw Error("Local engine loading timed out");
          await wait(ports.clock.sleep(10, signal), signal);
        }
        const evaluation = await wait(ports.evaluation(), signal);
        check(current, signal);
        const result = await wait(ports.engine.run(evaluation), signal);
        check(current, signal);
        // Completing option windows must not mutate the engine's cached answer.
        const answer: CompiledQueryAnswer = {
          tables: { ...result.tables },
          errors: { ...result.errors },
        };
        for (const name of configuration.optionQueries) {
          if (
            queries.has(name) &&
            (!answer.tables[name] || answer.errors[name])
          )
            throw Error("Select options unavailable");
          if (answer.tables[name])
            answer.tables[name] = await completeControlOptions(
              answer.tables[name],
              (offset, limit) => {
                check(current, signal);
                return ports.engine.page(name, { offset, limit }, evaluation);
              },
              {},
              { signal, now: ports.clock.now, schedule: ports.clock.schedule },
            );
          check(current, signal);
        }
        ports.publish({ state: "settled", answer });
        return !Object.keys(answer.errors).length;
      } catch {
        if (!disposed && current === generation)
          ports.publish({
            state: "failed",
            errors: Object.fromEntries(
              configuration.queries.map((name) => [name, "Local query failed"]),
            ),
          });
        return false;
      }
    },
    async fetchPage(name, page, columns) {
      const current = generation,
        signal = scope.signal;
      check(current, signal);
      if (!queries.has(name)) throw Error("Undeclared table query");
      const request = controlPageRequest(page, columns);
      const evaluation = await wait(ports.evaluation(), signal);
      check(current, signal);
      const answer = await wait(
        ports.engine.page(name, request, evaluation),
        signal,
      );
      check(current, signal);
      return answer;
    },
    invalidate() {
      if (disposed) return;
      retire();
      ports.publish({ state: "cleared" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retire();
      ports.publish({ state: "cleared" });
      scope.abort();
    },
  };
}

/** Native timers are owned by each wait and released on cancellation. */
export const compiledQueryClock: CompiledQueryPorts["clock"] = {
  now: () => Date.now(),
  schedule: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(Error("Query snapshot cancelled"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }),
};
