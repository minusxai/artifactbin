import { drainAuthorCleanups } from "./cleanup.ts";
import { assertStorable } from "../../../../apollo/storable.ts";
import { AF_STATE_URL_LIMIT } from "../../../../apollo/apollo-contracts.ts";
import type {
  Accessor,
  AuthorBindings,
  AuthorState,
  AuthorNames,
  AuthorPorts,
  QueryAccessor,
  ReactivePort,
  Scalar,
  Setter,
  SignalOptions,
} from "./contracts.ts";
const scalar = (value: unknown): value is Scalar =>
  value === null ||
  ["string", "boolean"].includes(typeof value) ||
  (typeof value === "number" && Number.isFinite(value));
function storable(value: unknown): value is AuthorState {
  assertStorable(value);
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    AF_STATE_URL_LIMIT
  )
    throw Error("Named author state exceeds the state size limit");
  return true;
}
/** Browser adapter. Reads and writes go through explicit Apollo/query ports. */
export function createAuthorBindings(
  ports: AuthorPorts,
  names: AuthorNames,
  reactive: ReactivePort,
): AuthorBindings {
  let disposed = false;
  const stops: Array<() => void> = [];
  const rejectPending = new Set<(error: Error) => void>();
  const active = () => {
    if (disposed) throw Error("Author mount disposed");
  };
  const state = new Map<string, [Accessor<AuthorState>, Setter<AuthorState>]>();
  function bound(
    key: string,
    initial: AuthorState,
    options?: SignalOptions<AuthorState>,
  ): [Accessor<AuthorState>, Setter<AuthorState>] {
    active();
    const existing = state.get(key);
    if (existing) return existing;
    const validate = (value: unknown): value is AuthorState => {
      if (key.startsWith("value:") && !scalar(value))
        throw Error("Declared author state must be scalar");
      return storable(value);
    };
    const saved = ports.state.read(key);
    validate(saved === undefined ? initial : saved);
    const [read, put] = reactive.signal(
      saved === undefined ? initial : saved,
      options,
    );
    if (saved === undefined) ports.state.write(key, initial);
    const set: Setter<AuthorState> = (next) => {
      active();
      const value =
        typeof next === "function" ? next(reactive.untrack(read)) : next;
      validate(value);
      ports.state.write(key, value);
      put(value);
      return value;
    };
    stops.push(
      ports.state.subscribe(() => {
        if (disposed) return;
        const value = ports.state.read(key);
        if (value !== undefined && validate(value)) put(value);
      }),
    );
    const binding: [Accessor<AuthorState>, Setter<AuthorState>] = [read, set];
    state.set(key, binding);
    return binding;
  }
  const queries = new Map<string, QueryAccessor>();
  const name = (ref: string, allowed: string[]) => {
    active();
    if (!ref.startsWith("$") || !allowed.includes(ref.slice(1)))
      throw Error("Undeclared author binding");
    return ref.slice(1);
  };
  return {
    signal(ref) {
      const key = name(ref, names.values);
      const [read, set] = bound("value:" + key, null);
      return [
        read as Accessor<Scalar>,
        (next) => {
          const value =
            typeof next === "function"
              ? next(reactive.untrack(read) as Scalar)
              : next;
          if (!scalar(value))
            throw Error("Declared author state must be scalar");
          return set(value) as Scalar;
        },
      ];
    },
    createSignal<T>(
      value: T,
      options?: SignalOptions<T>,
    ): [Accessor<T>, Setter<T>] {
      active();
      if (!options?.name) return reactive.signal(value, options);
      if (!storable(value))
        throw Error("Named author state must be storable JSON");
      return bound(
        "author:" + JSON.stringify([reactive.identity(), options.name]),
        value,
        options as SignalOptions<AuthorState>,
      ) as unknown as [Accessor<T>, Setter<T>];
    },
    query(ref) {
      const key = name(ref, [...names.queries, ...(names.tables ?? [])]);
      const existing = queries.get(key);
      if (existing) return existing;
      const port = ports.query(key);
      const [read, put] = reactive.signal(port.read());
      const waiters = new Set<{
        resolve: (rows: ReturnType<QueryAccessor>) => void;
        reject: (error: Error) => void;
      }>();
      stops.push(
        port.subscribe(() => {
          if (disposed) return;
          const next = port.read();
          put(next);
          if (!next.loading) {
            for (const waiter of waiters) {
              rejectPending.delete(waiter.reject);
              next.error
                ? waiter.reject(Error(next.error))
                : waiter.resolve(next.rows);
            }
            waiters.clear();
          }
        }),
      );
      const accessor = Object.defineProperties(() => read().rows, {
        loading: { value: () => read().loading },
        error: { value: () => read().error },
        ready: {
          get() {
            active();
            const now = reactive.untrack(read);
            if (!now.loading)
              return now.error
                ? Promise.reject(Error(now.error))
                : Promise.resolve(now.rows);
            return new Promise((resolve, reject) => {
              waiters.add({ resolve, reject });
              rejectPending.add(reject);
            });
          },
        },
      }) as QueryAccessor;
      queries.set(key, accessor);
      return accessor;
    },
    mount(identity, render) {
      active();
      if (!identity) throw Error("Missing stable author mount identity");
      return reactive.scope(identity, render);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      drainAuthorCleanups([
        ...stops.splice(0),
        () => {
          for (const reject of rejectPending)
            reject(Error("Author mount disposed"));
          rejectPending.clear();
          state.clear();
          queries.clear();
        },
      ]);
    },
  };
}
