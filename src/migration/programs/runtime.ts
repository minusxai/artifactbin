import { createAuthorBindings } from "../conversion/compiled/author/bindings.ts";
import type {
  AuthorState,
  QuerySnapshot,
  ReactivePort,
} from "../conversion/compiled/author/contracts.ts";
import type {
  OwnedProgramBindings,
  ProgramBindingManifest,
  ProgramBindingTransport,
} from "./runtime-contracts.ts";
/** No author evaluation, global state, retries, timers or ambient authority. */
export function createProgramBindings(
  manifest: ProgramBindingManifest,
  transport: ProgramBindingTransport,
): OwnedProgramBindings {
  let disposed = false,
    started = false,
    ordinal = 0;
  let starting: Promise<void> | undefined, closing: Promise<void> | undefined;
  const abort = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const state = new Map<string, AuthorState>(
    Object.entries(manifest.defaults).map(([key, value]) => [
      "value:" + key,
      value,
    ]),
  );
  const listeners = new Set<() => void>();
  const queries = new Map<
    string,
    { snapshot: QuerySnapshot; generation: number; listeners: Set<() => void> }
  >();
  const active = () => {
    if (disposed) throw Error("Program disposed");
  };
  const track = <T>(request: Promise<T>) => {
    pending.add(request);
    request.then(
      () => pending.delete(request),
      () => pending.delete(request),
    );
    return request;
  };
  const values = () =>
    Object.fromEntries(
      manifest.values.map((name) => [
        name,
        structuredClone(state.get("value:" + name) ?? null),
      ]),
    );
  const refresh = (name: string) => {
    const query = queries.get(name)!;
    const generation = ++query.generation;
    query.snapshot = { ...query.snapshot, loading: true, error: null };
    for (const listener of query.listeners) listener();
    if (!started || disposed) return;
    const snapshot = values();
    void track(
      Promise.resolve()
        .then(() => {
          active();
          return transport.query(name, snapshot, abort.signal);
        })
        .then(
          (rows) => {
            if (disposed || generation !== query.generation) return;
            query.snapshot = { rows, loading: false, error: null };
            for (const listener of query.listeners) listener();
          },
          (error) => {
            if (disposed || generation !== query.generation) return;
            query.snapshot = {
              rows: [],
              loading: false,
              error: error instanceof Error ? error.message : "Query failed",
            };
            for (const listener of query.listeners) listener();
          },
        ),
    );
  };
  const refreshAll = () => {
    for (const name of queries.keys()) refresh(name);
  };
  const reactive: ReactivePort = {
    signal<T>(initial: T) {
      let value = initial;
      return [
        () => value,
        (next: T | ((old: T) => T)) => {
          value =
            typeof next === "function" ? (next as (old: T) => T)(value) : next;
          return value;
        },
      ];
    },
    untrack: (read) => read(),
    identity: () => null,
    scope: (_identity, render) => render(),
  };
  const bindings = createAuthorBindings(
    {
      state: {
        read: (key) => state.get(key),
        write(key, value) {
          active();
          state.set(key, value);
          refreshAll();
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      query(name) {
        active();
        if (!queries.has(name)) {
          queries.set(name, {
            snapshot: { rows: [], loading: true, error: null },
            generation: 0,
            listeners: new Set(),
          });
          refresh(name);
        }
        const query = queries.get(name)!;
        return {
          read: () => query.snapshot,
          subscribe(listener) {
            query.listeners.add(listener);
            return () => {
              query.listeners.delete(listener);
            };
          },
        };
      },
      mutation(name, args, row) {
        active();
        if (!started) throw Error("Program not authorized");
        const id = "operation-" + ++ordinal;
        return track(
          Promise.resolve()
            .then(() => {
              active();
              return transport.mutate(
                name,
                args,
                row,
                id,
                values(),
                abort.signal,
              );
            })
            .then(() => {
              active();
              refreshAll();
            }),
        );
      },
    },
    manifest,
    reactive,
  );
  const drain = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };
  return {
    bindings,
    start() {
      active();
      return (starting ??= track(
        Promise.resolve()
          .then(() => transport.authorize(abort.signal))
          .then(() => {
            active();
            started = true;
            refreshAll();
          }),
      ));
    },
    drain,
    close() {
      if (closing) return closing;
      disposed = true;
      abort.abort();
      try {
        bindings.dispose();
      } finally {
        listeners.clear();
        for (const query of queries.values()) query.listeners.clear();
      }
      return (closing = drain());
    },
  };
}
