import type {
  CompiledQueryController,
  CompiledQueryPorts,
  CompiledQueryConfiguration,
  CompiledQueryAnswer,
  CompiledQueryPublication,
} from "./query-controller-contracts.ts";
import { completeControlOptions } from "./control-options.ts";
import { controlPageRequest } from "./data-controls.ts";
/** Owns query evaluation lifetimes. Transports, state, identities and DOM remain at their boundaries. */
export function createCompiledQueryController(
  configuration: CompiledQueryConfiguration,
  ports: CompiledQueryPorts,
): CompiledQueryController {
  if (
    !Number.isSafeInteger(configuration.deadlineMs) ||
    configuration.deadlineMs < 1 ||
    configuration.deadlineMs > 2147483647
  )
    throw Error("Invalid query deadline");
  let generation = 0,
    disposed = false,
    scope = new AbortController();
  const queries = new Set(configuration.queries);
  const observers = new Set<(event: CompiledQueryPublication) => void>();
  const publish = (event: CompiledQueryPublication) => {
    ports.publish(event);
    for (const observer of [...observers]) observer(event);
  };
  const check = (current: number, signal: AbortSignal, deadline: number) => {
    if (disposed || current !== generation || signal.aborted)
      throw Error("Query snapshot cancelled");
    if (ports.clock.now() >= deadline) throw Error("Query execution timed out");
    if (ports.availability() !== "ready")
      throw Error("Query inputs unavailable");
  };
  const wait = <T>(
    promise: Promise<T>,
    signal: AbortSignal,
    deadline: number,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      let settled = false,
        stopDeadline = () => {};
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        stopDeadline();
        signal.removeEventListener("abort", abort);
        action();
      };
      const abort = () =>
        finish(() => reject(Error("Query snapshot cancelled")));
      const timeout = () =>
        finish(() => reject(Error("Query execution timed out")));
      // Observe even a late engine rejection after cancellation or timeout.
      promise.then(
        (value) => {
          if (ports.clock.now() >= deadline) timeout();
          else finish(() => resolve(value));
        },
        (error) => finish(() => reject(error)),
      );
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      const remaining = deadline - ports.clock.now();
      if (remaining <= 0) {
        timeout();
        return;
      }
      stopDeadline = ports.clock.schedule(timeout, remaining);
    });
  const retire = () => {
    generation++;
    scope.abort();
    scope = new AbortController();
  };
  const controller: CompiledQueryController = {
    async refresh() {
      if (disposed || ports.availability() === "blocked") return false;
      retire();
      const current = generation,
        signal = scope.signal,
        deadline = ports.clock.now() + configuration.deadlineMs;
      publish({ state: "pending" });
      try {
        check(current, signal, deadline);
        ports.engine.prepare();
        while (!ports.engine.ready()) {
          check(current, signal, deadline);
          await wait(ports.clock.sleep(10, signal), signal, deadline);
        }
        check(current, signal, deadline);
        const evaluation = await wait(ports.evaluation(), signal, deadline);
        check(current, signal, deadline);
        const result = await wait(
          ports.engine.run(evaluation),
          signal,
          deadline,
        );
        check(current, signal, deadline);
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
            answer.tables[name] = await wait(
              completeControlOptions(
                answer.tables[name],
                (offset, limit) => {
                  check(current, signal, deadline);
                  return ports.engine.page(name, { offset, limit }, evaluation);
                },
                {},
                {
                  signal,
                  now: () => ports.clock.now(),
                  schedule: (callback, ms) =>
                    ports.clock.schedule(callback, ms),
                },
              ),
              signal,
              deadline,
            );
          check(current, signal, deadline);
        }
        publish({ state: "settled", answer });
        return !Object.keys(answer.errors).length;
      } catch {
        if (!disposed && current === generation) {
          scope.abort();
          publish({
            state: "failed",
            errors: Object.fromEntries(
              configuration.queries.map((name) => [name, "Local query failed"]),
            ),
          });
        }
        return false;
      }
    },
    refreshUntilSettled(signal) {
      if (disposed || signal.aborted || ports.availability() !== "ready")
        return Promise.resolve(false);
      const deadline = ports.clock.now() + configuration.deadlineMs;
      return new Promise<boolean>((resolve) => {
        let settled = false,
          stopDeadline = () => {};
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          stopDeadline();
          signal.removeEventListener("abort", abort);
          observers.delete(observe);
          resolve(
            ok && !signal.aborted && !disposed && ports.clock.now() < deadline,
          );
        };
        const abort = () => finish(false);
        const observe = (event: CompiledQueryPublication) => {
          if (disposed || event.state === "failed") finish(false);
          else if (event.state === "settled")
            finish(!Object.keys(event.answer.errors).length);
        };
        observers.add(observe);
        signal.addEventListener("abort", abort, { once: true });
        stopDeadline = ports.clock.schedule(abort, configuration.deadlineMs);
        // A dependency can synchronously invalidate this refresh and queue its
        // replacement. Only a current publication settles the principal gate.
        void controller.refresh().catch(abort);
      });
    },
    async fetchPage(name, page, columns) {
      const current = generation,
        signal = scope.signal,
        deadline = ports.clock.now() + configuration.deadlineMs;
      check(current, signal, deadline);
      if (!queries.has(name)) throw Error("Undeclared table query");
      const request = controlPageRequest(page, columns);
      const evaluation = await wait(ports.evaluation(), signal, deadline);
      check(current, signal, deadline);
      const answer = await wait(
        ports.engine.page(name, request, evaluation),
        signal,
        deadline,
      );
      check(current, signal, deadline);
      return answer;
    },
    invalidate() {
      if (disposed) return;
      retire();
      publish({ state: "cleared" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retire();
      publish({ state: "cleared" });
      scope.abort();
    },
  };
  return controller;
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
